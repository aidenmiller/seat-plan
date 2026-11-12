/**
 * Moving unsaved edits from before accounts (legacy-drafts.ts) out of the
 * old shared databases and into the signed-in user's own, against
 * fake-indexeddb: what moves and how it is stamped, running it again or in
 * two tabs at once, and that nothing is lost when a step fails or an older
 * tab writes meanwhile.
 */
import 'fake-indexeddb/auto'
import { createStore, entries, set, type UseStore } from 'idb-keyval'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Canvas } from '@/domain/canvas-schema'
import { openKeyvalStore } from './idb'
import { adoptLegacyDrafts } from './legacy-drafts'
import { createDraftStore, draftKey } from './outbox'
import { createRowStore } from './row-save'
import { DRAFT_STORE_NAME, draftDbName, LEGACY_DRAFT_DB_NAME, LEGACY_ROW_DB_NAME, ROW_STORE_NAME, rowDbName } from './storage-names'

const L1 = '6f1c2b9e-3d4a-4c5b-8e7f-0a1b2c3d4e5f'
const GUEST = '0b9f6a3e-6c1d-4c8e-9f57-2a1d6f1e7a10'
let n = 0
/** A fresh user per test: their databases start empty. */
let user = ''

function canvasN(x: number): Canvas {
  return {
    schemaVersion: 1,
    items: [{ id: 'f1', kind: 'fixture', type: 'bar', x, y: 0, rotation: 0, locked: false, width: 100, height: 50, label: 'Bar' }],
  }
}

/** A draft as the app wrote it before accounts: a Noa / Aiden name and no user. */
function oldDraft(tabId: string, x = 1, updatedAt = '2026-11-09T12:00:00.000Z') {
  return { layoutId: L1, tabId, baseVersion: 2, canvas: canvasN(x), editedBy: 'Aiden', inFlight: null, dirty: true, updatedAt }
}

function oldRow(id: string) {
  return { queueId: 'old-tab', kind: 'guest' as const, id, patch: { meal: 'Fish' }, queuedAt: '2026-11-09T12:00:00.000Z' }
}

/** The old shared databases, written the way the app wrote them (its connection lets go when asked). */
const legacyDrafts = (): UseStore => openKeyvalStore(LEGACY_DRAFT_DB_NAME, DRAFT_STORE_NAME)
const legacyRows = (): UseStore => openKeyvalStore(LEGACY_ROW_DB_NAME, ROW_STORE_NAME)
/** The old drafts database as a tab of an older app version keeps it open: idb-keyval never closes its connection. */
const olderTab = (): UseStore => createStore(LEGACY_DRAFT_DB_NAME, DRAFT_STORE_NAME)
const closeOlderTab = (store: UseStore) => store('readonly', (s) => s.transaction.db.close())

async function databases(): Promise<string[]> {
  return (await indexedDB.databases()).map((d) => d.name ?? '')
}

function deleteDb(name: string): Promise<void> {
  return new Promise((resolve) => {
    const r = indexedDB.deleteDatabase(name)
    r.onsuccess = r.onerror = r.onblocked = () => resolve()
  })
}

beforeEach(async () => {
  user = `user-${++n}`
  await deleteDb(LEGACY_DRAFT_DB_NAME)
  await deleteDb(LEGACY_ROW_DB_NAME)
})

afterEach(async () => {
  await deleteDb(LEGACY_DRAFT_DB_NAME)
  await deleteDb(LEGACY_ROW_DB_NAME)
})

describe('adoptLegacyDrafts', () => {
  it('does nothing, and makes no database, when there is nothing from before accounts', async () => {
    expect(await adoptLegacyDrafts(user)).toEqual({ drafts: 'none', rows: 'none' })
    const names = await databases()
    expect(names).not.toContain(LEGACY_DRAFT_DB_NAME)
    expect(names).not.toContain(LEGACY_ROW_DB_NAME)
  })

  it('moves drafts and queued row edits into this user’s databases, stamped with their id, then removes the old ones', async () => {
    const old = { drafts: legacyDrafts(), rows: legacyRows() }
    await set(draftKey(L1, 'a'), oldDraft('a', 1), old.drafts)
    await set(draftKey(L1, 'b'), oldDraft('b', 2), old.drafts)
    await set(`old-tab|guest|${GUEST}`, oldRow(GUEST), old.rows)

    expect(await adoptLegacyDrafts(user)).toEqual({ drafts: 'moved', rows: 'moved' })

    const drafts = await createDraftStore({ userId: user }).listDrafts(L1)
    expect(drafts.map((d) => d.tabId).sort()).toEqual(['a', 'b'])
    for (const d of drafts) {
      expect(d.userId).toBe(user)
      expect(d).not.toHaveProperty('editedBy')
    }
    expect(drafts.find((d) => d.tabId === 'b')!.canvas).toEqual(canvasN(2))
    expect(await createRowStore({ userId: user }).list()).toEqual([{ ...oldRow(GUEST), userId: user }])

    const names = await databases()
    expect(names).not.toContain(LEGACY_DRAFT_DB_NAME)
    expect(names).not.toContain(LEGACY_ROW_DB_NAME)
    expect(names).toEqual(expect.arrayContaining([draftDbName(user), rowDbName(user)]))
  })

  it('is safe to run again: the second run finds nothing and changes nothing', async () => {
    await set(draftKey(L1, 'a'), oldDraft('a'), legacyDrafts())
    expect((await adoptLegacyDrafts(user)).drafts).toBe('moved')
    const before = await createDraftStore({ userId: user }).listDrafts(L1)
    expect(await adoptLegacyDrafts(user)).toEqual({ drafts: 'none', rows: 'none' })
    expect(await createDraftStore({ userId: user }).listDrafts(L1)).toEqual(before)
  })

  it('is safe in two tabs at once: each draft arrives once, and the old database goes', async () => {
    await set(draftKey(L1, 'a'), oldDraft('a'), legacyDrafts())
    await set(draftKey(L1, 'b'), oldDraft('b', 2), legacyDrafts())
    const [one, two] = await Promise.all([adoptLegacyDrafts(user), adoptLegacyDrafts(user)])
    expect([one.drafts, two.drafts]).toContain('moved')
    expect((await createDraftStore({ userId: user }).listDrafts(L1)).map((d) => d.tabId).sort()).toEqual(['a', 'b'])
    expect(await databases()).not.toContain(LEGACY_DRAFT_DB_NAME)
  })

  it('never overwrites this user’s newer draft of the same tab, but takes a newer one from the old database', async () => {
    const mine = createDraftStore({ userId: user })
    // This tab already wrote a newer draft since the reload.
    await mine.putDraft({ ...oldDraft('a', 9, '2026-11-09T13:00:00.000Z'), editedBy: undefined, userId: user } as never)
    await set(draftKey(L1, 'a'), oldDraft('a', 1, '2026-11-09T12:00:00.000Z'), legacyDrafts())
    await set(draftKey(L1, 'b'), oldDraft('b', 5, '2026-11-09T14:00:00.000Z'), legacyDrafts())
    await mine.putDraft({ ...oldDraft('b', 4, '2026-11-09T11:00:00.000Z'), editedBy: undefined, userId: user } as never)
    expect((await adoptLegacyDrafts(user)).drafts).toBe('moved')
    const byTab = new Map((await mine.listDrafts(L1)).map((d) => [d.tabId, d.canvas]))
    expect(byTab.get('a')).toEqual(canvasN(9))
    expect(byTab.get('b')).toEqual(canvasN(5))
  })

  it('keeps the old database whole when the copy fails, and moves it on the next load', async () => {
    await set(draftKey(L1, 'a'), oldDraft('a'), legacyDrafts())
    const broken = (): UseStore => () => Promise.reject(new DOMException('The quota has been exceeded.', 'QuotaExceededError'))
    expect((await adoptLegacyDrafts(user, { openTarget: broken })).drafts).toBe('failed')
    expect(await entries(legacyDrafts())).toEqual([[draftKey(L1, 'a'), oldDraft('a')]])
    expect(await createDraftStore({ userId: user }).listDrafts(L1)).toEqual([])

    expect((await adoptLegacyDrafts(user)).drafts).toBe('moved')
    expect(await createDraftStore({ userId: user }).listDrafts(L1)).toHaveLength(1)
  })

  it('keeps the old database whole when the check after the copy fails', async () => {
    await set(draftKey(L1, 'a'), oldDraft('a'), legacyDrafts())
    // A store that answers but keeps nothing.
    const forgetful = (dbName: string, storeName: string): UseStore => {
      const real = createStore(dbName, storeName)
      return (mode, callback) =>
        real(mode, (store) => {
          if (mode === 'readwrite') {
            store.put = (() => store.get('nothing')) as never
          }
          return callback(store)
        })
    }
    expect((await adoptLegacyDrafts(user, { openTarget: forgetful })).drafts).toBe('failed')
    expect(await entries(legacyDrafts())).toEqual([[draftKey(L1, 'a'), oldDraft('a')]])
  })

  it('keeps the old database when an older tab writes to it meanwhile, and moves the new draft next time', async () => {
    const old = legacyDrafts()
    await set(draftKey(L1, 'a'), oldDraft('a'), old)
    const result = await adoptLegacyDrafts(user, {
      // Another tab saves a draft into the old database after the copy was checked.
      beforeRemove: async (name) => {
        if (name === LEGACY_DRAFT_DB_NAME) await set(draftKey(L1, 'late'), oldDraft('late', 3), old)
      },
    })
    expect(result.drafts).toBe('kept')
    // Both are still in the old database, and the first is in the user's already.
    expect((await entries(old)).map(([k]) => k).sort()).toEqual([draftKey(L1, 'a'), draftKey(L1, 'late')].sort())
    expect((await createDraftStore({ userId: user }).listDrafts(L1)).map((d) => d.tabId)).toEqual(['a'])

    // The next load moves the late one too, and then the old database goes.
    expect((await adoptLegacyDrafts(user)).drafts).toBe('moved')
    expect((await createDraftStore({ userId: user }).listDrafts(L1)).map((d) => d.tabId).sort()).toEqual(['a', 'late'])
    expect(await databases()).not.toContain(LEGACY_DRAFT_DB_NAME)
  })

  it('waits, without losing anything, while an older tab holds the old database open', async () => {
    const old = olderTab()
    await set(draftKey(L1, 'a'), oldDraft('a'), old)
    const result = await adoptLegacyDrafts(user, { blockedWaitMs: 100 })
    // The older tab's connection blocks the removal; the copy is done and checked.
    expect(result.drafts).toBe('kept')
    expect((await createDraftStore({ userId: user }).listDrafts(L1)).map((d) => d.tabId)).toEqual(['a'])
    expect(await databases()).toContain(LEGACY_DRAFT_DB_NAME)
    // Once that tab closes, the waiting removal checks the old database again (unchanged) and drops it; the next load deletes what is left.
    await closeOlderTab(old)
    await new Promise((r) => setTimeout(r, 50))
    expect(await adoptLegacyDrafts(user)).toEqual({ drafts: expect.stringMatching(/^(moved|none)$/), rows: 'none' })
    expect(await databases()).not.toContain(LEGACY_DRAFT_DB_NAME)
    expect((await createDraftStore({ userId: user }).listDrafts(L1)).map((d) => d.tabId)).toEqual(['a'])
  })

  it('an older tab that wrote while the removal waited keeps its draft', async () => {
    const old = olderTab()
    await set(draftKey(L1, 'a'), oldDraft('a'), old)
    expect((await adoptLegacyDrafts(user, { blockedWaitMs: 100 })).drafts).toBe('kept')
    // The older tab saves again before it closes; the waiting removal then finds a change and leaves everything.
    await set(draftKey(L1, 'late'), oldDraft('late', 3), old)
    await closeOlderTab(old)
    await new Promise((r) => setTimeout(r, 50))
    expect((await entries(legacyDrafts())).map(([k]) => k).sort()).toEqual([draftKey(L1, 'a'), draftKey(L1, 'late')].sort())
    expect((await adoptLegacyDrafts(user)).drafts).toBe('moved')
    expect((await createDraftStore({ userId: user }).listDrafts(L1)).map((d) => d.tabId).sort()).toEqual(['a', 'late'])
  })

  it('leaves an entry it cannot read as a draft in the user’s store too, where it is skipped as before', async () => {
    await set('layout:junk', { hello: 'there' }, legacyDrafts())
    expect((await adoptLegacyDrafts(user)).drafts).toBe('moved')
    expect(await createDraftStore({ userId: user }).listDrafts(L1)).toEqual([])
  })
})
