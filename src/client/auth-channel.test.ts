/**
 * The tabs' messages about signing in and out (src/client/auth-channel.ts),
 * over a fake BroadcastChannel that delivers to every other channel object,
 * as the browser does.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  flushOtherTabs,
  listenForAuthChanges,
  markOtherUser,
  pageAuthState,
  postAuthMessage,
  readAuthMessage,
  subscribePageAuthState,
  type ChannelLike,
} from './auth-channel'

const ME = '11111111-1111-4111-8111-111111111111'
const SOMEONE = '22222222-2222-4222-8222-222222222222'

/** Channel objects on one name: a message reaches every object but the sender, a moment later. */
function fakeBus() {
  const members = new Set<{ listeners: Set<(e: MessageEvent) => void> }>()
  function open(): ChannelLike {
    const me = { listeners: new Set<(e: MessageEvent) => void>() }
    members.add(me)
    return {
      postMessage(message) {
        for (const other of members) {
          if (other === me) continue
          setTimeout(() => other.listeners.forEach((l) => l({ data: message } as MessageEvent)), 0)
        }
      },
      addEventListener: (_t, l) => void me.listeners.add(l),
      removeEventListener: (_t, l) => void me.listeners.delete(l),
      close: () => void members.delete(me),
    }
  }
  return { open }
}

function handlers(over: Partial<Parameters<typeof listenForAuthChanges>[0]> = {}) {
  return {
    userId: ME,
    onOtherUser: vi.fn(),
    onSignedInAgain: vi.fn(),
    onSignedOut: vi.fn(),
    flush: vi.fn(async () => ({ unsaved: false })),
    ...over,
  }
}

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms))

afterEach(() => {
  vi.useRealTimers()
})

describe('messages', () => {
  it('reads only well-formed messages', () => {
    expect(readAuthMessage({ type: 'signed-in', userId: ME })).toEqual({ type: 'signed-in', userId: ME })
    expect(readAuthMessage({ type: 'signed-in' })).toBeNull()
    expect(readAuthMessage({ type: 'flush-done', requestId: 'r', tabId: 't', unsaved: 'no' })).toBeNull()
    expect(readAuthMessage('signed-out')).toBeNull()
    expect(readAuthMessage(null)).toBeNull()
  })
})

describe('listenForAuthChanges', () => {
  it('stops a page of one person when someone else signs in, and retries saves when the same person signs in again', async () => {
    const bus = fakeBus()
    const h = handlers()
    listenForAuthChanges(h, bus.open())
    const signInForm = bus.open()
    postAuthMessage({ type: 'signed-in', userId: SOMEONE }, signInForm)
    await tick()
    expect(h.onOtherUser).toHaveBeenCalledTimes(1)
    postAuthMessage({ type: 'signed-in', userId: ME }, signInForm)
    await tick()
    expect(h.onSignedInAgain).toHaveBeenCalledTimes(1)
  })

  it('follows a sign-out of the same person only', async () => {
    const bus = fakeBus()
    const h = handlers()
    listenForAuthChanges(h, bus.open())
    const other = bus.open()
    postAuthMessage({ type: 'signed-out', userId: SOMEONE }, other)
    await tick()
    expect(h.onSignedOut).not.toHaveBeenCalled()
    postAuthMessage({ type: 'signed-out', userId: ME }, other)
    await tick()
    expect(h.onSignedOut).toHaveBeenCalledTimes(1)
  })

  it('stops listening when asked', async () => {
    const bus = fakeBus()
    const h = handlers()
    const stop = listenForAuthChanges(h, bus.open())
    stop()
    postAuthMessage({ type: 'signed-in', userId: SOMEONE }, bus.open())
    await tick()
    expect(h.onOtherUser).not.toHaveBeenCalled()
  })

  it('does nothing without BroadcastChannel', () => {
    expect(listenForAuthChanges(handlers(), null)).toBeTypeOf('function')
  })
})

describe('flushOtherTabs', () => {
  it('collects every tab of the same person, and reports unsaved when any tab still holds something', async () => {
    const bus = fakeBus()
    listenForAuthChanges(handlers({ flush: async () => ({ unsaved: false }) }), bus.open())
    listenForAuthChanges(handlers({ flush: async () => ({ unsaved: true }) }), bus.open())
    // Someone else's tab does not answer for this person.
    const theirs = handlers({ userId: SOMEONE })
    listenForAuthChanges(theirs, bus.open())
    expect(await flushOtherTabs(ME, { channel: bus.open(), waitMs: 1000, answerMs: 20 })).toEqual({ unsaved: true })
    expect(theirs.flush).not.toHaveBeenCalled()
  })

  it('reports saved when every tab is', async () => {
    const bus = fakeBus()
    const one = handlers()
    listenForAuthChanges(one, bus.open())
    expect(await flushOtherTabs(ME, { channel: bus.open(), waitMs: 1000, answerMs: 20 })).toEqual({ unsaved: false })
    expect(one.flush).toHaveBeenCalledTimes(1)
  })

  it('counts a tab that started and did not finish in time as unsaved', async () => {
    const bus = fakeBus()
    listenForAuthChanges(handlers({ flush: () => new Promise(() => undefined) }), bus.open())
    const started = Date.now()
    expect(await flushOtherTabs(ME, { channel: bus.open(), waitMs: 100, answerMs: 20 })).toEqual({ unsaved: true })
    expect(Date.now() - started).toBeGreaterThanOrEqual(90)
  })

  it('answers saved at once with no other tabs, or no BroadcastChannel', async () => {
    expect(await flushOtherTabs(ME, { channel: fakeBus().open(), waitMs: 1000, answerMs: 10 })).toEqual({ unsaved: false })
    expect(await flushOtherTabs(ME, { channel: null })).toEqual({ unsaved: false })
  })
})

describe('the page state', () => {
  it('turns to other-user once, telling subscribers', () => {
    const heard = vi.fn()
    const off = subscribePageAuthState(heard)
    expect(pageAuthState()).toBe('current')
    markOtherUser()
    markOtherUser()
    expect(pageAuthState()).toBe('other-user')
    expect(heard).toHaveBeenCalledTimes(1)
    off()
  })
})
