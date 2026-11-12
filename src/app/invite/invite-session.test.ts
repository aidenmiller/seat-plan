/**
 * Signing out, signing in and making an account from the invite page
 * (invite-session.ts) go the way the rest of the app goes: the shared
 * sign-out (send first, ask, delete this person's storage, tell the other
 * tabs), and a 'signed-in' message to the other tabs with the new account's
 * id, so a previous person's tabs stop at once.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ANNOUNCE_SIGN_IN_KEY, announcePendingSignIn, type AuthMessage, type ChannelLike } from '@/client/auth-channel'
import { UNSAVED_QUESTION, type SignOutDeps } from '@/client/sign-out'
import { isLeavingForSignOut } from '@/client/sync/saver-registry'
import { inviteSignOutDeps, registerFromInvite, signInFromInvite, signOutFromInvite } from './invite-session'

const AVERY = '11111111-1111-4111-8111-111111111111'
const NOVA = '55555555-5555-4555-8555-555555555555'

afterEach(() => {
  vi.unstubAllGlobals()
})

function baseDeps(over: Partial<SignOutDeps> = {}): SignOutDeps & { log: string[] } {
  const log: string[] = []
  return {
    log,
    sendStoredRows: vi.fn(),
    flushHere: vi.fn(async () => ({ unsaved: false })),
    flushOtherTabs: vi.fn(async () => ({ unsaved: false })),
    inspectStored: vi.fn(async () => ({ layouts: 1, guests: 0, groups: 0 })),
    confirm: vi.fn(() => {
      log.push('confirm')
      return true
    }),
    logout: vi.fn(async () => {
      log.push('logout')
      return Response.json({ ok: true })
    }),
    stopSavers: vi.fn(async () => void log.push('stop savers')),
    wipe: vi.fn(async () => void log.push('wipe')),
    broadcast: vi.fn((m: AuthMessage) => void log.push(`broadcast ${m.type}`)),
    leave: vi.fn(() => void log.push('leave for sign-in page')),
    ...over,
  }
}

/** A fake sessionStorage. */
function memoryStorage() {
  const data = new Map<string, string>()
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) }
}

function recordingChannel() {
  const sent: unknown[] = []
  const channel: ChannelLike = {
    postMessage: (m) => void sent.push(m),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    close: () => undefined,
  }
  return { channel, sent }
}

describe('signing out on the invite page', () => {
  it('goes through the shared sign-out: asks about what is unsaved, then deletes, tells the other tabs, and loads this invite again', async () => {
    const reload = vi.fn()
    vi.stubGlobal('window', { location: { reload } })
    const base = baseDeps()
    const deps = inviteSignOutDeps(base)
    expect(await signOutFromInvite(AVERY, deps)).toBe('signed-out')
    expect(base.sendStoredRows).toHaveBeenCalledWith(AVERY)
    expect(base.flushOtherTabs).toHaveBeenCalledWith(AVERY, 3000)
    expect(base.confirm).toHaveBeenCalledWith(expect.stringMatching(/^Some changes are not saved yet\. Changes to 1 layout /))
    expect(base.log).toEqual(['confirm', 'logout', 'stop savers', 'wipe', 'broadcast signed-out'])
    expect(base.wipe).toHaveBeenCalledWith(AVERY)
    // Not the sign-in page: this page again, whose token is in the #fragment, now for nobody.
    expect(base.leave).not.toHaveBeenCalled()
    expect(reload).toHaveBeenCalledTimes(1)
    expect(isLeavingForSignOut()).toBe(true)
  })

  it('no keeps everything and stays', async () => {
    const reload = vi.fn()
    vi.stubGlobal('window', { location: { reload } })
    const base = baseDeps({ flushHere: vi.fn(async () => ({ unsaved: true })), inspectStored: vi.fn(async () => ({ layouts: 0, guests: 0, groups: 0 })), confirm: vi.fn(() => false) })
    expect(await signOutFromInvite(AVERY, inviteSignOutDeps(base))).toBe('cancelled')
    expect(base.confirm).toHaveBeenCalledWith(UNSAVED_QUESTION)
    expect(base.logout).not.toHaveBeenCalled()
    expect(base.wipe).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })
})

describe('signing in on the invite page', () => {
  it('tells the other tabs who signed in, as the sign-in page does', async () => {
    const post = vi.fn()
    const signIn = vi.fn(async () => ({ ok: true as const, userId: AVERY, redirect: '/' }))
    await signInFromInvite('avery@example.com', 'secret-password', { signIn, post })
    expect(signIn).toHaveBeenCalledWith('avery@example.com', 'secret-password')
    expect(post).toHaveBeenCalledWith({ type: 'signed-in', userId: AVERY })
  })

  it('tells nobody when the sign-in fails', async () => {
    const post = vi.fn()
    const signIn = vi.fn(async () => Promise.reject(new Error('wrong password')))
    await expect(signInFromInvite('a@example.com', 'x', { signIn, post })).rejects.toThrow()
    expect(post).not.toHaveBeenCalled()
  })
})

describe('making an account on the invite page', () => {
  const body = { token: 'T'.repeat(43), email: ' Nova@Example.com ', displayName: 'Nova', password: 'a-long-password' }

  it('leaves word for the next page, which tells the other tabs the new account’s id', async () => {
    const storage = memoryStorage()
    const register = vi.fn(async () => ({ ok: true as const, redirect: '/w/x/layouts' }))
    const done = await registerFromInvite(body, { register, storage, now: () => 1_000 })
    expect(done.redirect).toBe('/w/x/layouts')
    expect(storage.data.has(ANNOUNCE_SIGN_IN_KEY)).toBe(true)

    // The wedding page loads for Nova and tells the other tabs, once.
    const { channel, sent } = recordingChannel()
    announcePendingSignIn({ id: NOVA, email: 'nova@example.com' }, { storage, channel, now: () => 5_000 })
    expect(sent).toEqual([{ type: 'signed-in', userId: NOVA }])
    announcePendingSignIn({ id: NOVA, email: 'nova@example.com' }, { storage, channel, now: () => 6_000 })
    expect(sent).toHaveLength(1)
  })

  it('leaves no word when making the account fails', async () => {
    const storage = memoryStorage()
    const register = vi.fn(async () => Promise.reject(new Error('email taken')))
    await expect(registerFromInvite(body, { register, storage })).rejects.toThrow()
    expect(storage.data.size).toBe(0)
  })

  it('the word is only for that account, and only for a few minutes', () => {
    const { channel, sent } = recordingChannel()
    const storage = memoryStorage()
    storage.setItem(ANNOUNCE_SIGN_IN_KEY, JSON.stringify({ email: 'nova@example.com', at: 1_000 }))
    announcePendingSignIn({ id: AVERY, email: 'avery@example.com' }, { storage, channel, now: () => 2_000 })
    storage.setItem(ANNOUNCE_SIGN_IN_KEY, JSON.stringify({ email: 'nova@example.com', at: 1_000 }))
    announcePendingSignIn({ id: NOVA, email: 'nova@example.com' }, { storage, channel, now: () => 1_000 + 10 * 60_000 })
    expect(sent).toEqual([])
    expect(storage.data.size).toBe(0)
  })
})
