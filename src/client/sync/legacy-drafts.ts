/**
 * Unsaved edits from before accounts. Until now everyone on a device shared
 * one drafts database (`seat-plan`) and one queue of guest and group edits
 * (`seat-plan-rows`). Now each user has their own (storage-names.ts), so on a
 * signed-in page load the edits still in the old databases move into the
 * signed-in user's: whoever signs in first on the device takes them over.
 * From there the usual recovery (opening the layout) and the row queue send
 * them, or show the conflict dialog.
 *
 * Each old entry is adopted once, ever. The old database can outlive a move
 * (a tab of the older app version keeps it open, or the page goes away
 * first), and meanwhile the row queue sends the copied edits and removes
 * them, and the editor saves a copied draft and removes it. Copying such an
 * entry again would send an old edit a second time, over anything saved
 * since. So every adopted entry is noted by a hash of its key and content:
 * in the user's database, in the same transaction as the copy, and in this
 * device's record (localStorage), which outlives a sign-out. An entry an
 * older tab writes or changes later has a new hash, and is adopted once too.
 *
 * For each old database, in order:
 *  1. Read everything in it. A database that does not exist is never made
 *     by looking (the upgrade that would make it is aborted).
 *  2. In one transaction on the user's database, copy every entry not
 *     adopted before under the same key, stamped with the user's id, and
 *     note it as adopted. An entry already in the user's database is kept,
 *     unless it is an older draft of the same tab (a draft records
 *     updatedAt) or an earlier copy of the same old row, not yet sent.
 *  3. Read the user's database back and check every entry is noted.
 *  4. Take every adopted entry out of the old database, each only if it
 *     still holds exactly what was adopted (an older tab may have changed it
 *     since; the change then moves on the next load).
 *  5. Remove the old database if it is now empty, inside a version upgrade:
 *     the upgrade has the database to itself, so nothing can be written to
 *     it meanwhile. Otherwise the old database stays, and the next page load
 *     moves what is new. The empty database is then deleted.
 *
 * Any failure stops there: an entry leaves the old database only once its
 * copy is in the user's. Running it again, or in two tabs at once, is safe:
 * an entry noted as adopted is never copied again, and only one upgrade can
 * drop the old store.
 *
 * A draft for a wedding the adopting user is not a member of stays in their
 * database: the layout cannot be opened by them, so it is never sent. A row
 * edit for such a wedding is refused (404) when sent and dropped, as for a
 * guest someone removed.
 */
import { promisifyRequest, type UseStore } from 'idb-keyval'
import { deleteDatabase, openExistingDatabase, openKeyvalStore, readAllEntries, type StoredEntry } from './idb'
import { DRAFT_STORE_NAME, draftDbName, LEGACY_DRAFT_DB_NAME, LEGACY_ROW_DB_NAME, ROW_STORE_NAME, rowDbName } from './storage-names'

export type MoveOutcome =
  /** There was no old database. */
  | 'none'
  /** Copied, checked and removed. */
  | 'moved'
  /** Copied, checked and taken out of the old database, which changed meanwhile or is still open in an older tab: it stays for the next load. */
  | 'kept'
  /** Something failed; nothing left the old database that is not in the user's too. */
  | 'failed'

export type AdoptResult = { drafts: MoveOutcome; rows: MoveOutcome }

type Entry = StoredEntry
/** An old entry and the hash it is noted as adopted by. */
type Marked = Entry & { mark: string }
type Legacy = { version: number; hasStore: boolean; entries: Entry[] }

/** The parts of localStorage the device's record uses. */
export type RecordStorage = Pick<Storage, 'getItem' | 'setItem'>

export type AdoptDeps = {
  /** Opens the user's database (the app's own opener by default). */
  openTarget?: (dbName: string, storeName: string) => UseStore
  /** Test hook: runs after the copy is checked, before the adopted entries are taken out of the old database. */
  afterCopy?: (legacyDbName: string) => Promise<void>
  /** Test hook: runs after the adopted entries are taken out, before the old database is removed. */
  beforeRemove?: (legacyDbName: string) => Promise<void>
  /** How long to wait for an older tab that keeps the old database open. Default 3,000 ms. */
  blockedWaitMs?: number
  /** This device's record of adopted entries. Default localStorage; null keeps none. */
  deviceRecord?: RecordStorage | null
}

type Kind = 'drafts' | 'rows'

const PLANS: Record<Kind, { legacy: string; store: string; target: (userId: string) => string }> = {
  drafts: { legacy: LEGACY_DRAFT_DB_NAME, store: DRAFT_STORE_NAME, target: draftDbName },
  rows: { legacy: LEGACY_ROW_DB_NAME, store: ROW_STORE_NAME, target: rowDbName },
}

/** Where the user's database notes an adopted entry (never a draft's or a row's key, so neither store hands it out). */
export const ADOPTED_MARK_PREFIX = 'legacy-adopted:'
/** This device's record of adopted entries: their hashes only. */
export const ADOPTED_RECORD_KEY = 'seat-plan:legacy-adopted'
/** The record keeps the newest this many hashes. */
const RECORD_LIMIT = 2000

/** Moves the old shared databases' entries into this user's databases. Never throws. */
export async function adoptLegacyDrafts(userId: string, deps: AdoptDeps = {}): Promise<AdoptResult> {
  if (!userId || typeof indexedDB === 'undefined') return { drafts: 'none', rows: 'none' }
  const drafts = await moveOne('drafts', userId, deps).catch((): MoveOutcome => 'failed')
  const rows = await moveOne('rows', userId, deps).catch((): MoveOutcome => 'failed')
  return { drafts, rows }
}

const started = new Map<string, Promise<void>>()

/**
 * adoptLegacyDrafts once per page and user. The editor and the row queue wait
 * for it (with a time limit) before they read the user's stored edits.
 */
export function ensureLegacyAdopted(userId: string): Promise<void> {
  let run = started.get(userId)
  if (!run) {
    run = adoptLegacyDrafts(userId).then(
      () => undefined,
      () => undefined,
    )
    started.set(userId, run)
  }
  return run
}

/** ensureLegacyAdopted, but never waits longer than `ms`: a stuck database must not hold the page up. */
export function legacyAdoptedWithin(userId: string, ms = 3000): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    void ensureLegacyAdopted(userId).then(() => {
      clearTimeout(timer)
      resolve()
    })
  })
}

async function moveOne(kind: Kind, userId: string, deps: AdoptDeps): Promise<MoveOutcome> {
  const plan = PLANS[kind]
  const legacy = await readLegacy(plan.legacy, plan.store)
  if (!legacy) return 'none'
  if (!legacy.hasStore) {
    // Left from an earlier move whose last step did not finish: no store, so nothing in it and nothing can write to it.
    await deleteDatabase(plan.legacy, 1000)
    return 'moved'
  }

  if (legacy.entries.length > 0) {
    const marked: Marked[] = legacy.entries.map((entry) => ({ ...entry, mark: markOf(kind, entry) }))
    const record = deviceRecord(deps)
    const adoptedElsewhere = record.read()
    const fresh = marked.filter((entry) => !adoptedElsewhere.has(entry.mark))
    if (fresh.length > 0) {
      const target = (deps.openTarget ?? openKeyvalStore)(plan.target(userId), plan.store)
      await copyInto(target, fresh, kind, userId)
      if (!(await allNoted(target, fresh))) return 'failed'
      record.add(fresh.map((entry) => entry.mark))
    }
    await deps.afterCopy?.(plan.legacy)
    await takeOut(plan.legacy, plan.store, marked)
  }

  await deps.beforeRemove?.(plan.legacy)
  const removed = await dropIfEmpty(plan.legacy, plan.store, legacy.version, deps.blockedWaitMs ?? 3000)
  if (removed === 'moved') await deleteDatabase(plan.legacy, 1000)
  return removed
}

/** The entry as the user's store keeps it: stamped with their id. A draft's old editedBy name is dropped (the server names the editor now). */
function stamp(value: unknown, userId: string, kind: Kind): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  if (kind === 'drafts') {
    const draft: Record<string, unknown> = { ...(value as Record<string, unknown>), userId }
    delete draft.editedBy
    return draft
  }
  // legacyCopy: this row is still the copy of the old one. The queue drops the flag once it takes the row over.
  return { ...(value as Record<string, unknown>), userId, legacyCopy: true }
}

function updatedAtOf(value: unknown): string | null {
  const v = value as { updatedAt?: unknown } | null
  return v && typeof v === 'object' && typeof v.updatedAt === 'string' ? v.updatedAt : null
}

function isLegacyCopy(value: unknown): boolean {
  return Boolean(value) && typeof value === 'object' && (value as { legacyCopy?: unknown }).legacyCopy === true
}

/**
 * Whether an old entry not adopted before goes in over what the user's store
 * holds under its key. A draft only when it is newer (the same tab wrote it
 * later). A row only over an earlier copy of the same old row that the queue
 * has not taken over yet: the old tab's queue kept that row up to date since.
 */
function shouldPut(kind: Kind, incoming: unknown, existing: unknown): boolean {
  if (existing === undefined) return true
  if (kind === 'drafts') {
    const a = updatedAtOf(incoming)
    const b = updatedAtOf(existing)
    return a !== null && (b === null || a > b)
  }
  return isLegacyCopy(existing) && JSON.stringify(existing) !== JSON.stringify(incoming)
}

/** One write transaction: each entry not noted as adopted goes in (see shouldPut), and is noted. */
function copyInto(target: UseStore, entries: Marked[], kind: Kind, userId: string): Promise<void> {
  const at = new Date().toISOString()
  return target('readwrite', (store) => {
    for (const entry of entries) {
      const markKey = ADOPTED_MARK_PREFIX + entry.mark
      const noted = store.get(markKey)
      noted.onsuccess = () => {
        // Adopted before: its copy may have been sent and removed already. Never again.
        if (noted.result !== undefined) return
        const existing = store.get(entry.key)
        existing.onsuccess = () => {
          const incoming = stamp(entry.value, userId, kind)
          if (shouldPut(kind, incoming, existing.result)) store.put(incoming, entry.key)
          store.put({ adoptedAt: at }, markKey)
        }
      }
    }
    return promisifyRequest(store.transaction).then(() => undefined)
  })
}

/** True when the user's store notes every entry as adopted. */
function allNoted(target: UseStore, entries: Marked[]): Promise<boolean> {
  return target('readonly', (store) =>
    Promise.all(entries.map((entry) => promisifyRequest(store.get(ADOPTED_MARK_PREFIX + entry.mark)))).then((found) =>
      found.every((value) => value !== undefined),
    ),
  ).catch(() => false)
}

/** Takes each adopted entry out of the old database, only if it still holds exactly what was adopted. */
async function takeOut(name: string, storeName: string, entries: Entry[]): Promise<void> {
  const db = await openExistingDatabase(name)
  if (!db) return
  try {
    if (!db.objectStoreNames.contains(storeName)) return
    const tx = db.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    for (const { key, value } of entries) {
      const current = store.get(key)
      current.onsuccess = () => {
        if (current.result !== undefined && JSON.stringify(current.result) === JSON.stringify(value)) store.delete(key)
      }
    }
    await promisifyRequest(tx)
  } finally {
    db.close()
  }
}

/** Reads the old database whole, or null when there is none (looking never makes one). */
async function readLegacy(name: string, storeName: string): Promise<Legacy | null> {
  const db = await openExistingDatabase(name)
  if (!db) return null
  try {
    if (!db.objectStoreNames.contains(storeName)) return { version: db.version, hasStore: false, entries: [] }
    return { version: db.version, hasStore: true, entries: await readAllEntries(db, storeName) }
  } finally {
    db.close()
  }
}

/**
 * Drops the old store inside a version upgrade, which has the database to
 * itself, but only if it is empty. 'kept' when something is in it, when
 * another tab got there first, or when an older tab holds the database open
 * past `blockedWaitMs` (the upgrade then runs, with the same check, once that
 * tab lets go).
 */
function dropIfEmpty(name: string, storeName: string, version: number, blockedWaitMs: number): Promise<MoveOutcome> {
  return new Promise((resolve) => {
    let settled = false
    const settle = (outcome: MoveOutcome) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(outcome)
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(name, version + 1)
    } catch {
      settle('failed')
      return
    }
    /** What the upgrade found; null until it ran. */
    let found: MoveOutcome | null = null
    /** Another tab already removed the database, and this upgrade, which would make a new one, was aborted. */
    let alreadyGone = false
    request.onblocked = () => {
      timer ??= setTimeout(() => settle('kept'), blockedWaitMs)
    }
    request.onupgradeneeded = (event) => {
      const tx = request.transaction
      const db = request.result
      if (!tx) return
      if (event.oldVersion === 0) {
        alreadyGone = true
        tx.abort()
        return
      }
      if (!db.objectStoreNames.contains(storeName)) {
        found = 'moved'
        return
      }
      const count = tx.objectStore(storeName).count()
      count.onsuccess = () => {
        if (count.result === 0) {
          db.deleteObjectStore(storeName)
          found = 'moved'
        } else {
          found = 'kept'
          tx.abort()
        }
      }
    }
    request.onsuccess = () => {
      request.result.close()
      // No upgrade ran: another tab moved the version on first, and does the rest.
      settle(found ?? 'kept')
    }
    request.onerror = (event) => {
      event.preventDefault()
      // Aborted because it was already gone: done. Aborted because something is
      // in it, a version another tab moved past, or any other failure: the old
      // store stays as it is (even if this upgrade had dropped it, the drop is undone).
      settle(alreadyGone ? 'moved' : 'kept')
    }
  })
}

// ---------- Noting adopted entries ----------

/** The hash an old entry is noted as adopted by: its database, key and exact content. */
function markOf(kind: Kind, { key, value }: Entry): string {
  const text = JSON.stringify([typeof key === 'string' ? key : JSON.stringify(key), value])
  return `${kind}:${text.length.toString(36)}:${hash53(text)}`
}

/** cyrb53: a fast 53-bit string hash, plenty to tell a handful of old entries apart. */
function hash53(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

function defaultRecordStorage(): RecordStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/**
 * This device's record of adopted entries, kept across sign-outs, so the next
 * person to sign in never takes over (and sends again) what someone before
 * them adopted. Blocked storage keeps no record; the user's own notes still hold.
 */
function deviceRecord(deps: AdoptDeps) {
  const storage = deps.deviceRecord !== undefined ? deps.deviceRecord : defaultRecordStorage()
  const readList = (): string[] => {
    try {
      const parsed: unknown = JSON.parse(storage?.getItem(ADOPTED_RECORD_KEY) ?? '[]')
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
    } catch {
      return []
    }
  }
  return {
    read: () => new Set(readList()),
    add(marks: string[]) {
      if (!storage || marks.length === 0) return
      try {
        const list = readList().filter((mark) => !marks.includes(mark))
        storage.setItem(ADOPTED_RECORD_KEY, JSON.stringify([...list, ...marks].slice(-RECORD_LIMIT)))
      } catch {
        // Full or blocked: the user's own notes still keep these from being copied again.
      }
    },
  }
}
