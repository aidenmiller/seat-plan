/**
 * The layout save engine (PLAN section 5, "Saving layouts").
 *
 * - Every finished edit goes straight into this tab's IndexedDB draft.
 * - A save goes out 1 s after the last edit, and at most 5 s after the first
 *   edit not yet sent, so steady editing still saves.
 * - One save is in flight per tab. The draft records that snapshot and its
 *   saveId before the request leaves; every retry resends exactly that body,
 *   so the server's saved-twice protection makes retries harmless. Edits made
 *   meanwhile go out in the next save, from the version the first one returns.
 * - Every draft write reports whether it was stored; the 'offline' and
 *   'retrying' statuses carry that, so the editor can say when closing the
 *   page would lose the edit.
 * - An already-saved reply may carry the version of an older save (the retry
 *   landed earlier and someone saved since). That version becomes the base,
 *   so the next save meets the newer one as a conflict instead of writing
 *   over it.
 * - 409 stops saving until resetTo() (the editor shows the conflict dialog).
 *   410 and 422 stop for good. 401 stops until the page is shown again or
 *   flush() is called, keeping the draft. Network errors and 5xx retry with
 *   backoff, and at once when the browser comes back online or the page is
 *   shown again.
 * - 401 stale_page (someone else signed in on this browser since the page
 *   opened) stops for good in this tab: nothing is sent from it again, not
 *   even when the page is shown again, so one person's edits never go out
 *   under another's session. The draft stays in this user's storage; once
 *   they sign in again and open the layout, recovery sends it.
 * - Every request is sent as the user the saver was made for (appFetchAs),
 *   and every draft is stamped with that user's id.
 */
import type { Canvas } from '@/domain/canvas-schema'
import type { LayoutVersionInfo, SaveLayoutBody, SaveLayoutConflict, SaveLayoutOk } from '@/shared/api'
import { appFetchAs, isStalePage } from '../http'
import { backoffDelay } from './backoff'
import { draftStoreFor } from './outbox'
import { randomId } from './random-id'
import type { DraftSnapshot, DraftStore, FailedReason, FlushOptions, LayoutSaver, LayoutSaverOptions, SaveRequest, SaveStatus } from './types'

/** Browsers refuse keepalive requests whose bodies add up to more than 64 KiB. */
export const KEEPALIVE_LIMIT_BYTES = 60_000

export const MESSAGES = {
  gone: 'This layout was deleted, so changes cannot be saved.',
  invalid: 'The server could not save this layout.',
  signedOut: 'You were signed out. Sign in again to keep saving. Your changes are kept on this device.',
  forbidden: 'You can no longer change this layout, so changes here cannot be saved. Your changes are kept on this device.',
  otherUser: 'Someone else signed in on this browser. Sign in again to save your changes. They are kept on this device.',
  network: 'No answer from the server.',
  timeout: 'The server took too long to answer.',
  unreadable: 'The server sent an answer the app could not read.',
} as const

type Flight<T> = {
  saveId: string
  baseVersion: number
  canvas: T
  /** The edit counter this snapshot carries. */
  seq: number
}

type Mode = 'active' | 'conflict' | 'failed' | 'disposed'

/** The layout save body (PUT /api/layouts/:id). */
function layoutBody(r: SaveRequest<Canvas>): SaveLayoutBody {
  return { baseVersion: r.baseVersion, saveId: r.saveId, tabId: r.tabId, canvas: r.doc }
}

/**
 * T is the saved document, a layout's canvas by default. Another document
 * (the venue template's fixed items) passes `endpoint` and `body`, and its
 * own `drafts` store.
 */
export function createLayoutSaver<T = Canvas>(options: LayoutSaverOptions<T>): LayoutSaver<T> {
  const { layoutId, tabId, userId } = options
  if (!userId) throw new Error('A saver needs the signed-in user')
  const endpoint = options.endpoint ?? `/api/layouts/${encodeURIComponent(layoutId)}`
  const buildBody = options.body ?? (layoutBody as unknown as (r: SaveRequest<T>) => unknown)
  const messages = { ...MESSAGES, ...options.messages }
  const debounceMs = options.debounceMs ?? 1000
  const maxWaitMs = Math.max(options.maxWaitMs ?? 5000, debounceMs)
  const requestTimeoutMs = options.requestTimeoutMs ?? 30_000
  const draftWaitMs = options.draftWaitMs ?? 2000
  const drafts = options.drafts ?? (draftStoreFor(userId) as unknown as DraftStore<T>)
  const random = options.random ?? Math.random
  const fetchFn: typeof fetch = options.fetch ?? appFetchAs(userId)
  const isOnline =
    options.isOnline ??
    (() => typeof navigator === 'undefined' || (navigator as { onLine?: boolean }).onLine !== false)
  const win: EventTarget | null =
    options.windowTarget !== undefined ? options.windowTarget : typeof window === 'undefined' ? null : window
  const doc: (EventTarget & { visibilityState?: string }) | null =
    options.documentTarget !== undefined
      ? options.documentTarget
      : typeof document === 'undefined'
        ? null
        : document

  let mode: Mode = 'active'
  let failedReason: FailedReason | null = null
  let baseVersion = options.baseVersion
  /** The newest canvas from noteEdit. */
  let latest: T | null = null
  /** Counts edits; confirmedSeq is the newest edit the server has. */
  let latestSeq = 0
  let confirmedSeq = 0
  /** The snapshot being sent, or waiting to be sent again. */
  let flight: Flight<T> | null = null
  let requestActive = false
  let currentRequest: Promise<void> | null = null
  let activeAbort: AbortController | null = null
  let attempt = 0
  let firstUnsentAt: number | null = null
  /** The debounce fired while a flight was busy; send as soon as it ends. */
  let sendRequested = false
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  /** Bumped by resetTo and dispose, so late replies from before are ignored. */
  let generation = 0
  let draftChain: Promise<unknown> = Promise.resolve()
  /** False when the last draft write failed. */
  let storedLocally = true
  let status: SaveStatus = { kind: 'saved', at: new Date().toISOString() }
  const subscribers = new Set<() => void>()

  // ---------- status ----------

  function notify() {
    for (const listener of [...subscribers]) {
      try {
        listener()
      } catch {
        // A broken listener must not stop saving.
      }
    }
  }

  function setStatus(next: SaveStatus) {
    if (JSON.stringify(next) === JSON.stringify(status)) return
    status = next
    try {
      options.onStatus(next)
    } catch {
      // As above.
    }
    notify()
  }

  const dirty = () => latestSeq !== confirmedSeq

  // ---------- drafts ----------

  /** Queue a write of the current state. Writes run one after another, in call order. */
  function queueDraftWrite(): Promise<unknown> {
    if (!latest) return draftChain
    const snapshot: DraftSnapshot<T> = {
      layoutId,
      tabId,
      baseVersion,
      canvas: latest,
      userId,
      inFlight: flight ? { saveId: flight.saveId, baseVersion: flight.baseVersion, canvas: flight.canvas } : null,
      dirty: dirty(),
      updatedAt: new Date().toISOString(),
    }
    draftChain = draftChain
      .then(() => drafts.putDraft(snapshot))
      .then(
        (stored) => noteStored(stored === true),
        () => noteStored(false),
      )
    return draftChain
  }

  /** Remember whether the draft write worked, and refresh a status that says so. */
  function noteStored(stored: boolean) {
    if (stored === storedLocally) return
    storedLocally = stored
    if (mode === 'disposed') return
    if (status.kind === 'offline') setStatus({ kind: 'offline', storedLocally })
    else if (status.kind === 'retrying') setStatus({ ...status, storedLocally })
    else notify()
  }

  function queueDraftDelete(): Promise<unknown> {
    draftChain = draftChain.then(() => drafts.deleteDraft(layoutId, tabId)).catch(() => undefined)
    return draftChain
  }

  /** Wait for a draft write, but never let a stuck IndexedDB hold saving up for long. */
  function waitAtMost(promise: Promise<unknown>, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms)
      void promise.then(() => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  // ---------- timers ----------

  function clearDebounce() {
    if (debounceTimer !== null) clearTimeout(debounceTimer)
    debounceTimer = null
  }

  function clearRetry() {
    if (retryTimer !== null) clearTimeout(retryTimer)
    retryTimer = null
  }

  function scheduleDebounce() {
    clearDebounce()
    const now = Date.now()
    const untilMax = firstUnsentAt === null ? debounceMs : firstUnsentAt + maxWaitMs - now
    debounceTimer = setTimeout(onDebounce, Math.max(0, Math.min(debounceMs, untilMax)))
  }

  function onDebounce() {
    debounceTimer = null
    if (mode !== 'active') return
    // A save is in flight or waiting to retry: these edits go out right after it.
    if (flight) {
      sendRequested = true
      return
    }
    void send()
  }

  // ---------- sending ----------

  function send(opts: FlushOptions = {}): Promise<void> {
    if (mode !== 'active' || requestActive) return currentRequest ?? Promise.resolve()
    if (!flight) {
      if (!dirty() || !latest) return Promise.resolve()
      if (!isOnline()) {
        setStatus({ kind: 'offline', storedLocally })
        return Promise.resolve()
      }
      flight = { saveId: randomId(), baseVersion, canvas: latest, seq: latestSeq }
      attempt = 0
      firstUnsentAt = null
      sendRequested = false
      clearDebounce()
    } else if (!isOnline()) {
      // Still offline when the retry came due: wait again (the 'online' event usually comes first).
      retryLater(messages.network)
      return Promise.resolve()
    }
    clearRetry()
    requestActive = true
    const request = attemptSend(flight, opts, generation).finally(() => {
      if (currentRequest === request) currentRequest = null
    })
    currentRequest = request
    return request
  }

  async function attemptSend(f: Flight<T>, opts: FlushOptions, gen: number): Promise<void> {
    const body = JSON.stringify(buildBody({ baseVersion: f.baseVersion, saveId: f.saveId, tabId, doc: f.canvas }))
    setStatus({ kind: 'saving' })

    // The draft names this snapshot and saveId before the request leaves, so a
    // tab that dies mid-request can tell on the next load whether it landed.
    const written = queueDraftWrite()
    // On page hide there is no time to wait: the write and the request start together.
    if (!opts.keepalive) await waitAtMost(written, draftWaitMs)
    if (gen !== generation) return

    const keepalive = opts.keepalive === true && byteLength(body) < KEEPALIVE_LIMIT_BYTES
    const controller = new AbortController()
    activeAbort = controller
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, requestTimeoutMs)

    let res: Response
    let data: unknown = null
    try {
      res = await fetchFn(endpoint, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive,
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal,
      })
      try {
        data = await res.json()
      } catch {
        data = null
      }
    } catch {
      clearTimeout(timeout)
      if (gen !== generation) return
      endRequest()
      retryLater(timedOut ? messages.timeout : messages.network)
      return
    }
    clearTimeout(timeout)
    if (gen !== generation) return
    endRequest()
    handleReply(f, res.status, data)
  }

  function endRequest() {
    requestActive = false
    activeAbort = null
  }

  function handleReply(f: Flight<T>, httpStatus: number, data: unknown) {
    if (httpStatus >= 200 && httpStatus < 300) {
      const ok = data as Partial<SaveLayoutOk> | null
      if (!ok || typeof ok.version !== 'number' || (ok.status !== 'saved' && ok.status !== 'already-saved')) {
        retryLater(messages.unreadable)
        return
      }
      onSaved(f, ok as SaveLayoutOk)
      return
    }
    if (httpStatus === 409) return onConflict(data)
    // Checked before the plain 401: this one must never be retried from this tab.
    if (isStalePage(httpStatus, data)) return stopWithFailure('other-user', messages.otherUser)
    if (httpStatus === 403) return stopWithFailure('forbidden', messages.forbidden)
    if (httpStatus === 401) return stopWithFailure('signed-out', messages.signedOut)
    if (httpStatus === 410 || httpStatus === 404) return stopWithFailure('gone', messages.gone)
    if (httpStatus === 408 || httpStatus === 429 || httpStatus >= 500) {
      retryLater(`The server answered ${httpStatus}.`)
      return
    }
    // 400, 413, 422 and the like: sending the same body again cannot help.
    stopWithFailure('invalid', messages.invalid)
  }

  function onSaved(f: Flight<T>, ok: SaveLayoutOk) {
    // For already-saved this may be older than the server's version: the next
    // save then meets the newer one as a 409, as it should.
    baseVersion = ok.version
    confirmedSeq = Math.max(confirmedSeq, f.seq)
    flight = null
    attempt = 0
    if (Array.isArray(ok.droppedSeats) && ok.droppedSeats.length > 0) {
      try {
        options.onDroppedSeats(ok.droppedSeats)
      } catch {
        // The save landed either way.
      }
    }
    if (!dirty()) {
      clearDebounce()
      firstUnsentAt = null
      sendRequested = false
      void queueDraftDelete()
      setStatus({ kind: 'saved', at: ok.updatedAt ?? new Date().toISOString() })
      notify()
      return
    }
    // Edits made while the save was out: record the new base, then send them.
    void queueDraftWrite()
    setStatus({ kind: 'saving' })
    const overdue = firstUnsentAt !== null && Date.now() - firstUnsentAt >= maxWaitMs
    if (sendRequested || overdue || debounceTimer === null) {
      sendRequested = false
      void send()
    }
    notify()
  }

  function onConflict(data: unknown) {
    const c = (data ?? {}) as Partial<SaveLayoutConflict>
    const server: LayoutVersionInfo = {
      version: typeof c.version === 'number' ? c.version : baseVersion,
      updatedAt: typeof c.updatedAt === 'string' ? c.updatedAt : new Date().toISOString(),
      editedBy: typeof c.editedBy === 'string' ? c.editedBy : null,
      editedById: typeof c.editedById === 'string' ? c.editedById : null,
      lastSaveId: typeof c.lastSaveId === 'string' ? c.lastSaveId : null,
      recentSaveIds: Array.isArray(c.recentSaveIds) ? c.recentSaveIds.filter((id) => typeof id === 'string') : [],
    }
    mode = 'conflict'
    clearDebounce()
    clearRetry()
    sendRequested = false
    setStatus({ kind: 'conflict', server })
  }

  function stopWithFailure(reason: FailedReason, message: string) {
    mode = 'failed'
    failedReason = reason
    clearDebounce()
    clearRetry()
    sendRequested = false
    setStatus({ kind: 'failed', reason, message })
  }

  function retryLater(reason: string) {
    if (mode !== 'active') return
    attempt += 1
    clearRetry()
    const delay = backoffDelay(attempt, random)
    retryTimer = setTimeout(() => {
      retryTimer = null
      void send()
    }, delay)
    // Offline: the 'online' event retries at once; the timer is a fallback for browsers that miss it.
    if (!isOnline()) setStatus({ kind: 'offline', storedLocally })
    else
      setStatus({
        kind: 'retrying',
        attempt,
        nextTryAt: new Date(Date.now() + delay).toISOString(),
        reason,
        storedLocally,
      })
  }

  /**
   * Something suggests the server may be reachable now: skip the wait. A tab
   * stopped for signing out tries again (the same person may have signed in
   * again); one stopped because someone else signed in never does.
   */
  function retryNow() {
    if (mode === 'failed' && failedReason === 'signed-out') {
      mode = 'active'
      failedReason = null
    }
    if (mode !== 'active' || requestActive) return
    if (flight) {
      clearRetry()
      void send()
    } else if (dirty() && (status.kind === 'offline' || status.kind === 'retrying')) {
      void send()
    }
  }

  // ---------- browser events ----------

  const onOnline = () => retryNow()
  const onOffline = () => {
    if (mode === 'active' && dirty() && !requestActive) setStatus({ kind: 'offline', storedLocally })
  }
  const onVisibility = () => {
    if (doc?.visibilityState !== 'hidden') retryNow()
  }
  win?.addEventListener('online', onOnline)
  win?.addEventListener('offline', onOffline)
  doc?.addEventListener('visibilitychange', onVisibility)

  // ---------- public ----------

  return {
    noteEdit(canvas) {
      if (mode === 'disposed' || canvas === latest) return
      latest = canvas
      latestSeq += 1
      void queueDraftWrite()
      if (mode === 'active') {
        if (firstUnsentAt === null) firstUnsentAt = Date.now()
        scheduleDebounce()
        if (status.kind === 'saved') setStatus({ kind: 'saving' })
      }
      notify()
    },

    async flush(opts = {}) {
      if (mode === 'failed' && failedReason === 'signed-out') {
        mode = 'active'
        failedReason = null
      }
      if (mode !== 'active') return
      if (requestActive) {
        // The page is going away: the draft already holds anything newer.
        if (opts.keepalive) return
        sendRequested = sendRequested || dirty()
        while (currentRequest) await currentRequest
        return
      }
      clearDebounce()
      clearRetry()
      await send(opts)
      if (!opts.keepalive) while (currentRequest) await currentRequest
    },

    hasUnsavedChanges() {
      return dirty()
    },

    async resetTo(version) {
      // Someone else is signed in: keep this user's draft as it is, for when they sign in again.
      if (mode === 'failed' && failedReason === 'other-user') return
      generation += 1
      activeAbort?.abort()
      activeAbort = null
      requestActive = false
      currentRequest = null
      clearDebounce()
      clearRetry()
      baseVersion = version
      flight = null
      latest = null
      confirmedSeq = latestSeq
      attempt = 0
      firstUnsentAt = null
      sendRequested = false
      failedReason = null
      if (mode !== 'disposed') mode = 'active'
      await queueDraftDelete()
      if (mode !== 'disposed') setStatus({ kind: 'saved', at: new Date().toISOString() })
      notify()
    },

    dispose() {
      if (mode === 'disposed') return
      mode = 'disposed'
      generation += 1
      requestActive = false
      currentRequest = null
      activeAbort = null
      clearDebounce()
      clearRetry()
      win?.removeEventListener('online', onOnline)
      win?.removeEventListener('offline', onOffline)
      doc?.removeEventListener('visibilitychange', onVisibility)
      subscribers.clear()
    },

    getStatus() {
      return status
    },

    getBaseVersion() {
      return baseVersion
    },

    subscribe(listener) {
      subscribers.add(listener)
      return () => {
        subscribers.delete(listener)
      }
    },

    async whenStored() {
      await draftChain
    },

    isStoredLocally() {
      return storedLocally
    },
  }
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}
