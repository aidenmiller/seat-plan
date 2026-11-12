/**
 * Moving unsaved edits from before accounts (legacy-drafts.ts) out of the
 * old shared databases and into the signed-in user's own, against
 * fake-indexeddb: what moves and how it is stamped, running it again or in
 * two tabs at once, that nothing is lost when a step fails or an older tab
 * writes meanwhile, and that nothing adopted is ever copied (and sent) twice
 * while the old database stays.
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
    // Marked as the copy of the old row until the queue takes it over.
    expect(await createRowStore({ userId: user }).list()).toEqual([{ ...oldRow(GUEST), userId: user, legacyCopy: true }])

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
    // The first is in the user's database and out of the old one; the late one waits in the old one.
    expect((await entries(old)).map(([k]) => k)).toEqual([draftKey(L1, 'late')])
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
    // The older tab saves again before it closes; the waiting removal then finds it and leaves the old database.
    await set(draftKey(L1, 'late'), oldDraft('late', 3), old)
    await closeOlderTab(old)
    await new Promise((r) => setTimeout(r, 50))
    // The first draft left the old database once it was in the user's.
    expect((await entries(legacyDrafts())).map(([k]) => k)).toEqual([draftKey(L1, 'late')])
    expect((await adoptLegacyDrafts(user)).drafts).toBe('moved')
    expect((await createDraftStore({ userId: user }).listDrafts(L1)).map((d) => d.tabId).sort()).toEqual(['a', 'late'])
  })

  it('leaves an entry it cannot read as a draft in the user’s store too, where it is skipped as before', async () => {
    await set('layout:junk', { hello: 'there' }, legacyDrafts())
    expect((await adoptLegacyDrafts(user)).drafts).toBe('moved')
    expect(await createDraftStore({ userId: user }).listDrafts(L1)).toEqual([])
  })
})

/**
 * The old database can outlive a move: a tab of the older app version keeps
 * it open (idb-keyval never closes its connection), or the page goes away
 * between the copy and the removal. Meanwhile the row queue sends the copied
 * edits and removes them from the user's store, and the editor saves and
 * removes a copied draft. A later load must never copy those again: sending
 * an old edit a second time writes over anything saved since.
 */
describe('adoptLegacyDrafts when the old database stays', () => {
  const GUEST_2 = '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f'
  const rowKey = (id: string) => `old-tab|guest|${id}`
  function oldRowWith(id: string, meal: string) {
    return { ...oldRow(id), patch: { meal } }
  }
  /** Older tabs a test opened; closed after it, so a failing test cannot block the next one. */
  let olderTabs: UseStore[] = []
  /** The old rows database as a tab of an older app version keeps it open. */
  const olderRowsTab = (): UseStore => {
    const store = createStore(LEGACY_ROW_DB_NAME, ROW_STORE_NAME)
    olderTabs.push(store)
    return store
  }
  const olderDraftsTab = (): UseStore => {
    const store = olderTab()
    olderTabs.push(store)
    return store
  }
  const closeOlderRowsTab = (store: UseStore) => store('readonly', (s) => s.transaction.db.close())
  const settle = () => new Promise((r) => setTimeout(r, 50))

  afterEach(async () => {
    for (const store of olderTabs) await closeOlderRowsTab(store).catch(() => undefined)
    olderTabs = []
    await settle()
  })

  /** What the row queue does on a page load: takes every stored row over, sends it, and removes it. Returns what it sent. */
  async function queueSendsRows(): Promise<{ id: string; patch: unknown }[]> {
    const store = createRowStore({ userId: user })
    const rows = await store.list()
    for (const row of rows) await store.remove(row.queueId, row.kind, row.id)
    return rows.map((row) => ({ id: row.id, patch: row.patch }))
  }

  /** A device's record shared by the loads of one test (localStorage in the browser). */
  function deviceRecord() {
    const data = new Map<string, string>()
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) }
  }

  it('takes what it copied out of the old database, so a later load never copies it again while an older tab keeps it open', async () => {
    const old = olderRowsTab()
    await set(rowKey(GUEST), oldRow(GUEST), old)
    // Load 1: the copy is checked, but the older tab blocks the removal.
    expect((await adoptLegacyDrafts(user, { blockedWaitMs: 50 })).rows).toBe('kept')
    // What was copied is no longer in the old database, as the older tab sees it.
    expect(await entries(old)).toEqual([])
    expect(await queueSendsRows()).toEqual([{ id: GUEST, patch: { meal: 'Fish' } }])

    // The older tab queues another guest's edit, then closes.
    await set(rowKey(GUEST_2), oldRowWith(GUEST_2, 'Veg'), old)
    await closeOlderRowsTab(old)
    await settle()

    // Load 2: only the new edit; the first one is not sent again.
    expect((await adoptLegacyDrafts(user)).rows).toBe('moved')
    expect(await queueSendsRows()).toEqual([{ id: GUEST_2, patch: { meal: 'Veg' } }])
    expect(await databases()).not.toContain(LEGACY_ROW_DB_NAME)
  })

  it('adopts, once, an edit an older tab changed after it was copied', async () => {
    const old = olderRowsTab()
    await set(rowKey(GUEST), oldRowWith(GUEST, 'Fish'), old)
    const first = await adoptLegacyDrafts(user, {
      blockedWaitMs: 50,
      // The older tab changes the row between the copy and the removal.
      afterCopy: async (name) => {
        if (name === LEGACY_ROW_DB_NAME) await set(rowKey(GUEST), oldRowWith(GUEST, 'Veg'), old)
      },
    })
    expect(first.rows).toBe('kept')
    // The changed row stays in the old database; the copy of the first one is sent.
    expect(await entries(old)).toEqual([[rowKey(GUEST), oldRowWith(GUEST, 'Veg')]])
    expect(await queueSendsRows()).toEqual([{ id: GUEST, patch: { meal: 'Fish' } }])
    await closeOlderRowsTab(old)
    await settle()

    // Load 2 adopts the change; load 3 finds nothing.
    expect((await adoptLegacyDrafts(user)).rows).toBe('moved')
    expect(await queueSendsRows()).toEqual([{ id: GUEST, patch: { meal: 'Veg' } }])
    expect(await adoptLegacyDrafts(user)).toEqual({ drafts: 'none', rows: 'none' })
    expect(await queueSendsRows()).toEqual([])
  })

  it('replaces a copy not sent yet with the older tab’s newer state of the same row', async () => {
    const old = olderRowsTab()
    await set(rowKey(GUEST), oldRowWith(GUEST, 'Fish'), old)
    expect((await adoptLegacyDrafts(user, { blockedWaitMs: 50 })).rows).toBe('kept')
    // Not sent yet (the older tab's queue is still open), and the older tab changes the row.
    await set(rowKey(GUEST), oldRowWith(GUEST, 'Veg'), old)
    await closeOlderRowsTab(old)
    await settle()
    expect((await adoptLegacyDrafts(user)).rows).toBe('moved')
    expect(await queueSendsRows()).toEqual([{ id: GUEST, patch: { meal: 'Veg' } }])
  })

  it('keeps everything when it stops between the copy and the removal, and the next load neither loses nor repeats anything', async () => {
    await set(rowKey(GUEST), oldRow(GUEST), legacyRows())
    await set(draftKey(L1, 'a'), oldDraft('a'), legacyDrafts())
    const stopped = await adoptLegacyDrafts(user, {
      afterCopy: async () => {
        throw new Error('The page went away')
      },
    })
    expect(stopped).toEqual({ drafts: 'failed', rows: 'failed' })
    // Nothing lost: the old databases are whole, and the copies are in the user's.
    expect(await entries(legacyRows())).toEqual([[rowKey(GUEST), oldRow(GUEST)]])
    expect(await entries(legacyDrafts())).toEqual([[draftKey(L1, 'a'), oldDraft('a')]])
    expect(await queueSendsRows()).toEqual([{ id: GUEST, patch: { meal: 'Fish' } }])
    // The layout is opened and the draft saved: the editor removes it.
    const mine = createDraftStore({ userId: user })
    expect((await mine.listDrafts(L1)).map((d) => d.tabId)).toEqual(['a'])
    await mine.deleteDraft(L1, 'a')

    // The next load copies neither again, and the old databases go.
    expect(await adoptLegacyDrafts(user)).toEqual({ drafts: 'moved', rows: 'moved' })
    expect(await queueSendsRows()).toEqual([])
    expect(await mine.listDrafts(L1)).toEqual([])
    const names = await databases()
    expect(names).not.toContain(LEGACY_ROW_DB_NAME)
    expect(names).not.toContain(LEGACY_DRAFT_DB_NAME)
  })

  it('a draft copied, saved and removed is not copied again while an older tab keeps the old database', async () => {
    const old = olderDraftsTab()
    await set(draftKey(L1, 'a'), oldDraft('a'), old)
    expect((await adoptLegacyDrafts(user, { blockedWaitMs: 50 })).drafts).toBe('kept')
    const mine = createDraftStore({ userId: user })
    await mine.deleteDraft(L1, 'a')
    // The older tab saves another draft, then closes.
    await set(draftKey(L1, 'late'), oldDraft('late', 3), old)
    await closeOlderTab(old)
    await settle()
    expect((await adoptLegacyDrafts(user)).drafts).toBe('moved')
    expect((await mine.listDrafts(L1)).map((d) => d.tabId)).toEqual(['late'])
  })

  it('in two tabs at once, never copies an edit back after the other tab’s queue sent it', async () => {
    await set(rowKey(GUEST), oldRow(GUEST), legacyRows())
    // The second tab has read the old database but its copy is slow to land.
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => {
      release = r
    })
    const slow = (dbName: string, storeName: string): UseStore => {
      const real = openKeyvalStore(dbName, storeName)
      return (mode, callback) => gate.then(() => real(mode, callback))
    }
    const second = adoptLegacyDrafts(user, { openTarget: slow })
    await settle()
    // The first tab moves everything, and its queue sends the edit.
    expect((await adoptLegacyDrafts(user)).rows).toBe('moved')
    expect(await queueSendsRows()).toEqual([{ id: GUEST, patch: { meal: 'Fish' } }])
    // The second tab's copy lands only now: the edit is not queued again.
    release()
    expect((await second).rows).toMatch(/^(moved|kept)$/)
    expect(await queueSendsRows()).toEqual([])
  })

  it('never takes over edits someone else on this device already adopted, even after their storage was deleted', async () => {
    const record = deviceRecord()
    await set(rowKey(GUEST), oldRow(GUEST), legacyRows())
    // Avery's load copies the edit, then stops before the removal.
    const avery = user
    expect((await adoptLegacyDrafts(avery, { deviceRecord: record, afterCopy: async () => Promise.reject(new Error('gone')) })).rows).toBe('failed')
    // Avery signs out: their databases are deleted.
    await deleteDb(rowDbName(avery))
    // Blake signs in next on this device: the old edit was Avery's, and is not sent again.
    const blake = `${avery}-blake`
    expect((await adoptLegacyDrafts(blake, { deviceRecord: record })).rows).toBe('moved')
    expect(await createRowStore({ userId: blake }).list()).toEqual([])
    expect(await databases()).not.toContain(LEGACY_ROW_DB_NAME)
  })
})
