/**
 * Unsaved edits from before accounts. Until now everyone on a device shared
 * one drafts database (`seat-plan`) and one queue of guest and group edits
 * (`seat-plan-rows`). Now each user has their own (storage-names.ts), so on a
 * signed-in page load the edits still in the old databases move into the
 * signed-in user's: whoever signs in first on the device takes them over.
 * From there the usual recovery (opening the layout) and the row queue send
 * them, or show the conflict dialog.
 *
 * For each old database, in order:
 *  1. Read everything in it. A database that does not exist is never made
 *     by looking (the upgrade that would make it is aborted).
 *  2. Copy every entry into the user's database under the same key, stamped
 *     with the user's id. An entry already there is kept, unless it is an
 *     older draft of the same tab (a draft records updatedAt).
 *  3. Read the user's database back and check every entry arrived.
 *  4. Only then remove the old database, inside a version upgrade: the
 *     upgrade has the database to itself, so it checks that nothing changed
 *     since step 1 (a tab of the older app version may still be writing to
 *     it), and drops the old store only if so. Otherwise the old database
 *     stays as it is, and the next page load moves what is new. The empty
 *     database is then deleted.
 *
 * Any failure stops before step 4, so the old database keeps every entry
 * until a later load moves them. Running it again, or in two tabs at once,
 * is safe: copies never overwrite newer entries, and only one upgrade can
 * drop the old store.
 *
 * A draft for a wedding the adopting user is not a member of stays in their
 * database: the layout cannot be opened by them, so it is never sent. A row
 * edit for such a wedding is refused (404) when sent and dropped, as for a
 * guest someone removed.
 */
import { promisifyRequest, type UseStore } from 'idb-keyval'
import { deleteDatabase, openKeyvalStore } from './idb'
import { DRAFT_STORE_NAME, draftDbName, LEGACY_DRAFT_DB_NAME, LEGACY_ROW_DB_NAME, ROW_STORE_NAME, rowDbName } from './storage-names'

export type MoveOutcome =
  /** There was no old database. */
  | 'none'
  /** Copied, checked and removed. */
  | 'moved'
  /** Copied and checked, but the old database changed meanwhile or is still open in an older tab: it stays for the next load. */
  | 'kept'
  /** Something failed; the old database was left as it was. */
  | 'failed'

export type AdoptResult = { drafts: MoveOutcome; rows: MoveOutcome }

type Entry = { key: IDBValidKey; value: unknown }
type Legacy = { version: number; hasStore: boolean; entries: Entry[] }

export type AdoptDeps = {
  /** Opens the user's database (the app's own opener by default). */
  openTarget?: (dbName: string, storeName: string) => UseStore
  /** Test hook: runs after the check, before the old database is removed. */
  beforeRemove?: (legacyDbName: string) => Promise<void>
  /** How long to wait for an older tab that keeps the old database open. Default 3,000 ms. */
  blockedWaitMs?: number
}

type Kind = 'drafts' | 'rows'

const PLANS: Record<Kind, { legacy: string; store: string; target: (userId: string) => string }> = {
  drafts: { legacy: LEGACY_DRAFT_DB_NAME, store: DRAFT_STORE_NAME, target: draftDbName },
  rows: { legacy: LEGACY_ROW_DB_NAME, store: ROW_STORE_NAME, target: rowDbName },
}

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

  const stamped = legacy.entries.map(({ key, value }) => ({ key, value: stamp(value, userId, kind) }))
  if (stamped.length > 0) {
    const target = (deps.openTarget ?? openKeyvalStore)(plan.target(userId), plan.store)
    await copyInto(target, stamped, kind)
    if (!(await allArrived(target, stamped, kind))) return 'failed'
  }

  await deps.beforeRemove?.(plan.legacy)
  const removed = await dropIfUnchanged(plan.legacy, plan.store, legacy, deps.blockedWaitMs ?? 3000)
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
  return { ...(value as Record<string, unknown>), userId }
}

function updatedAtOf(value: unknown): string | null {
  const v = value as { updatedAt?: unknown } | null
  return v && typeof v === 'object' && typeof v.updatedAt === 'string' ? v.updatedAt : null
}

/** A draft from the old database replaces the user's own copy only when it is newer (the same tab wrote it later). */
function shouldReplace(kind: Kind, incoming: unknown, existing: unknown): boolean {
  if (kind !== 'drafts') return false
  const a = updatedAtOf(incoming)
  const b = updatedAtOf(existing)
  return a !== null && (b === null || a > b)
}

/** One write transaction: each entry goes in unless the user's store already holds it (or something newer). */
function copyInto(target: UseStore, entries: Entry[], kind: Kind): Promise<void> {
  return target('readwrite', (store) => {
    for (const { key, value } of entries) {
      const request = store.get(key)
      request.onsuccess = () => {
        if (request.result === undefined || shouldReplace(kind, value, request.result)) store.put(value, key)
      }
    }
    return promisifyRequest(store.transaction).then(() => undefined)
  })
}

/** True when the user's store holds every entry (a draft at least as new as the copied one). */
function allArrived(target: UseStore, entries: Entry[], kind: Kind): Promise<boolean> {
  return target('readonly', (store) =>
    Promise.all(entries.map(({ key }) => promisifyRequest(store.get(key)))).then((found) =>
      found.every((value, i) => value !== undefined && !shouldReplace(kind, entries[i]!.value, value)),
    ),
  ).catch(() => false)
}

/**
 * Opens the old database only if it already exists, and reads it whole. Null
 * when there is none: the upgrade that would create it is aborted.
 */
function readLegacy(name: string, storeName: string): Promise<Legacy | null> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(name)
    } catch (error) {
      reject(error)
      return
    }
    let missing = false
    request.onupgradeneeded = (event) => {
      if (event.oldVersion === 0) {
        missing = true
        request.transaction?.abort()
      }
    }
    request.onerror = (event) => {
      event.preventDefault()
      if (missing) resolve(null)
      else reject(request.error)
    }
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => db.close()
      if (!db.objectStoreNames.contains(storeName)) {
        db.close()
        resolve({ version: db.version, hasStore: false, entries: [] })
        return
      }
      readAll(db, storeName).then(
        (entries) => {
          db.close()
          resolve({ version: db.version, hasStore: true, entries })
        },
        (error: unknown) => {
          db.close()
          reject(error)
        },
      )
    }
  })
}

function readAll(db: IDBDatabase, storeName: string): Promise<Entry[]> {
  const store = db.transaction(storeName, 'readonly').objectStore(storeName)
  return Promise.all([promisifyRequest(store.getAllKeys()), promisifyRequest(store.getAll())]).then(([keys, values]) =>
    keys.map((key, i) => ({ key, value: values[i] })),
  )
}

function sameEntries(keys: IDBValidKey[], values: unknown[], expected: Entry[]): boolean {
  if (keys.length !== expected.length || values.length !== expected.length) return false
  return keys.every(
    (key, i) => indexedDB.cmp(key, expected[i]!.key) === 0 && JSON.stringify(values[i]) === JSON.stringify(expected[i]!.value),
  )
}

/**
 * Drops the old store inside a version upgrade, which has the database to
 * itself, but only if it still holds exactly what was copied. 'kept' when it
 * changed, when another tab got there first, or when an older tab holds the
 * database open past `blockedWaitMs` (the upgrade then runs, with the same
 * check, once that tab lets go).
 */
function dropIfUnchanged(name: string, storeName: string, legacy: Legacy, blockedWaitMs: number): Promise<MoveOutcome> {
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
      request = indexedDB.open(name, legacy.version + 1)
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
      const store = tx.objectStore(storeName)
      const keys = store.getAllKeys()
      const values = store.getAll()
      values.onsuccess = () => {
        if (sameEntries(keys.result, values.result, legacy.entries)) {
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
      // Aborted because it was already gone: done. Aborted because it changed, a
      // version another tab moved past, or any other failure: the old store
      // stays as it is (even if this upgrade had dropped it, the drop is undone).
      settle(alreadyGone ? 'moved' : 'kept')
    }
  })
}
