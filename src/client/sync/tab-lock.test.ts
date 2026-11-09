import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  claimTab,
  getTabId,
  HEARTBEAT_PREFIX,
  holdTabLock,
  isTabAlive,
  TAB_ID_KEY,
  type LockManagerLike,
  type TabLockDeps,
} from './tab-lock'

class MemoryStorage {
  map = new Map<string, string>()
  getItem(key: string) {
    return this.map.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.map.set(key, value)
  }
  removeItem(key: string) {
    this.map.delete(key)
  }
}

/** Enough of navigator.locks: exclusive locks, ifAvailable, waiting with an abort signal, query. */
class FakeLocks implements LockManagerLike {
  held = new Set<string>()
  waiting = new Map<string, (() => void)[]>()

  async request(
    name: string,
    options: { ifAvailable?: boolean; signal?: AbortSignal },
    callback: (lock: unknown) => unknown,
  ): Promise<unknown> {
    if (this.held.has(name)) {
      if (options.ifAvailable) return callback(null)
      await new Promise<void>((resolve, reject) => {
        const queue = this.waiting.get(name) ?? []
        const grant = () => resolve()
        queue.push(grant)
        this.waiting.set(name, queue)
        options.signal?.addEventListener('abort', () => {
          this.waiting.set(name, (this.waiting.get(name) ?? []).filter((g) => g !== grant))
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })
    }
    this.held.add(name)
    try {
      return await callback({ name })
    } finally {
      this.held.delete(name)
      this.waiting.get(name)?.shift()?.()
    }
  }

  async query() {
    return { held: [...this.held].map((name) => ({ name })), pending: [] }
  }
}

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

let ids = 0
const newId = () => `id-${++ids}`

describe('getTabId', () => {
  it('makes an id once and keeps it in sessionStorage', () => {
    const sessionStorage = new MemoryStorage()
    const deps: TabLockDeps = { sessionStorage, newId }
    const id = getTabId(deps)
    expect(getTabId(deps)).toBe(id)
    expect(sessionStorage.getItem(TAB_ID_KEY)).toBe(id)
  })

  it('still gives an id when sessionStorage is blocked', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {},
    }
    expect(getTabId({ sessionStorage: blocked, newId })).toMatch(/^id-/)
  })

  it('makes a real uuid by default', () => {
    expect(getTabId({ sessionStorage: new MemoryStorage() })).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })
})

describe('with navigator.locks', () => {
  it('holds the lock until released, and others see the tab as open', async () => {
    const locks = new FakeLocks()
    const lock = holdTabLock('t1', { locks })
    expect(await lock.acquired).toBe(true)
    expect(await isTabAlive('t1', { locks })).toBe(true)
    expect(await isTabAlive('t2', { locks })).toBe(false)
    lock.release()
    await flush()
    expect(await isTabAlive('t1', { locks })).toBe(false)
  })

  it('does not take a lock another tab holds', async () => {
    const locks = new FakeLocks()
    const first = holdTabLock('t1', { locks })
    expect(await first.acquired).toBe(true)
    const second = holdTabLock('t1', { locks })
    expect(await second.acquired).toBe(false)
    expect(await isTabAlive('t1', { locks })).toBe(true)
  })

  it('waits a moment for a page that is still letting go (a reload)', async () => {
    const locks = new FakeLocks()
    const old = holdTabLock('t1', { locks })
    await old.acquired
    const next = holdTabLock('t1', { locks }, { waitMs: 1000 })
    setTimeout(() => old.release(), 10)
    expect(await next.acquired).toBe(true)
  })

  it('claimTab takes a fresh id when the stored one belongs to another open tab', async () => {
    const locks = new FakeLocks()
    const sessionStorage = new MemoryStorage()
    sessionStorage.setItem(TAB_ID_KEY, 'copied')
    await holdTabLock('copied', { locks }).acquired
    const claimed = await claimTab({ locks, sessionStorage, newId }, { waitMs: 20 })
    expect(claimed.tabId).not.toBe('copied')
    expect(sessionStorage.getItem(TAB_ID_KEY)).toBe(claimed.tabId)
    expect(await isTabAlive(claimed.tabId, { locks })).toBe(true)
  })

  it('claimTab keeps the stored id when it is free', async () => {
    const locks = new FakeLocks()
    const sessionStorage = new MemoryStorage()
    sessionStorage.setItem(TAB_ID_KEY, 'mine')
    const claimed = await claimTab({ locks, sessionStorage, newId })
    expect(claimed.tabId).toBe('mine')
    claimed.release()
  })

  it('says open when the lock list cannot be read', async () => {
    const locks: LockManagerLike = {
      request: async () => undefined,
      query: async () => {
        throw new Error('nope')
      },
    }
    expect(await isTabAlive('t1', { locks })).toBe(true)
  })
})

describe('without navigator.locks (heartbeat)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'], now: 1_000_000 })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function deps(localStorage = new MemoryStorage()) {
    const windowTarget = new EventTarget()
    return { locks: null, localStorage, windowTarget, now: () => Date.now() } satisfies TabLockDeps
  }

  it('writes a heartbeat every 5 s and counts as open while it is under 15 s old', async () => {
    const d = deps()
    const lock = holdTabLock('t1', d)
    expect(await lock.acquired).toBe(true)
    expect(d.localStorage.getItem(`${HEARTBEAT_PREFIX}t1`)).toBe('1000000')
    vi.advanceTimersByTime(5000)
    expect(d.localStorage.getItem(`${HEARTBEAT_PREFIX}t1`)).toBe('1005000')
    expect(await isTabAlive('t1', d)).toBe(true)
    expect(await isTabAlive('t2', d)).toBe(false)
    lock.release()
    expect(d.localStorage.getItem(`${HEARTBEAT_PREFIX}t1`)).toBeNull()
    expect(await isTabAlive('t1', d)).toBe(false)
  })

  it('counts a tab as closed once its heartbeat is 15 s old', async () => {
    const d = deps()
    d.localStorage.setItem(`${HEARTBEAT_PREFIX}crashed`, String(Date.now()))
    vi.advanceTimersByTime(14_999)
    expect(await isTabAlive('crashed', d)).toBe(true)
    vi.advanceTimersByTime(1)
    expect(await isTabAlive('crashed', d)).toBe(false)
  })

  it('stops on page hide and starts again on page show', async () => {
    const d = deps()
    holdTabLock('t1', d)
    d.windowTarget.dispatchEvent(new Event('pagehide'))
    expect(await isTabAlive('t1', d)).toBe(false)
    vi.advanceTimersByTime(20_000)
    expect(d.localStorage.getItem(`${HEARTBEAT_PREFIX}t1`)).toBeNull()
    d.windowTarget.dispatchEvent(new Event('pageshow'))
    expect(await isTabAlive('t1', d)).toBe(true)
  })

  it('does not take an id whose heartbeat is fresh (a duplicated tab)', async () => {
    const d = deps()
    holdTabLock('t1', d)
    expect(await holdTabLock('t1', d).acquired).toBe(false)
    const sessionStorage = new MemoryStorage()
    sessionStorage.setItem(TAB_ID_KEY, 't1')
    const claimed = await claimTab({ ...d, sessionStorage, newId })
    expect(claimed.tabId).not.toBe('t1')
    expect(await isTabAlive(claimed.tabId, d)).toBe(true)
  })
})
