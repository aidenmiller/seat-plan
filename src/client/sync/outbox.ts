/**
 * The IndexedDB outbox: one draft per layout and tab (PLAN section 5,
 * "Drafts"), keyed `layout:<layoutId>:<tabId>`.
 *
 * Each signed-in user has their own database, `seat-plan-u-<userId>`
 * (draftStoreFor). On a shared device the next person to sign in never sees,
 * and never sends, the last person's unsaved edits. There is no shared store
 * to fall back to: every draft is stamped with its user's id, and a store
 * refuses to write or return a draft of anyone else. Drafts from before
 * accounts, in the old shared `seat-plan` database, are moved into the first
 * signed-in user's store by legacy-drafts.ts.
 *
 * Storage can fail: private windows, a full disk, Safari dropping the
 * connection, or no IndexedDB at all during server rendering. Every function
 * here swallows those errors, reports them to the listeners registered with
 * onStorageError, and answers as if nothing was stored, so saving to the
 * server carries on regardless.
 *
 * After any failure the store forgets its database connection, so the next
 * call opens the database again. WebKit drops IndexedDB connections when the
 * app sits in the background, and a dropped connection fails every
 * transaction until it is reopened.
 */
import { del, entries, get, set, type UseStore } from 'idb-keyval'
import { canvasSchema } from '@/domain/canvas-schema'
import { openKeyvalStore } from './idb'
import { DRAFT_STORE_NAME, draftDbName } from './storage-names'
import type { DraftSnapshot, DraftStore } from './types'

export { DRAFT_STORE_NAME, draftDbName }

export type StorageOperation = 'put' | 'get' | 'list' | 'delete'
export type StorageErrorListener = (error: unknown, operation: StorageOperation) => void

const listeners = new Set<StorageErrorListener>()

/** Hear about storage failures (to show "This device is not keeping a copy"). Returns an unsubscribe function. */
export function onStorageError(listener: StorageErrorListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function report(error: unknown, operation: StorageOperation, extra?: StorageErrorListener) {
  extra?.(error, operation)
  for (const listener of listeners) {
    try {
      listener(error, operation)
    } catch {
      // A broken listener must not break saving.
    }
  }
}

export function draftKey(layoutId: string, tabId: string): string {
  return `layout:${layoutId}:${tabId}`
}

function draftPrefix(layoutId: string): string {
  return `layout:${layoutId}:`
}

/**
 * A stored value is used only if it still has the draft's shape and a canvas
 * the current schema accepts, so a draft from an older app version can never
 * break the editor. Such a draft is reported and left in place.
 */
export function isDraftSnapshot(value: unknown): value is DraftSnapshot {
  if (!value || typeof value !== 'object') return false
  const d = value as Record<string, unknown>
  if (typeof d.layoutId !== 'string' || typeof d.tabId !== 'string') return false
  if (typeof d.baseVersion !== 'number' || typeof d.dirty !== 'boolean') return false
  if (typeof d.updatedAt !== 'string' || typeof d.userId !== 'string' || d.userId === '') return false
  if (!canvasSchema.safeParse(d.canvas).success) return false
  if (d.inFlight !== null) {
    if (!d.inFlight || typeof d.inFlight !== 'object') return false
    const f = d.inFlight as Record<string, unknown>
    if (typeof f.saveId !== 'string' || typeof f.baseVersion !== 'number') return false
    if (!canvasSchema.safeParse(f.canvas).success) return false
  }
  return true
}

export type DraftStoreOptions = {
  /** Whose drafts these are. The store refuses a draft stamped with any other id. */
  userId: string
  /** Defaults to draftDbName(userId). */
  dbName?: string
  storeName?: string
  /** Called for this store's failures, as well as the global listeners. */
  onError?: StorageErrorListener
}

export function createDraftStore(options: DraftStoreOptions): DraftStore {
  const { userId } = options
  if (!userId) throw new Error('A draft store needs a user id')
  const dbName = options.dbName ?? draftDbName(userId)
  const storeName = options.storeName ?? DRAFT_STORE_NAME
  let store: UseStore | null = null

  // The store opens the database on first use, so building it here is safe
  // during server rendering; a missing indexedDB throws inside the try blocks.
  const openStore = (): UseStore => {
    if (typeof indexedDB === 'undefined') throw new Error('IndexedDB is not available')
    store ??= openKeyvalStore(dbName, storeName)
    return store
  }

  /** A stored value this store hands out: a well-formed draft of this user's. */
  const usable = (value: unknown): value is DraftSnapshot => isDraftSnapshot(value) && value.userId === userId

  /** Report a failure and drop the connection, so the next call reopens the database. */
  const failed = (error: unknown, operation: StorageOperation) => {
    store = null
    report(error, operation, options.onError)
  }

  return {
    async putDraft(draft) {
      if (draft.userId !== userId) {
        // Never mix two people's edits in one store.
        report(new Error("A draft of another user's was refused"), 'put', options.onError)
        return false
      }
      try {
        await set(draftKey(draft.layoutId, draft.tabId), draft, openStore())
        return true
      } catch (error) {
        failed(error, 'put')
        return false
      }
    },

    async getDraft(layoutId, tabId) {
      try {
        const value: unknown = await get(draftKey(layoutId, tabId), openStore())
        if (value === undefined) return null
        if (usable(value)) return value
        report(new Error('A stored draft could not be read'), 'get', options.onError)
        return null
      } catch (error) {
        failed(error, 'get')
        return null
      }
    },

    async listDrafts(layoutId) {
      try {
        const prefix = draftPrefix(layoutId)
        const all = await entries<IDBValidKey, unknown>(openStore())
        const drafts: DraftSnapshot[] = []
        for (const [key, value] of all) {
          if (typeof key !== 'string' || !key.startsWith(prefix)) continue
          if (usable(value)) drafts.push(value)
          else report(new Error('A stored draft could not be read'), 'list', options.onError)
        }
        return drafts.sort((x, y) => (x.updatedAt < y.updatedAt ? 1 : x.updatedAt > y.updatedAt ? -1 : 0))
      } catch (error) {
        failed(error, 'list')
        return []
      }
    },

    async deleteDraft(layoutId, tabId) {
      try {
        await del(draftKey(layoutId, tabId), openStore())
        return true
      } catch (error) {
        failed(error, 'delete')
        return false
      }
    },
  }
}

const stores = new Map<string, DraftStore>()

/** This user's outbox, created on first use and kept for the page's life. */
export function draftStoreFor(userId: string): DraftStore {
  let store = stores.get(userId)
  if (!store) {
    store = createDraftStore({ userId })
    stores.set(userId, store)
  }
  return store
}
