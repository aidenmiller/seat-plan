/**
 * Guest and group edits, saved one row at a time (PLAN section 5, "Guests,
 * groups and rules save one row at a time"). Each edit is a PATCH holding
 * only the changed fields. Edits wait a moment, so consecutive edits to one
 * row go out as one request with their fields merged; one request is out at
 * a time, in the order the rows were first edited.
 *
 * The queue is kept in IndexedDB too, so an edit made just before the tab
 * closes, or while offline, is sent the next time any page of the app opens.
 * A failed send that may pass (no connection, a server error, a timeout, a
 * sign-out) is retried with the layout saves' backoff, 1 s up to 30 s, and
 * at once when the browser comes back online. A reply that will not change
 * on a retry (409 conflict, 422 refused, 404 gone) drops the row's waiting
 * edits and is reported, so the page can show why and reload that row.
 *
 * Creates and deletes do not come through here: they go straight to the
 * server, so the page can say at once when one fails.
 *
 * Tabs: each page holds a Web Lock named after its own queue id while open.
 * Edits stored by a queue whose lock is free (its tab closed) are taken
 * over and sent. The stored queue lives in its own IndexedDB database:
 * idb-keyval opens a database with one object store, so a second store in
 * the layout drafts' database would never be created.
 *
 * People: each signed-in user has their own queue (rowSaverFor) and their
 * own database, `seat-plan-rows-u-<userId>`, and every request goes out as
 * that user (appFetchAs). A plain 401 (the session ran out) is retried, so
 * the edits go out once the same person signs in again. A 401 stale_page
 * (someone else signed in on this browser since the page opened) stops the
 * queue in this page: the edits stay in this user's database, and are never
 * sent under the other person's session. When the same person signs in
 * again on this browser, the page calls resume() and they go.
 */
import { del, entries, set, type UseStore } from 'idb-keyval'
import { currentUserId } from '../current-user'
import { appFetch, appFetchAs, isStalePage } from '../http'
import { backoffDelay } from './backoff'
import { openKeyvalStore } from './idb'
import { ensureLegacyAdopted } from './legacy-drafts'
import { randomId } from './random-id'
import { registerSaver } from './saver-registry'
import { ROW_STORE_NAME, rowDbName } from './storage-names'
import type { LockManagerLike } from './tab-lock'

export type RowKind = 'guest' | 'group'
/** The changed fields, as the PATCH body sends them. */
export type RowPatch = Readonly<Record<string, unknown>>

export type RowSaveStatus =
  /** Nothing waiting. */
  | { kind: 'saved' }
  /** Edits waiting, or a request out. */
  | { kind: 'saving' }
  /** The last try failed for a reason that may pass; trying again with backoff. */
  | { kind: 'retrying'; attempt: number; nextTryAt: string; reason: string }
  /** Someone else signed in on this browser: nothing more is sent from this page. The edits stay on this device. */
  | { kind: 'other-user'; reason: string }

/** The page header's words for each status. */
export const ROW_STATUS_TEXT: Record<RowSaveStatus['kind'], string> = {
  saved: 'Saved',
  saving: 'Saving…',
  retrying: 'Not saved, retrying',
  'other-user': 'Not saved: someone else signed in',
}

/** The longer words for 'other-user'. */
export const OTHER_USER_REASON =
  'Someone else signed in on this browser. Sign in again to save your changes. They are kept on this device.'

/** A saved edit: the server's reply (UpdateGuestReply for a guest, Group for a group). */
export type RowSaved = { type: 'saved'; kind: RowKind; id: string; patch: RowPatch; reply: unknown }
/** An edit the server refused, or a row that is gone. Its waiting edits are dropped. */
export type RowRejected = {
  type: 'rejected'
  kind: RowKind
  id: string
  patch: RowPatch
  status: number
  body: unknown
  /** Plain words to show. */
  message: string
}
export type RowSaveEvent = RowSaved | RowRejected

/**
 * One row's waiting edits as stored in IndexedDB. A user's store stamps each
 * row with their id (userId) and hands back only rows that carry it.
 */
export type StoredRow = { queueId: string; kind: RowKind; id: string; patch: RowPatch; queuedAt: string; userId?: string }

/** Where the queue is kept between page loads. Errors are swallowed: saving to the server carries on. */
export interface RowStore {
  put(row: StoredRow): Promise<boolean>
  remove(queueId: string, kind: RowKind, id: string): Promise<boolean>
  list(): Promise<StoredRow[]>
}

export { ROW_STORE_NAME, rowDbName }
export const ROW_LOCK_PREFIX = 'seat-plan-rows:'
export const ROW_QUEUE_ID_KEY = 'seat-plan:rows-queue-id'

const storedKey = (queueId: string, kind: RowKind, id: string) => `${queueId}|${kind}|${id}`

export function isStoredRow(value: unknown): value is StoredRow {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.queueId === 'string' &&
    (v.kind === 'guest' || v.kind === 'group') &&
    typeof v.id === 'string' &&
    typeof v.queuedAt === 'string' &&
    Boolean(v.patch) &&
    typeof v.patch === 'object' &&
    !Array.isArray(v.patch)
  )
}

export type RowStoreOptions = {
  /** Whose queue this is: every row is stamped with it, and rows without it are never handed back. */
  userId: string
  /** Defaults to rowDbName(userId). */
  dbName?: string
  storeName?: string
}

/**
 * A user's IndexedDB store. Any failure answers as if nothing was stored, and
 * the next call opens the database again.
 */
export function createRowStore(options: RowStoreOptions): RowStore {
  const { userId } = options
  if (!userId) throw new Error('A row store needs a user id')
  const dbName = options.dbName ?? rowDbName(userId)
  const storeName = options.storeName ?? ROW_STORE_NAME
  let store: UseStore | null = null
  const open = (): UseStore => {
    if (typeof indexedDB === 'undefined') throw new Error('IndexedDB is not available')
    store ??= openKeyvalStore(dbName, storeName)
    return store
  }
  return {
    async put(row) {
      // Never mix two people's edits in one store.
      if (row.userId !== undefined && row.userId !== userId) return false
      try {
        await set(storedKey(row.queueId, row.kind, row.id), { ...row, userId }, open())
        return true
      } catch {
        store = null
        return false
      }
    },
    async remove(queueId, kind, id) {
      try {
        await del(storedKey(queueId, kind, id), open())
        return true
      } catch {
        store = null
        return false
      }
    },
    async list() {
      try {
        const all = await entries<IDBValidKey, unknown>(open())
        return all.map(([, value]) => value).filter((value): value is StoredRow => isStoredRow(value) && value.userId === userId)
      } catch {
        store = null
        return []
      }
    },
  }
}

/**
 * Two edits of one row as one: later fields win, except expectedPartners,
 * where the earlier expectation of each guest wins. It says how the links
 * stood before the first edit, which is what the server still holds when the
 * merged edit arrives.
 */
export function mergePatches(earlier: RowPatch, later: RowPatch): RowPatch {
  const merged: Record<string, unknown> = { ...earlier, ...later }
  const a = earlier.expectedPartners
  const b = later.expectedPartners
  if (isRecord(a) || isRecord(b)) merged.expectedPartners = { ...(isRecord(b) ? b : {}), ...(isRecord(a) ? a : {}) }
  return merged
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Replies worth trying again: no answer, a timeout, too many requests, a
 * server error, or signed out. A 401 stale_page is never tried again (see
 * isStalePage); the queue checks for it first.
 */
export function isRetryableStatus(status: number): boolean {
  return status === 0 || status === 401 || status === 408 || status === 429 || status >= 500
}

function retryReason(status: number, online: boolean): string {
  if (!online) return 'You are offline. Your changes are kept on this device.'
  if (status === 0) return 'Could not reach the server.'
  if (status === 401) return 'You were signed out. Reload the page to sign in again.'
  return 'The server had a problem.'
}

function rejectionMessage(kind: RowKind, status: number, body: unknown): string {
  const b = isRecord(body) ? body : {}
  if (typeof b.message === 'string' && b.message) return b.message
  if (status === 404 || status === 410) {
    return kind === 'guest' ? 'This guest was removed from the list.' : 'This group was deleted.'
  }
  const issue = Array.isArray(b.issues) && typeof b.issues[0] === 'string' ? (b.issues[0] as string) : null
  if (issue) {
    const text = issue.includes(': ') ? issue.slice(issue.indexOf(': ') + 2) : issue
    return text.endsWith('.') ? text : `${text}.`
  }
  return 'The server could not accept that change.'
}

export type RowSaverOptions = {
  /**
   * The signed-in user the queue is for. Requests carry this user's id
   * (appFetchAs), and the queue is kept in their own database.
   */
  userId?: string
  /** Each new status, for the page header ("Saving…", "Saved", "Not saved, retrying"). */
  onStatus?: (status: RowSaveStatus) => void
  /** Defaults to appFetchAs(userId) (appFetch without a user). */
  fetch?: typeof fetch
  /** Where the queue is kept. Defaults to this user's IndexedDB store (none without a user); null keeps it in memory only. */
  store?: RowStore | null
  /** Awaited before start() reads the stored edits (the move of edits from before accounts, legacy-drafts.ts). */
  beforeStart?: () => Promise<void>
  /** navigator.locks, or null when there is none. */
  locks?: LockManagerLike | null
  /** This page's queue id. Defaults to one kept in sessionStorage (a reload keeps it). */
  queueId?: string
  /** Wait after an edit before sending, so the next edit of the row joins it. Default 300 ms. */
  debounceMs?: number
  /** A request with no answer after this long is dropped and tried again. Default 30 s. */
  requestTimeoutMs?: number
  random?: () => number
  isOnline?: () => boolean
  /** Receives 'online'. Defaults to window. */
  windowTarget?: EventTarget | null
  now?: () => number
  newId?: () => string
}

export interface RowSaver {
  /** Queue the changed fields of one row. */
  queue(kind: RowKind, id: string, patch: RowPatch): void
  /** The fields waiting or out for this row (merged), or null. Screens lay them over the server's copy. */
  pendingFor(kind: RowKind, id: string): RowPatch | null
  /** Every row with edits waiting or out, as "kind|id" to the merged fields. */
  pending(): Map<string, { kind: RowKind; id: string; patch: RowPatch }>
  getStatus(): RowSaveStatus
  /** Goes up on every change subscribers hear about, for React's useSyncExternalStore. */
  revision(): number
  /** After every status change, queue change and reply. Returns unsubscribe. */
  subscribe(listener: () => void): () => void
  /** Each saved or refused edit. Returns unsubscribe. */
  onEvent(listener: (event: RowSaveEvent) => void): () => void
  hasUnsavedChanges(): boolean
  /** This queue's user signed in again on this browser: after a stop for someone else's sign-in, send what is kept. */
  resume(): void
  /** Send what is waiting now, skipping the wait and any backoff. Resolves when the queue is empty or a try fails. */
  flush(options?: { keepalive?: boolean }): Promise<void>
  /** Takes over the stored edits of this queue's earlier page loads and of closed tabs, and sends them. */
  start(): Promise<void>
  dispose(): void
  /** Resolves once every store write queued so far has finished. */
  whenStored(): Promise<void>
}

type Slot = { kind: RowKind; id: string; patch: RowPatch; queuedAt: string }
type Flight = Slot & { controller: AbortController | null }

const slotKey = (kind: RowKind, id: string) => `${kind}|${id}`

/** start() stops waiting for the stored edits after this long, so a stuck database never holds up saving. */
const START_TIMEOUT_MS = 3000

function sessionQueueId(newId: () => string): string {
  try {
    const existing = window.sessionStorage.getItem(ROW_QUEUE_ID_KEY)
    if (existing) return existing
    const id = newId()
    window.sessionStorage.setItem(ROW_QUEUE_ID_KEY, id)
    return id
  } catch {
    return newId()
  }
}

function defaultLocks(): LockManagerLike | null {
  if (typeof navigator === 'undefined') return null
  return (navigator as unknown as { locks?: LockManagerLike }).locks ?? null
}

export function createRowSaver(options: RowSaverOptions = {}): RowSaver {
  const debounceMs = options.debounceMs ?? 300
  const requestTimeoutMs = options.requestTimeoutMs ?? 30_000
  const random = options.random ?? Math.random
  const now = options.now ?? (() => Date.now())
  const newId = options.newId ?? randomId
  const fetchFn: typeof fetch = options.fetch ?? (options.userId ? appFetchAs(options.userId) : appFetch)
  const store: RowStore | null =
    options.store !== undefined ? options.store : options.userId ? createRowStore({ userId: options.userId }) : null
  const locks = options.locks !== undefined ? options.locks : defaultLocks()
  const isOnline =
    options.isOnline ??
    (() => typeof navigator === 'undefined' || (navigator as { onLine?: boolean }).onLine !== false)
  const win: EventTarget | null =
    options.windowTarget !== undefined ? options.windowTarget : typeof window === 'undefined' ? null : window
  let queueId = options.queueId ?? (typeof window === 'undefined' ? newId() : sessionQueueId(newId))

  /** Waiting edits, one per row, in the order rows were first queued. */
  const waiting = new Map<string, Slot>()
  let flight: Flight | null = null
  let flightPromise: Promise<void> | null = null
  let sendTimer: ReturnType<typeof setTimeout> | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let attempt = 0
  let keepaliveNext = false
  let disposed = false
  /** Someone else signed in on this browser: nothing more is sent from this page. */
  let stopped = false
  let started: Promise<void> | null = null
  /** False while start() reads the stored edits, which are older than anything queued meanwhile. */
  let ready = true
  let releaseLock: (() => void) | null = null
  let status: RowSaveStatus = { kind: 'saved' }
  const subscribers = new Set<() => void>()
  const eventListeners = new Set<(event: RowSaveEvent) => void>()
  /** Store writes run one after another, so a later write never lands before an earlier one. */
  let storeChain: Promise<unknown> = Promise.resolve()

  let revision = 0

  function notify() {
    revision += 1
    for (const listener of [...subscribers]) {
      try {
        listener()
      } catch {
        // A broken listener must not stop saving.
      }
    }
  }

  function emit(event: RowSaveEvent) {
    for (const listener of [...eventListeners]) {
      try {
        listener(event)
      } catch {
        // As above.
      }
    }
  }

  function setStatus(next: RowSaveStatus) {
    if (JSON.stringify(next) !== JSON.stringify(status)) {
      status = next
      try {
        options.onStatus?.(next)
      } catch {
        // A broken listener must not stop saving.
      }
    }
    notify()
  }

  /** Saving while anything waits or is out; a retry keeps "retrying" until a try works. */
  function refreshStatus() {
    if (stopped) return notify()
    const busy = waiting.size > 0 || flight !== null
    if (!busy) setStatus({ kind: 'saved' })
    else if (status.kind === 'retrying') notify()
    else setStatus({ kind: 'saving' })
  }

  /** The fields of one row still to be confirmed: what is out, then what waits. */
  function combined(kind: RowKind, id: string): RowPatch | null {
    const key = slotKey(kind, id)
    const out = flight && slotKey(flight.kind, flight.id) === key ? flight.patch : null
    const wait = waiting.get(key)?.patch ?? null
    if (out && wait) return mergePatches(out, wait)
    return out ?? wait
  }

  function persist(kind: RowKind, id: string) {
    // Until start() has read the stored edits, writing would overwrite older ones; it stores these after.
    if (!store || !ready) return
    const patch = combined(kind, id)
    const key = slotKey(kind, id)
    const queuedAt =
      waiting.get(key)?.queuedAt ?? (flight && slotKey(flight.kind, flight.id) === key ? flight.queuedAt : new Date(now()).toISOString())
    const owner = queueId
    storeChain = storeChain.then(() =>
      patch ? store.put({ queueId: owner, kind, id, patch, queuedAt }) : store.remove(owner, kind, id),
    )
  }

  function clearSendTimer() {
    if (sendTimer !== null) clearTimeout(sendTimer)
    sendTimer = null
  }

  function clearRetryTimer() {
    if (retryTimer !== null) clearTimeout(retryTimer)
    retryTimer = null
  }

  function scheduleSend(delay: number) {
    if (disposed || stopped || retryTimer !== null) return
    clearSendTimer()
    sendTimer = setTimeout(() => {
      sendTimer = null
      pump()
    }, delay)
  }

  function addToWaiting(slot: Slot, front = false) {
    const key = slotKey(slot.kind, slot.id)
    const existing = waiting.get(key)
    if (existing) {
      // An edit already out goes back in front of the newer edits of its row.
      waiting.set(key, {
        ...existing,
        patch: front ? mergePatches(slot.patch, existing.patch) : mergePatches(existing.patch, slot.patch),
        queuedAt: front ? slot.queuedAt : existing.queuedAt,
      })
      return
    }
    if (!front) {
      waiting.set(key, slot)
      return
    }
    const rest = [...waiting]
    waiting.clear()
    waiting.set(key, slot)
    for (const [k, v] of rest) waiting.set(k, v)
  }

  function pump() {
    if (disposed || stopped || flight || retryTimer !== null || !ready) return
    clearSendTimer()
    const first = waiting.entries().next()
    if (first.done) {
      refreshStatus()
      return
    }
    const [key, slot] = first.value
    waiting.delete(key)
    send(slot)
  }

  function send(slot: Slot) {
    const controller = typeof AbortController === 'undefined' ? null : new AbortController()
    const current: Flight = { ...slot, controller }
    flight = current
    const keepalive = keepaliveNext
    keepaliveNext = false
    refreshStatus()
    const path = slot.kind === 'guest' ? `/api/guests/${encodeURIComponent(slot.id)}` : `/api/groups/${encodeURIComponent(slot.id)}`
    const timeout = setTimeout(() => controller?.abort(), requestTimeoutMs)
    flightPromise = (async () => {
      let statusCode = 0
      let body: unknown = null
      try {
        const res = await fetchFn(path, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(slot.patch),
          cache: 'no-store',
          credentials: 'same-origin',
          keepalive: keepalive || undefined,
          signal: controller?.signal,
        })
        statusCode = res.status
        const text = await res.text().catch(() => '')
        if (text) {
          try {
            body = JSON.parse(text)
          } catch {
            body = null
          }
        }
      } catch {
        statusCode = 0
      } finally {
        clearTimeout(timeout)
      }
      if (disposed || flight !== current) return
      flight = null
      if (isStalePage(statusCode, body)) {
        // Final for this page: the edit goes back in front, stays stored for this user, and is never sent from here again.
        addToWaiting(slot, true)
        stopped = true
        clearSendTimer()
        clearRetryTimer()
        setStatus({ kind: 'other-user', reason: OTHER_USER_REASON })
        return
      }
      if (statusCode >= 200 && statusCode < 300) {
        attempt = 0
        persist(slot.kind, slot.id)
        emit({ type: 'saved', kind: slot.kind, id: slot.id, patch: slot.patch, reply: body })
        // Out of "retrying" without a flash of "Saving…" when nothing else waits.
        if (status.kind === 'retrying') status = { kind: 'saving' }
        pump()
        refreshStatus()
        return
      }
      if (isRetryableStatus(statusCode)) {
        addToWaiting(slot, true)
        attempt += 1
        const delay = backoffDelay(attempt, random)
        retryTimer = setTimeout(() => {
          retryTimer = null
          pump()
        }, delay)
        setStatus({
          kind: 'retrying',
          attempt,
          nextTryAt: new Date(now() + delay).toISOString(),
          reason: retryReason(statusCode, isOnline()),
        })
        return
      }
      // Refused, or gone: the newer edits of this row were made on top of this one, so they go too.
      const key = slotKey(slot.kind, slot.id)
      const dropped = waiting.get(key)
      waiting.delete(key)
      const patch = dropped ? mergePatches(slot.patch, dropped.patch) : slot.patch
      persist(slot.kind, slot.id)
      emit({
        type: 'rejected',
        kind: slot.kind,
        id: slot.id,
        patch,
        status: statusCode,
        body,
        message: rejectionMessage(slot.kind, statusCode, body),
      })
      pump()
    })()
  }

  const onOnline = () => {
    if (stopped || retryTimer === null) return
    clearRetryTimer()
    pump()
  }
  win?.addEventListener('online', onOnline)

  async function holdLock(): Promise<void> {
    if (!locks) return
    const tryHold = (id: string) =>
      new Promise<boolean>((resolve) => {
        let release: () => void = () => {}
        const held = new Promise<void>((r) => {
          release = r
        })
        locks
          .request(`${ROW_LOCK_PREFIX}${id}`, { ifAvailable: true }, (lock) => {
            if (!lock || disposed) {
              resolve(false)
              return undefined
            }
            releaseLock = release
            resolve(true)
            return held
          })
          .catch(() => resolve(false))
      })
    if (await tryHold(queueId)) return
    // A duplicated tab copies sessionStorage, so its id is taken: use a fresh one.
    queueId = newId()
    try {
      window.sessionStorage.setItem(ROW_QUEUE_ID_KEY, queueId)
    } catch {
      // No sessionStorage: the id lives as long as the page.
    }
    await tryHold(queueId)
  }

  async function liveQueues(): Promise<Set<string> | null> {
    if (!locks) return null
    try {
      const snapshot = await locks.query()
      const ids = new Set<string>()
      for (const l of snapshot.held ?? []) if (l.name?.startsWith(ROW_LOCK_PREFIX)) ids.add(l.name.slice(ROW_LOCK_PREFIX.length))
      return ids
    } catch {
      return null
    }
  }

  async function adopt(): Promise<void> {
    if (options.beforeStart) await options.beforeStart().catch(() => undefined)
    await holdLock()
    if (!store || disposed) return
    const rows = await store.list()
    if (rows.length === 0) return
    const live = await liveQueues()
    const mine = rows.filter((r) => {
      if (r.queueId === queueId) return true
      // Without Web Locks no one can tell which tabs are open: take over only this page's own edits.
      return live !== null && !live.has(r.queueId)
    })
    mine.sort((a, b) => (a.queuedAt < b.queuedAt ? -1 : a.queuedAt > b.queuedAt ? 1 : 0))
    for (const row of mine) {
      if (disposed) return
      const key = slotKey(row.kind, row.id)
      const newer = waiting.get(key)
      // Stored edits are older than anything queued on this page, so the newer fields win.
      if (newer) waiting.set(key, { ...newer, patch: mergePatches(row.patch, newer.patch), queuedAt: row.queuedAt })
      else addToWaiting({ kind: row.kind, id: row.id, patch: row.patch, queuedAt: row.queuedAt })
      if (row.queueId !== queueId) {
        const from = row.queueId
        storeChain = storeChain.then(() => store.remove(from, row.kind, row.id))
      }
    }
    if (mine.length === 0) return
    // Oldest first: the stored edits were made before anything queued on this page.
    const ordered = [...waiting].sort(([, a], [, b]) => (a.queuedAt < b.queuedAt ? -1 : a.queuedAt > b.queuedAt ? 1 : 0))
    waiting.clear()
    for (const [k, v] of ordered) waiting.set(k, v)
    refreshStatus()
  }

  return {
    queue(kind, id, patch) {
      if (disposed || Object.keys(patch).length === 0) return
      addToWaiting({ kind, id, patch, queuedAt: new Date(now()).toISOString() })
      persist(kind, id)
      refreshStatus()
      scheduleSend(debounceMs)
    },
    pendingFor: combined,
    pending() {
      const out = new Map<string, { kind: RowKind; id: string; patch: RowPatch }>()
      const rows = [...(flight ? [flight] : []), ...waiting.values()]
      for (const r of rows) {
        const patch = combined(r.kind, r.id)
        if (patch) out.set(slotKey(r.kind, r.id), { kind: r.kind, id: r.id, patch })
      }
      return out
    },
    getStatus: () => status,
    revision: () => revision,
    subscribe(listener) {
      subscribers.add(listener)
      return () => void subscribers.delete(listener)
    },
    onEvent(listener) {
      eventListeners.add(listener)
      return () => void eventListeners.delete(listener)
    },
    hasUnsavedChanges: () => waiting.size > 0 || flight !== null,
    resume() {
      if (!stopped || disposed) return
      stopped = false
      attempt = 0
      refreshStatus()
      pump()
    },
    async flush(opts) {
      if (opts?.keepalive) keepaliveNext = true
      clearSendTimer()
      if (retryTimer !== null) {
        clearRetryTimer()
      }
      // Each pass sends one row; keep going while rows are left and the last try worked.
      for (let i = 0; i < 1000; i++) {
        if (!ready && started) await started
        if (flight && flightPromise) await flightPromise
        if (disposed || stopped || retryTimer !== null) return
        if (waiting.size === 0 && !flight) return
        if (!flight) pump()
        if (opts?.keepalive) keepaliveNext = true
      }
    },
    start() {
      if (!started) {
        ready = false
        const timeout = new Promise<void>((resolve) => setTimeout(resolve, START_TIMEOUT_MS))
        started = Promise.race([adopt().catch(() => undefined), timeout]).then(() => {
          ready = true
          for (const slot of waiting.values()) persist(slot.kind, slot.id)
          if (waiting.size > 0) scheduleSend(sendTimer !== null ? debounceMs : 0)
        })
      }
      return started
    },
    dispose() {
      disposed = true
      clearSendTimer()
      clearRetryTimer()
      flight?.controller?.abort()
      flight = null
      win?.removeEventListener('online', onOnline)
      releaseLock?.()
      subscribers.clear()
      eventListeners.clear()
    },
    async whenStored() {
      await storeChain.catch(() => undefined)
    },
  }
}

const queues = new Map<string, RowSaver>()

/**
 * This user's one queue for this page, made and started on first use, and
 * kept across moves between the app's pages, so a move never drops an edit.
 * Before it reads its stored edits it waits for edits from before accounts
 * to move in (legacy-drafts.ts). Signing out reaches it through the saver
 * registry.
 */
export function rowSaverFor(userId: string): RowSaver {
  let queue = queues.get(userId)
  if (!queue) {
    const made = createRowSaver({ userId, beforeStart: () => ensureLegacyAdopted(userId) })
    queue = made
    queues.set(userId, made)
    registerSaver({
      // Signing out reads this user's storage next: wait until what was sent is out of it.
      async flush() {
        await made.flush()
        await made.whenStored()
      },
      hasUnsavedChanges: () => made.hasUnsavedChanges(),
      resume: () => made.resume(),
      async stop() {
        made.dispose()
        await made.whenStored()
        queues.delete(userId)
      },
    })
    void made.start()
  }
  return queue
}

/** For a page with no signed-in user (never one of the app's screens): keeps edits in memory and sends nothing. */
let unattended: RowSaver | null = null

/** The queue of the user this page was rendered for (src/client/current-user.tsx), for the guest and group screens. */
export function pageRowSaver(): RowSaver {
  const userId = currentUserId()
  if (userId) return rowSaverFor(userId)
  unattended ??= createRowSaver({
    store: null,
    fetch: async () => Response.json({ error: 'stale_page' }, { status: 401 }),
  })
  return unattended
}
