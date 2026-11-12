/**
 * What a signed-in page does when another tab of this browser signs someone
 * in (src/client/BrowserSession.tsx): someone else blocks it; the page's own
 * user signing in again unblocks it, and its stopped savers send what they
 * kept (their edits are still in that user's storage).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearOtherUser, listenForAuthChanges, markOtherUser, pageAuthState, type ChannelLike } from './auth-channel'
import { pageAuthHandlers } from './BrowserSession'
import { registerSaver } from './sync/saver-registry'

const AVERY = '11111111-1111-4111-8111-111111111111'
const BLAKE = '22222222-2222-4222-8222-222222222222'

/** A channel the test speaks on as "another tab". */
function fakeChannel() {
  const listeners = new Set<(event: MessageEvent) => void>()
  const channel: ChannelLike = {
    postMessage: () => undefined,
    addEventListener: (_type, listener) => void listeners.add(listener),
    removeEventListener: (_type, listener) => void listeners.delete(listener),
    close: () => undefined,
  }
  return { channel, fromAnotherTab: (data: unknown) => [...listeners].forEach((l) => l({ data } as MessageEvent)) }
}

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  clearOtherUser()
})

function averysPage() {
  const { channel, fromAnotherTab } = fakeChannel()
  const saver = { flush: vi.fn(async () => undefined), hasUnsavedChanges: () => true, stop: vi.fn(async () => undefined), resume: vi.fn() }
  cleanups.push(registerSaver(saver), listenForAuthChanges(pageAuthHandlers(AVERY), channel))
  return { saver, fromAnotherTab }
}

describe('a page someone else signed in over', () => {
  it('stays blocked when anyone but its own user signs in', () => {
    const { saver, fromAnotherTab } = averysPage()
    fromAnotherTab({ type: 'signed-in', userId: BLAKE })
    expect(pageAuthState()).toBe('other-user')
    fromAnotherTab({ type: 'signed-in', userId: '33333333-3333-4333-8333-333333333333' })
    expect(pageAuthState()).toBe('other-user')
    expect(saver.resume).not.toHaveBeenCalled()
  })

  it('is unblocked, and its savers resume, when its own user signs in again', async () => {
    const { saver, fromAnotherTab } = averysPage()
    markOtherUser()
    fromAnotherTab({ type: 'signed-in', userId: AVERY })
    expect(pageAuthState()).toBe('current')
    expect(saver.resume).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(saver.flush).toHaveBeenCalled())
    // Someone else again: blocked again.
    fromAnotherTab({ type: 'signed-in', userId: BLAKE })
    expect(pageAuthState()).toBe('other-user')
  })
})
