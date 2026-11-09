import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import type { Canvas } from '@/domain/canvas-schema'
import { createDraftStore } from './outbox'
import { decideRecovery, findOrphanDrafts, inFlightLanded, jsonEqual, pickRecovery, sameCanvas } from './recovery'
import type { DraftSnapshot } from './types'

const LAYOUT = '6f1c2b9e-3d4a-4c5b-8e7f-0a1b2c3d4e5f'
const SAVE_A = 'aaaaaaaa-1111-4111-8111-111111111111'
const SAVE_B = 'bbbbbbbb-2222-4222-8222-222222222222'
const SAVE_C = 'cccccccc-3333-4333-8333-333333333333'

function canvasN(n: number): Canvas {
  return {
    schemaVersion: 1,
    items: [{ id: 'f1', kind: 'fixture', type: 'bar', x: n, y: 0, rotation: 0, locked: false, width: 100, height: 50, label: 'Bar' }],
  }
}

function draft(over: Partial<DraftSnapshot> = {}): DraftSnapshot {
  return {
    layoutId: LAYOUT,
    tabId: 'tab-1',
    baseVersion: 5,
    canvas: canvasN(1),
    editedBy: 'Noa',
    inFlight: null,
    dirty: true,
    updatedAt: '2026-11-09T12:00:00.000Z',
    ...over,
  }
}

describe('decideRecovery', () => {
  it('discards a draft with nothing unsaved', () => {
    expect(decideRecovery({ version: 5, lastSaveId: null }, draft({ dirty: false }))).toBe('discard')
    expect(decideRecovery({ version: 9, lastSaveId: SAVE_B }, draft({ dirty: false }))).toBe('discard')
  })

  it('discards when the in-flight save landed and nothing newer is in the draft', () => {
    const d = draft({ inFlight: { saveId: SAVE_A, baseVersion: 5, canvas: canvasN(1) } })
    expect(decideRecovery({ version: 6, lastSaveId: SAVE_A }, d)).toBe('discard')
  })

  it('compares canvases by content, since stored drafts lose shared objects', () => {
    const d = draft({ canvas: canvasN(1), inFlight: { saveId: SAVE_A, baseVersion: 5, canvas: structuredClone(canvasN(1)) } })
    expect(decideRecovery({ version: 6, lastSaveId: SAVE_A }, d)).toBe('discard')
    expect(sameCanvas(canvasN(1), canvasN(1))).toBe(true)
    expect(sameCanvas(canvasN(1), canvasN(2))).toBe(false)
  })

  it('continues from the server version when the in-flight save landed and later edits wait', () => {
    const d = draft({ canvas: canvasN(2), inFlight: { saveId: SAVE_A, baseVersion: 5, canvas: canvasN(1) } })
    expect(decideRecovery({ version: 6, lastSaveId: SAVE_A }, d)).toEqual({
      kind: 'apply',
      canvas: canvasN(2),
      baseVersion: 6,
    })
  })

  it('applies a draft that starts from the server version', () => {
    expect(decideRecovery({ version: 5, lastSaveId: SAVE_B }, draft())).toEqual({
      kind: 'apply',
      canvas: canvasN(1),
      baseVersion: 5,
    })
  })

  it('applies a draft whose in-flight save never landed while the server stayed put', () => {
    const d = draft({ canvas: canvasN(2), inFlight: { saveId: SAVE_A, baseVersion: 5, canvas: canvasN(1) } })
    expect(decideRecovery({ version: 5, lastSaveId: SAVE_B }, d)).toEqual({
      kind: 'apply',
      canvas: canvasN(2),
      baseVersion: 5,
    })
  })

  it('shows a conflict when the server moved on without this draft', () => {
    expect(decideRecovery({ version: 7, lastSaveId: SAVE_B }, draft())).toEqual({
      kind: 'conflict',
      canvas: canvasN(1),
      partlySaved: false,
    })
  })

  it('shows a conflict when someone saved after the in-flight save', () => {
    const d = draft({ canvas: canvasN(2), inFlight: { saveId: SAVE_A, baseVersion: 5, canvas: canvasN(1) } })
    expect(decideRecovery({ version: 7, lastSaveId: SAVE_B, recentSaveIds: [SAVE_B, SAVE_C] }, d)).toEqual({
      kind: 'conflict',
      canvas: canvasN(2),
      partlySaved: false,
    })
  })

  it('compares JSON without caring about key order or undefined keys', () => {
    const reordered = { items: [{ label: 'Bar', height: 50, width: 100, locked: false, rotation: 0, y: 0, x: 1, type: 'bar', kind: 'fixture', id: 'f1' }], schemaVersion: 1 }
    expect(sameCanvas(canvasN(1), reordered as Canvas)).toBe(true)
    expect(jsonEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true)
    expect(jsonEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    expect(jsonEqual([1, 2], [2, 1])).toBe(false)
    expect(jsonEqual([1], { 0: 1 })).toBe(false)
    expect(jsonEqual(null, {})).toBe(false)
  })

  describe('with recent save ids', () => {
    const landed = (canvas: Canvas) => draft({ canvas, inFlight: { saveId: SAVE_A, baseVersion: 5, canvas: canvasN(1) } })

    it('counts the in-flight save as landed when it is among the recent saves', () => {
      expect(inFlightLanded({ version: 7, lastSaveId: SAVE_B, recentSaveIds: [SAVE_B, SAVE_A] }, landed(canvasN(1)))).toBe(true)
      expect(inFlightLanded({ version: 6, lastSaveId: SAVE_A }, landed(canvasN(1)))).toBe(true)
      expect(inFlightLanded({ version: 7, lastSaveId: SAVE_B, recentSaveIds: [SAVE_B, SAVE_C] }, landed(canvasN(1)))).toBe(false)
      expect(inFlightLanded({ version: 7, lastSaveId: SAVE_B, recentSaveIds: [SAVE_A] }, draft())).toBe(false)
    })

    it('discards a draft with nothing after its landed save, even when someone saved since', () => {
      expect(decideRecovery({ version: 7, lastSaveId: SAVE_B, recentSaveIds: [SAVE_B, SAVE_A] }, landed(canvasN(1)))).toBe(
        'discard',
      )
    })

    it('applies the later edits on the server version when the landed save is still the last one', () => {
      expect(decideRecovery({ version: 6, lastSaveId: SAVE_A, recentSaveIds: [SAVE_A, SAVE_B] }, landed(canvasN(2)))).toEqual({
        kind: 'apply',
        canvas: canvasN(2),
        baseVersion: 6,
      })
    })

    it('shows a conflict for the later edits only when someone saved after the landed save', () => {
      expect(decideRecovery({ version: 7, lastSaveId: SAVE_B, recentSaveIds: [SAVE_B, SAVE_A] }, landed(canvasN(2)))).toEqual({
        kind: 'conflict',
        canvas: canvasN(2),
        partlySaved: true,
      })
    })
  })

  it('discards a draft that already matches the server canvas', () => {
    // The save landed but the draft never heard back (a keepalive save on close, say).
    expect(decideRecovery({ version: 6, lastSaveId: SAVE_B, canvas: canvasN(1) }, draft())).toBe('discard')
  })
})

describe('pickRecovery', () => {
  it('discards empty drafts and acts on the newest one that holds something', () => {
    const clean = draft({ tabId: 'clean', dirty: false, updatedAt: '2026-11-09T12:00:09.000Z' })
    const older = draft({ tabId: 'older', updatedAt: '2026-11-09T12:00:01.000Z' })
    const newer = draft({ tabId: 'newer', canvas: canvasN(3), updatedAt: '2026-11-09T12:00:05.000Z' })
    const plan = pickRecovery({ version: 5, lastSaveId: null }, [older, clean, newer])
    expect(plan.discard).toEqual([clean])
    expect(plan.next).toEqual({ draft: newer, decision: { kind: 'apply', canvas: canvasN(3), baseVersion: 5 } })
    expect(plan.later).toEqual([older])
    expect(plan.moveAside).toBeNull()
  })

  it('has nothing to do without drafts', () => {
    expect(pickRecovery({ version: 1, lastSaveId: null }, [])).toEqual({ discard: [], next: null, later: [], moveAside: null })
  })

  it('moves this tab’s own older draft aside when another tab’s newer draft is acted on', () => {
    const own = draft({ tabId: 'me', canvas: canvasN(1), updatedAt: '2026-11-09T12:00:01.000Z' })
    const other = draft({ tabId: 'closed', canvas: canvasN(2), updatedAt: '2026-11-09T12:00:05.000Z' })
    const plan = pickRecovery({ version: 5, lastSaveId: null }, [own, other], { ownTabId: 'me' })
    expect(plan.next?.draft).toBe(other)
    expect(plan.later).toEqual([own])
    expect(plan.moveAside).toBe(own)
  })

  it('leaves this tab’s own draft in place when it is the one acted on, or holds nothing', () => {
    const own = draft({ tabId: 'me', canvas: canvasN(1), updatedAt: '2026-11-09T12:00:05.000Z' })
    const other = draft({ tabId: 'closed', canvas: canvasN(2), updatedAt: '2026-11-09T12:00:01.000Z' })
    expect(pickRecovery({ version: 5, lastSaveId: null }, [own, other], { ownTabId: 'me' }).moveAside).toBeNull()
    const clean = draft({ tabId: 'me', dirty: false, updatedAt: '2026-11-09T12:00:01.000Z' })
    const plan = pickRecovery({ version: 5, lastSaveId: null }, [clean, other], { ownTabId: 'me' })
    expect(plan.discard).toEqual([clean])
    expect(plan.moveAside).toBeNull()
  })
})

describe('findOrphanDrafts', () => {
  it('returns drafts whose tab lock is free, plus this tab’s own from before a reload', async () => {
    const store = createDraftStore({ dbName: 'recovery-orphans' })
    await store.putDraft(draft({ tabId: 'open', updatedAt: '2026-11-09T12:00:01.000Z' }))
    await store.putDraft(draft({ tabId: 'closed', updatedAt: '2026-11-09T12:00:02.000Z' }))
    await store.putDraft(draft({ tabId: 'me', updatedAt: '2026-11-09T12:00:03.000Z' }))
    await store.putDraft(draft({ layoutId: 'other-layout', tabId: 'closed' }))
    const isTabAlive = vi.fn(async (tabId: string) => tabId === 'open' || tabId === 'me')
    const orphans = await findOrphanDrafts(LAYOUT, { drafts: store, isTabAlive, ownTabId: 'me' })
    expect(orphans.map((d) => d.tabId)).toEqual(['me', 'closed'])
    expect(isTabAlive).not.toHaveBeenCalledWith('me')
  })

  it('recovers a stored in-flight save that landed', async () => {
    const store = createDraftStore({ dbName: 'recovery-roundtrip' })
    const c = canvasN(4)
    await store.putDraft(draft({ tabId: 'gone', canvas: c, inFlight: { saveId: SAVE_A, baseVersion: 5, canvas: c } }))
    const [stored] = await findOrphanDrafts(LAYOUT, { drafts: store, isTabAlive: async () => false })
    expect(decideRecovery({ version: 6, lastSaveId: SAVE_A }, stored)).toBe('discard')
  })
})
