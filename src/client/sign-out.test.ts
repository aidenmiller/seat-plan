/**
 * Signing out on purpose (src/client/sign-out.ts): send what waits (here and
 * in this person's other tabs), ask before dropping anything unsaved, end the
 * session, delete what this person keeps in the browser, tell the other
 * tabs, leave. Each step only after the one before worked.
 */
import 'fake-indexeddb/auto'
import { set } from 'idb-keyval'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openKeyvalStore } from './sync/idb'
import { CLIPBOARD_STORAGE_KEY, DRAFT_STORE_NAME, draftDbName, LEGACY_AUTHOR_KEY, ROW_STORE_NAME, rowDbName } from './sync/storage-names'
import { signOut, UNSAVED_QUESTION, wipeUserStorage, type SignOutDeps } from './sign-out'

const USER = '11111111-1111-4111-8111-111111111111'

function deps(over: Partial<SignOutDeps> = {}) {
  const log: string[] = []
  const d: SignOutDeps = {
    flushHere: vi.fn(async () => {
      log.push('flush here')
      return { unsaved: false }
    }),
    flushOtherTabs: vi.fn(async () => {
      log.push('flush other tabs')
      return { unsaved: false }
    }),
    confirm: vi.fn(() => {
      log.push('confirm')
      return true
    }),
    logout: vi.fn(async () => {
      log.push('logout')
      return Response.json({ ok: true })
    }),
    stopSavers: vi.fn(async () => {
      log.push('stop savers')
    }),
    wipe: vi.fn(async () => {
      log.push('wipe')
    }),
    broadcast: vi.fn((m) => {
      log.push(`broadcast ${m.type}`)
    }),
    leave: vi.fn(() => {
      log.push('leave')
    }),
    ...over,
  }
  return { d, log }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('signOut', () => {
  it('with everything saved: flushes, ends the session, wipes, tells the other tabs, leaves', async () => {
    const { d, log } = deps()
    expect(await signOut(USER, d)).toBe('signed-out')
    expect(log.slice(0, 2).sort()).toEqual(['flush here', 'flush other tabs'])
    expect(log.slice(2)).toEqual(['logout', 'stop savers', 'wipe', 'broadcast signed-out', 'leave'])
    expect(d.confirm).not.toHaveBeenCalled()
    expect(d.flushHere).toHaveBeenCalledWith(3000)
    expect(d.flushOtherTabs).toHaveBeenCalledWith(USER, 3000)
    expect(d.wipe).toHaveBeenCalledWith(USER)
    expect(d.broadcast).toHaveBeenCalledWith({ type: 'signed-out', userId: USER })
  })

  it('asks before dropping unsaved changes, here or in another tab', async () => {
    for (const where of ['flushHere', 'flushOtherTabs'] as const) {
      const { d, log } = deps({ [where]: vi.fn(async () => ({ unsaved: true })) })
      expect(await signOut(USER, d)).toBe('signed-out')
      expect(d.confirm).toHaveBeenCalledWith(UNSAVED_QUESTION)
      expect(log.indexOf('confirm')).toBeLessThan(log.indexOf('logout'))
    }
    expect(UNSAVED_QUESTION).toBe('Some changes are not saved yet. Sign out anyway?')
  })

  it('stops at once when the answer is no: still signed in, nothing deleted', async () => {
    const { d } = deps({ flushHere: vi.fn(async () => ({ unsaved: true })), confirm: vi.fn(() => false) })
    expect(await signOut(USER, d)).toBe('cancelled')
    expect(d.logout).not.toHaveBeenCalled()
    expect(d.wipe).not.toHaveBeenCalled()
    expect(d.broadcast).not.toHaveBeenCalled()
    expect(d.leave).not.toHaveBeenCalled()
  })

  it('counts a flush that fails as unsaved', async () => {
    const { d } = deps({ flushOtherTabs: vi.fn(async () => Promise.reject(new Error('channel closed'))), confirm: vi.fn(() => false) })
    expect(await signOut(USER, d)).toBe('cancelled')
    expect(d.confirm).toHaveBeenCalled()
  })

  it('deletes nothing when the sign-out request fails', async () => {
    for (const logout of [vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))), vi.fn(async () => new Response(null, { status: 500 }))]) {
      const { d } = deps({ logout })
      expect(await signOut(USER, d)).toBe('failed')
      expect(d.stopSavers).not.toHaveBeenCalled()
      expect(d.wipe).not.toHaveBeenCalled()
      expect(d.leave).not.toHaveBeenCalled()
    }
  })

  it('goes on when the session had already ended (401)', async () => {
    const { d } = deps({ logout: vi.fn(async () => Response.json({ error: 'unauthorized' }, { status: 401 })) })
    expect(await signOut(USER, d)).toBe('signed-out')
    expect(d.wipe).toHaveBeenCalled()
  })

  it('ends nothing and deletes nothing when someone else signed in on this browser since (401 stale_page)', async () => {
    const { d } = deps({ logout: vi.fn(async () => Response.json({ error: 'stale_page' }, { status: 401 })) })
    expect(await signOut(USER, d)).toBe('other-user')
    expect(d.wipe).not.toHaveBeenCalled()
    expect(d.broadcast).not.toHaveBeenCalled()
    expect(d.leave).not.toHaveBeenCalled()
  })
})

describe('wipeUserStorage', () => {
  it('deletes this user’s two databases and the clipboard, and leaves other people’s and the device settings', async () => {
    const other = '22222222-2222-4222-8222-222222222222'
    await set('k', 'mine', openKeyvalStore(draftDbName(USER), DRAFT_STORE_NAME))
    await set('k', 'mine', openKeyvalStore(rowDbName(USER), ROW_STORE_NAME))
    await set('k', 'theirs', openKeyvalStore(draftDbName(other), DRAFT_STORE_NAME))
    const storage = new Map<string, string>([
      [CLIPBOARD_STORAGE_KEY, '{}'],
      [LEGACY_AUTHOR_KEY, 'Noa'],
      ['seat-plan:mode', 'edit'],
    ])
    vi.stubGlobal('window', { localStorage: { removeItem: (k: string) => storage.delete(k) } })
    await wipeUserStorage(USER)
    const names = (await indexedDB.databases()).map((d) => d.name)
    expect(names).not.toContain(draftDbName(USER))
    expect(names).not.toContain(rowDbName(USER))
    expect(names).toContain(draftDbName(other))
    expect([...storage.keys()]).toEqual(['seat-plan:mode'])
  })
})
