/**
 * The editor's analysis: badges, seat rings and fading worked out from the
 * canvas, guests, rules and picked groups, and worked out again when the
 * canvas or an input changes (acceptance checks 14 and 15 in the editor).
 */
import { describe, expect, it } from 'vitest'
import type { Canvas, Item, Seat, Table } from '@/domain/canvas-schema'
import type { ProblemsGuest } from '@/domain/problems'
import { createStore } from '../state/store'
import { createAnalysis, itemMarks } from './analysis'

const G = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const [A, B, C] = [1, 2, 3].map(G)

function table(n: number, taken: Record<number, string> = {}): Table {
  const seats: Seat[] = Array.from({ length: 8 }, (_, index) => ({ index, guestId: taken[index] ?? null }))
  return {
    id: `t${n}`,
    kind: 'table',
    shape: 'round',
    x: n * 400,
    y: 0,
    rotation: 0,
    locked: false,
    width: 152.4,
    height: 152.4,
    number: n,
    name: `Table ${n}`,
    seatCount: 8,
    seatSides: 'all',
    seats,
  }
}

const guest = (id: string, extra: Partial<ProblemsGuest> = {}): ProblemsGuest => ({
  id,
  firstName: 'G',
  lastName: id.slice(-1),
  rsvp: 'yes',
  partnerId: null,
  coupleRuleEnabled: true,
  ...extra,
})

function doc(...items: Item[]) {
  return createStore<{ canvas: Canvas }>({ canvas: { schemaVersion: 1, items } })
}

describe('editor analysis', () => {
  it('badges both tables and the seats of partners seated apart, and counts it once', () => {
    const store = doc(table(1, { 0: A }), table(2, { 0: B }))
    const analysis = createAnalysis(store, { guests: [guest(A, { partnerId: B }), guest(B, { partnerId: A })] })
    const a = analysis.store.getState().analysis
    expect(a.list.problemCount).toBe(1)
    for (const t of a.items) {
      const marks = itemMarks(a, t)
      expect(marks.badge).toBe('problem')
      expect(marks.seats[0].problem).toBe(true)
      expect(marks.seats[1].problem).toBe(false)
    }
  })

  it('clears an apart problem when one guest moves away, and marks unfinished rules grey', () => {
    const store = doc(table(1, { 0: A, 1: B }), table(2))
    const rules = [
      { id: 'r1', kind: 'apart' as const, guestIds: [A, B], nextToEachOther: false, appliesTo: 'both' as const, enabled: true },
      { id: 'r2', kind: 'together' as const, guestIds: [A, C], nextToEachOther: false, appliesTo: 'both' as const, enabled: true },
    ]
    const analysis = createAnalysis(store, { guests: [guest(A), guest(B), guest(C)], rules })
    expect(analysis.store.getState().analysis.list.problemCount).toBe(1)
    store.setState({ canvas: { schemaVersion: 1, items: [table(1, { 0: A }), table(2, { 0: B })] } })
    const a = analysis.store.getState().analysis
    expect(a.list.problemCount).toBe(0)
    const t1 = itemMarks(a, a.items[0])
    expect(t1.badge).toBe('unfinished')
    expect(t1.seats[0].unfinished).toBe(true)
    expect(itemMarks(a, a.items[1]).badge).toBe(null)
  })

  it('rings picked group members in the group color and fades the rest', () => {
    const store = doc(table(1, { 0: A, 1: B }), table(2, { 0: C }))
    const analysis = createAnalysis(store, { guests: [guest(A), guest(B), guest(C)], groups: [{ id: 'g1', color: '#DB2777', memberIds: [A] }] })
    expect(itemMarks(analysis.store.getState().analysis, store.getState().canvas.items[0]).faded).toBe(false)
    analysis.setInputs({ chosen: ['g1'] })
    const a = analysis.store.getState().analysis
    const t1 = itemMarks(a, a.items[0])
    expect(t1.faded).toBe(false)
    expect(t1.seats[0]).toMatchObject({ ring: '#DB2777', faded: false })
    expect(t1.seats[1]).toMatchObject({ ring: null, faded: true })
    expect(itemMarks(a, a.items[1]).faded).toBe(true)
  })
})
