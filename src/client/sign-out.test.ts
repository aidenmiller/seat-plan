/**
 * Signing out on purpose (src/client/sign-out.ts): send what waits (here and
 * in this person's other tabs), ask before dropping anything unsaved, end the
 * session, delete what this person keeps in the browser, tell the other
 * tabs, leave. Each step only after the one before worked.
 */
import 'fake-indexeddb/auto'
import { set } from 'idb-keyval'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyCanvas } from '@/domain/canvas-schema'
import { openKeyvalStore } from './sync/idb'
import { createDraftStore } from './sync/outbox'
import { createRowStore } from './sync/row-save'
import { CLIPBOARD_STORAGE_KEY, DRAFT_STORE_NAME, draftDbName, LEGACY_AUTHOR_KEY, ROW_STORE_NAME, rowDbName } from './sync/storage-names'
import type { DraftSnapshot } from './sync/types'
import { unsentOnDevice } from './sync/unsent'
import { signOut, UNSAVED_QUESTION, unsavedQuestion, wipeUserStorage, type SignOutDeps } from './sign-out'

const USER = '11111111-1111-4111-8111-111111111111'
const NOTHING_STORED = { layouts: 0, guests: 0, groups: 0 }

function deps(over: Partial<SignOutDeps> = {}) {
  const log: string[] = []
  const d: SignOutDeps = {
    sendStoredRows: vi.fn(),
    flushHere: vi.fn(async () => {
      log.push('flush here')
      return { unsaved: false }
    }),
    flushOtherTabs: vi.fn(async () => {
      log.push('flush other tabs')
      return { unsaved: false }
    }),
    inspectStored: vi.fn(async () => NOTHING_STORED),
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

/**
 * Edits no live saver holds: a draft left by a closed or crashed tab (or a
 * phone tab the browser killed), a layout whose save failed, guest edits
 * queued while no guest page is open, drafts from before accounts that were
 * never opened. They are only in this person's databases, which signing out
 * deletes, so the sign-out reads those databases itself before it asks.
 */
describe('signOut with edits stored on this device', () => {
  let n = 0
  const L1 = '6f1c2b9e-3d4a-4c5b-8e7f-0a1b2c3d4e5f'
  const L2 = '7a2d3c0f-4e5b-4d6c-9f80-1b2c3d4e5f60'
  const fresh = () => `33333333-3333-4333-8333-${String(++n).padStart(12, '0')}`

  function draft(userId: string, layoutId: string, tabId: string, over: Partial<DraftSnapshot> = {}): DraftSnapshot {
    return { layoutId, tabId, baseVersion: 2, canvas: emptyCanvas(), userId, inFlight: null, dirty: true, updatedAt: '2026-11-09T12:00:00.000Z', ...over }
  }

  async function names(): Promise<string[]> {
    return (await indexedDB.databases()).map((d) => d.name ?? '')
  }

  /** A draft from a closed tab, a layout whose last save never answered, and edits to two guests and a group from closed tabs. */
  async function leftBehind(userId: string) {
    const drafts = createDraftStore({ userId })
    await drafts.putDraft(draft(userId, L1, 'closed-tab'))
    await drafts.putDraft(draft(userId, L1, 'crashed-tab'))
    await drafts.putDraft(draft(userId, L2, 'phone-tab', { dirty: false, inFlight: { saveId: 's1', baseVersion: 2, canvas: emptyCanvas() } }))
    const rows = createRowStore({ userId })
    await rows.put({ queueId: 'q1', kind: 'guest', id: 'g1', patch: { meal: 'Fish' }, queuedAt: '2026-11-09T12:00:00.000Z' })
    await rows.put({ queueId: 'q2', kind: 'guest', id: 'g1', patch: { table: 'T2' }, queuedAt: '2026-11-09T12:01:00.000Z' })
    await rows.put({ queueId: 'q2', kind: 'guest', id: 'g2', patch: { meal: 'Veg' }, queuedAt: '2026-11-09T12:01:00.000Z' })
    await rows.put({ queueId: 'q2', kind: 'group', id: 'gr1', patch: { name: 'Cousins' }, queuedAt: '2026-11-09T12:01:00.000Z' })
  }

  /** Nobody live holds anything (this tab and the other tabs say all is sent); the real storage is read and deleted. */
  function noLiveSavers(confirm: (q: string) => boolean) {
    return deps({ inspectStored: unsentOnDevice, wipe: wipeUserStorage, confirm: vi.fn(confirm) })
  }

  it('asks, naming what is stored unsent, though no live saver holds anything; no deletes nothing', async () => {
    const user = fresh()
    await leftBehind(user)
    const { d } = noLiveSavers(() => false)
    expect(await signOut(user, d)).toBe('cancelled')
    expect(d.confirm).toHaveBeenCalledWith(
      'Some changes are not saved yet. Changes to 2 layouts, 2 guests and 1 group are kept only on this device, and signing out deletes them. To save them first, cancel and open those layouts again. Sign out anyway?',
    )
    expect(d.logout).not.toHaveBeenCalled()
    expect(d.stopSavers).not.toHaveBeenCalled()
    expect(await createDraftStore({ userId: user }).listDrafts(L1)).toHaveLength(2)
    expect(await createRowStore({ userId: user }).list()).toHaveLength(4)
  })

  it('yes deletes them, as before', async () => {
    const user = fresh()
    await leftBehind(user)
    vi.stubGlobal('window', { localStorage: { removeItem: () => undefined } })
    const { d } = noLiveSavers(() => true)
    expect(await signOut(user, d)).toBe('signed-out')
    expect(d.confirm).toHaveBeenCalledTimes(1)
    const all = await names()
    expect(all).not.toContain(draftDbName(user))
    expect(all).not.toContain(rowDbName(user))
  })

  it('asks nothing when nothing unsent is stored or held anywhere', async () => {
    const user = fresh()
    // A draft that holds nothing unsaved, and a note that an edit from before accounts was adopted.
    await createDraftStore({ userId: user }).putDraft(draft(user, L1, 'done', { dirty: false }))
    await set('legacy-adopted:rows:x', { adoptedAt: '2026-11-09T12:00:00.000Z' }, openKeyvalStore(rowDbName(user), ROW_STORE_NAME))
    const { d } = noLiveSavers(() => true)
    expect(await signOut(user, d)).toBe('signed-out')
    expect(d.confirm).not.toHaveBeenCalled()
    // Nor for someone who never stored anything.
    const { d: d2 } = noLiveSavers(() => true)
    expect(await signOut(fresh(), d2)).toBe('signed-out')
    expect(d2.confirm).not.toHaveBeenCalled()
  })

  it('counts the stored edits of another tab that does not answer: unknown, never saved', async () => {
    const user = fresh()
    // A tab still open (a phone tab in the background, frozen) wrote this draft; it never answers the flush.
    await createDraftStore({ userId: user }).putDraft(draft(user, L1, 'silent-tab'))
    const { d } = noLiveSavers(() => false)
    expect(await signOut(user, d)).toBe('cancelled')
    expect(d.confirm).toHaveBeenCalledWith(
      'Some changes are not saved yet. Changes to 1 layout are kept only on this device, and signing out deletes them. To save them first, cancel and open the layout again. Sign out anyway?',
    )
  })

  it('reads the storage after the flushes, so what they sent is not counted, and before it asks', async () => {
    const order: string[] = []
    const { d } = deps({
      sendStoredRows: vi.fn(() => void order.push('start row queue')),
      flushHere: vi.fn(async () => {
        order.push('flush')
        return { unsaved: false }
      }),
      inspectStored: vi.fn(async () => {
        order.push('inspect')
        return { layouts: 0, guests: 1, groups: 0 }
      }),
      confirm: vi.fn(() => {
        order.push('confirm')
        return false
      }),
    })
    expect(await signOut(USER, d)).toBe('cancelled')
    expect(order).toEqual(['start row queue', 'flush', 'inspect', 'confirm'])
    expect(d.sendStoredRows).toHaveBeenCalledWith(USER)
    expect(d.inspectStored).toHaveBeenCalledWith(USER)
  })

  it('asks when the storage cannot be read: what it holds is unknown', async () => {
    const { d } = deps({ inspectStored: vi.fn(async () => Promise.reject(new DOMException('gone', 'UnknownError'))), confirm: vi.fn(() => false) })
    expect(await signOut(USER, d)).toBe('cancelled')
    expect(d.confirm).toHaveBeenCalledWith(UNSAVED_QUESTION)
  })
})

describe('unsavedQuestion', () => {
  it('names what is stored, in plain words, or asks the short question for edits only a live page holds', () => {
    const live = { live: true }
    const none = { live: false }
    expect(unsavedQuestion(none, { layouts: 0, guests: 0, groups: 0 })).toBeNull()
    expect(unsavedQuestion(live, { layouts: 0, guests: 0, groups: 0 })).toBe(UNSAVED_QUESTION)
    expect(unsavedQuestion(none, null)).toBe(UNSAVED_QUESTION)
    expect(unsavedQuestion(none, { layouts: 1, guests: 0, groups: 0 })).toBe(
      'Some changes are not saved yet. Changes to 1 layout are kept only on this device, and signing out deletes them. To save them first, cancel and open the layout again. Sign out anyway?',
    )
    expect(unsavedQuestion(live, { layouts: 0, guests: 3, groups: 0 })).toBe(
      'Some changes are not saved yet. Changes to 3 guests are kept only on this device, and signing out deletes them. To save them first, cancel and try again later. Sign out anyway?',
    )
    expect(unsavedQuestion(none, { layouts: 1, guests: 1, groups: 2 })).toBe(
      'Some changes are not saved yet. Changes to 1 layout, 1 guest and 2 groups are kept only on this device, and signing out deletes them. To save them first, cancel and open the layout again. Sign out anyway?',
    )
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
