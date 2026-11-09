/**
 * Which tabs are still open (PLAN section 5, "Drafts" and "Opening a layout").
 *
 * Each tab has a random id kept in sessionStorage, so a reload keeps it and
 * finds its own draft. While open, the tab holds a Web Lock named
 * `seat-plan-tab:<id>`; the browser frees it when the tab closes, so a draft
 * whose lock is free belongs to a closed tab and can be picked up.
 *
 * Browsers without navigator.locks get a heartbeat instead: the tab writes the
 * time to localStorage every 5 seconds, and counts as open while that time is
 * under 15 seconds old. The heartbeat is removed when the page hides for good.
 *
 * Every browser object is injectable so tests can fake both paths.
 */
import { randomId } from './random-id'

export const TAB_ID_KEY = 'seat-plan:tab-id'
export const LOCK_PREFIX = 'seat-plan-tab:'
export const HEARTBEAT_PREFIX = 'seat-plan:tab-heartbeat:'
export const HEARTBEAT_EVERY_MS = 5_000
export const HEARTBEAT_ALIVE_MS = 15_000

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** The parts of navigator.locks used here. */
export type LockManagerLike = {
  request(
    name: string,
    options: { ifAvailable?: boolean; signal?: AbortSignal },
    callback: (lock: unknown) => Promise<unknown> | unknown,
  ): Promise<unknown>
  query(): Promise<{ held?: { name?: string }[]; pending?: { name?: string }[] }>
}

export type TabLockDeps = {
  /** navigator.locks; null forces the heartbeat. */
  locks?: LockManagerLike | null
  sessionStorage?: KeyValueStorage | null
  localStorage?: KeyValueStorage | null
  /** Receives 'pagehide' and 'pageshow' for the heartbeat. Defaults to window. */
  windowTarget?: EventTarget | null
  now?: () => number
  newId?: () => string
}

function resolveDeps(deps: TabLockDeps) {
  const hasWindow = typeof window !== 'undefined'
  const nav: { locks?: LockManagerLike } | undefined =
    typeof navigator === 'undefined' ? undefined : (navigator as unknown as { locks?: LockManagerLike })
  return {
    locks: deps.locks !== undefined ? deps.locks : (nav?.locks ?? null),
    sessionStorage: deps.sessionStorage !== undefined ? deps.sessionStorage : hasWindow ? safeStorage('session') : null,
    localStorage: deps.localStorage !== undefined ? deps.localStorage : hasWindow ? safeStorage('local') : null,
    windowTarget: deps.windowTarget !== undefined ? deps.windowTarget : hasWindow ? window : null,
    now: deps.now ?? (() => Date.now()),
    newId: deps.newId ?? randomId,
  }
}

/** Reading window.localStorage throws when site data is blocked. */
function safeStorage(kind: 'session' | 'local'): KeyValueStorage | null {
  try {
    return kind === 'session' ? window.sessionStorage : window.localStorage
  } catch {
    return null
  }
}

function readItem(storage: KeyValueStorage | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null
  } catch {
    return null
  }
}

function writeItem(storage: KeyValueStorage | null, key: string, value: string): void {
  try {
    storage?.setItem(key, value)
  } catch {
    // Storage full or blocked: the tab still works, it just cannot be found later.
  }
}

function removeItem(storage: KeyValueStorage | null, key: string): void {
  try {
    storage?.removeItem(key)
  } catch {
    // As above.
  }
}

export function lockName(tabId: string): string {
  return `${LOCK_PREFIX}${tabId}`
}

/** This tab's id, made on first use and kept in sessionStorage so a reload keeps it. */
export function getTabId(deps: TabLockDeps = {}): string {
  const d = resolveDeps(deps)
  const existing = readItem(d.sessionStorage, TAB_ID_KEY)
  if (existing) return existing
  const id = d.newId()
  writeItem(d.sessionStorage, TAB_ID_KEY, id)
  return id
}

/** Give this tab a new id (when its stored id turns out to belong to another open tab). */
export function renewTabId(deps: TabLockDeps = {}): string {
  const d = resolveDeps(deps)
  const id = d.newId()
  writeItem(d.sessionStorage, TAB_ID_KEY, id)
  return id
}

export type TabLock = {
  /** True once this tab holds the lock; false when another open tab holds it. */
  acquired: Promise<boolean>
  /** Let go early (tests, or leaving the page without closing the tab). */
  release(): void
}

export type HoldOptions = {
  /**
   * How long to wait for a lock another page holds. A reload can start before
   * the old page has let go; a duplicated tab never lets go. Default 0: give up at once.
   */
  waitMs?: number
}

/** Hold this tab's lock until the tab closes (or release() is called). */
export function holdTabLock(tabId: string, deps: TabLockDeps = {}, options: HoldOptions = {}): TabLock {
  const d = resolveDeps(deps)
  return d.locks ? holdWebLock(d.locks, tabId, options.waitMs ?? 0) : holdHeartbeat(d, tabId)
}

function holdWebLock(locks: LockManagerLike, tabId: string, waitMs: number): TabLock {
  let releaseLock: () => void = () => {}
  const held = new Promise<void>((resolve) => {
    releaseLock = resolve
  })
  let released = false
  const acquired = new Promise<boolean>((resolve) => {
    const controller = waitMs > 0 ? new AbortController() : null
    const timer = controller ? setTimeout(() => controller.abort(), waitMs) : null
    const options = controller ? { signal: controller.signal } : { ifAvailable: true }
    locks
      .request(lockName(tabId), options, (lock) => {
        if (timer) clearTimeout(timer)
        if (!lock || released) {
          resolve(false)
          return undefined
        }
        resolve(true)
        // The lock stays held until this promise settles: when the tab closes, or on release().
        return held
      })
      .catch(() => {
        if (timer) clearTimeout(timer)
        resolve(false)
      })
  })
  return {
    acquired,
    release() {
      released = true
      releaseLock()
    },
  }
}

function holdHeartbeat(d: ReturnType<typeof resolveDeps>, tabId: string): TabLock {
  const key = `${HEARTBEAT_PREFIX}${tabId}`
  const last = Number(readItem(d.localStorage, key))
  // A fresh heartbeat under this id means another open tab (a duplicated tab copies sessionStorage).
  if (Number.isFinite(last) && last > 0 && d.now() - last < HEARTBEAT_ALIVE_MS) {
    return { acquired: Promise.resolve(false), release() {} }
  }
  let timer: ReturnType<typeof setInterval> | null = null
  const beat = () => writeItem(d.localStorage, key, String(d.now()))
  const start = () => {
    if (timer) return
    beat()
    timer = setInterval(beat, HEARTBEAT_EVERY_MS)
  }
  const stop = () => {
    if (timer) clearInterval(timer)
    timer = null
    removeItem(d.localStorage, key)
  }
  // Leaving the page (closing, or going into the back-forward cache) frees the
  // id at once, so a reload in this tab can pick up its own draft.
  const onPageHide = () => stop()
  const onPageShow = () => start()
  d.windowTarget?.addEventListener('pagehide', onPageHide)
  d.windowTarget?.addEventListener('pageshow', onPageShow)
  start()
  return {
    acquired: Promise.resolve(true),
    release() {
      d.windowTarget?.removeEventListener('pagehide', onPageHide)
      d.windowTarget?.removeEventListener('pageshow', onPageShow)
      stop()
    },
  }
}

/** True while the tab with this id is open (holds its lock, or its heartbeat is fresh). */
export async function isTabAlive(tabId: string, deps: TabLockDeps = {}): Promise<boolean> {
  const d = resolveDeps(deps)
  if (d.locks) {
    try {
      const snapshot = await d.locks.query()
      const name = lockName(tabId)
      return (snapshot.held ?? []).some((l) => l.name === name)
    } catch {
      // Cannot tell: say open, so we never take over a live tab's draft.
      return true
    }
  }
  const last = Number(readItem(d.localStorage, `${HEARTBEAT_PREFIX}${tabId}`))
  return Number.isFinite(last) && last > 0 && d.now() - last < HEARTBEAT_ALIVE_MS
}

/**
 * Get this tab's id and hold its lock. When another open tab already holds
 * the stored id (a duplicated tab copies sessionStorage), take a fresh id.
 */
export async function claimTab(
  deps: TabLockDeps = {},
  options: HoldOptions = { waitMs: 1000 },
): Promise<{ tabId: string; release: () => void }> {
  const tabId = getTabId(deps)
  const lock = holdTabLock(tabId, deps, options)
  if (await lock.acquired) return { tabId, release: lock.release }
  lock.release()
  const fresh = renewTabId(deps)
  const freshLock = holdTabLock(fresh, deps)
  await freshLock.acquired
  return { tabId: fresh, release: freshLock.release }
}
