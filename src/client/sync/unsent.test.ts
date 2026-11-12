/**
 * What a user's databases still hold unsent (unsent.ts), read against
 * fake-indexeddb the way signing out reads them before it deletes them.
 */
import 'fake-indexeddb/auto'
import { set } from 'idb-keyval'
import { describe, expect, it } from 'vitest'
import { emptyCanvas } from '@/domain/canvas-schema'
import { openKeyvalStore } from './idb'
import { createDraftStore } from './outbox'
import { createRowStore } from './row-save'
import { DRAFT_STORE_NAME, draftDbName, ROW_STORE_NAME, rowDbName } from './storage-names'
import type { DraftSnapshot } from './types'
import { unsentOnDevice } from './unsent'

const L1 = '6f1c2b9e-3d4a-4c5b-8e7f-0a1b2c3d4e5f'
const L2 = '7a2d3c0f-4e5b-4d6c-9f80-1b2c3d4e5f60'
const L3 = '8b3e4d10-5f6c-4e7d-8091-2c3d4e5f6071'
let n = 0
const fresh = () => `44444444-4444-4444-8444-${String(++n).padStart(12, '0')}`

function draft(userId: string, layoutId: string, tabId: string, over: Partial<DraftSnapshot> = {}): DraftSnapshot {
  return { layoutId, tabId, baseVersion: 2, canvas: emptyCanvas(), userId, inFlight: null, dirty: true, updatedAt: '2026-11-09T12:00:00.000Z', ...over }
}

async function names(): Promise<string[]> {
  return (await indexedDB.databases()).map((d) => d.name ?? '')
}

describe('unsentOnDevice', () => {
  it('counts layouts with a draft holding edits, and guests and groups with queued edits, each once', async () => {
    const user = fresh()
    const drafts = createDraftStore({ userId: user })
    await drafts.putDraft(draft(user, L1, 'a'))
    await drafts.putDraft(draft(user, L1, 'b'))
    // A save that never answered: it may not have landed.
    await drafts.putDraft(draft(user, L2, 'c', { dirty: false, inFlight: { saveId: 's', baseVersion: 2, canvas: emptyCanvas() } }))
    // Nothing unsaved in it.
    await drafts.putDraft(draft(user, L3, 'd', { dirty: false }))
    const rows = createRowStore({ userId: user })
    await rows.put({ queueId: 'q1', kind: 'guest', id: 'g1', patch: { meal: 'Fish' }, queuedAt: '2026-11-09T12:00:00.000Z' })
    await rows.put({ queueId: 'q2', kind: 'guest', id: 'g1', patch: { meal: 'Veg' }, queuedAt: '2026-11-09T12:00:00.000Z' })
    await rows.put({ queueId: 'q2', kind: 'group', id: 'gr1', patch: { name: 'Cousins' }, queuedAt: '2026-11-09T12:00:00.000Z' })
    expect(await unsentOnDevice(user)).toEqual({ layouts: 2, guests: 1, groups: 1 })
  })

  it('skips what is not this user’s edit: notes of adopted edits, unreadable entries, and another user’s stamp', async () => {
    const user = fresh()
    const draftsDb = openKeyvalStore(draftDbName(user), DRAFT_STORE_NAME)
    const rowsDb = openKeyvalStore(rowDbName(user), ROW_STORE_NAME)
    await set('legacy-adopted:drafts:x', { adoptedAt: '2026-11-09T12:00:00.000Z' }, draftsDb)
    await set('layout:junk', { hello: 'there' }, draftsDb)
    await set(`layout:${L1}:t`, draft('someone-else', L1, 't'), draftsDb)
    await set('legacy-adopted:rows:x', { adoptedAt: '2026-11-09T12:00:00.000Z' }, rowsDb)
    await set('q|guest|g9', { queueId: 'q', kind: 'guest', id: 'g9', patch: {}, queuedAt: 'x', userId: 'someone-else' }, rowsDb)
    expect(await unsentOnDevice(user)).toEqual({ layouts: 0, guests: 0, groups: 0 })
  })

  it('finds nothing, and makes no database, for someone who never stored anything', async () => {
    const user = fresh()
    expect(await unsentOnDevice(user)).toEqual({ layouts: 0, guests: 0, groups: 0 })
    const all = await names()
    expect(all).not.toContain(draftDbName(user))
    expect(all).not.toContain(rowDbName(user))
  })
})
