import { describe, expect, it } from 'vitest'
import type { Canvas, ChairRow, Table } from './canvas-schema'
import { cleanSeats, seatedGuestIds } from './seat-cleanup'

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const C = '00000000-0000-4000-8000-00000000000c'
const GONE = '00000000-0000-4000-8000-0000000000ff'
const STRANGER = '00000000-0000-4000-8000-0000000000ee'

function table(id: string, guests: (string | null)[], extra: Partial<Table> = {}): Table {
  return {
    id,
    kind: 'table',
    x: 0,
    y: 0,
    rotation: 0,
    locked: false,
    shape: 'round',
    width: 152.4,
    height: 152.4,
    number: 1,
    name: 'Table 1',
    seatCount: guests.length,
    seatSides: 'all',
    seats: guests.map((guestId, index) => ({ index, guestId })),
    ...extra,
  }
}

function row(id: string, guests: (string | null)[]): ChairRow {
  return {
    id,
    kind: 'chairRow',
    x: 0,
    y: 0,
    rotation: 0,
    locked: false,
    chairCount: guests.length,
    spacing: 50.8,
    blockId: null,
    blockLabel: null,
    rowNumber: 1,
    rowLabel: '',
    reservedFor: null,
    seats: guests.map((guestId, index) => ({ index, guestId })),
  }
}

const canvas = (...items: Canvas['items']): Canvas => ({ schemaVersion: 1, items })

describe('cleanSeats', () => {
  it('keeps a clean canvas as the same object and drops nothing', () => {
    const c = canvas(table('t1', [A, null, B]), row('r1', [C]))
    const out = cleanSeats(c, new Set([A, B, C]))
    expect(out.dropped).toEqual([])
    expect(out.canvas).toBe(c)
  })

  it('empties seats of removed and unknown guests and names the reason', () => {
    const c = canvas(table('t1', [A, GONE, STRANGER]))
    const out = cleanSeats(c, new Set([A]), new Set([GONE]))
    expect(out.dropped).toEqual([
      { itemId: 't1', seatIndex: 1, guestId: GONE, reason: 'removed-guest' },
      { itemId: 't1', seatIndex: 2, guestId: STRANGER, reason: 'unknown-guest' },
    ])
    const seats = (out.canvas.items[0] as Table).seats
    expect(seats.map((s) => s.guestId)).toEqual([A, null, null])
  })

  it('treats every id outside both sets as unknown when no removed set is given', () => {
    const out = cleanSeats(canvas(table('t1', [GONE])), new Set())
    expect(out.dropped[0]!.reason).toBe('unknown-guest')
  })

  it('keeps the first seat by item order, then seat order, and empties the rest', () => {
    const c = canvas(table('t1', [null, B, A]), row('r1', [A, B]), table('t2', [A]))
    const out = cleanSeats(c, new Set([A, B]))
    expect(out.dropped).toEqual([
      { itemId: 'r1', seatIndex: 0, guestId: A, reason: 'second-seat' },
      { itemId: 'r1', seatIndex: 1, guestId: B, reason: 'second-seat' },
      { itemId: 't2', seatIndex: 0, guestId: A, reason: 'second-seat' },
    ])
    expect(seatedGuestIds(out.canvas).sort()).toEqual([A, B].sort())
    expect((out.canvas.items[0] as Table).seats.map((s) => s.guestId)).toEqual([null, B, A])
  })

  it('a guest twice at one table keeps the lower seat', () => {
    const out = cleanSeats(canvas(table('t1', [A, null, A])), new Set([A]))
    expect(out.dropped).toEqual([{ itemId: 't1', seatIndex: 2, guestId: A, reason: 'second-seat' }])
  })

  it('a removed guest seated twice is reported twice as removed, never as a second seat', () => {
    const out = cleanSeats(canvas(table('t1', [GONE]), table('t2', [GONE])), new Set(), new Set([GONE]))
    expect(out.dropped.map((d) => d.reason)).toEqual(['removed-guest', 'removed-guest'])
  })

  it('never changes its input, and shares untouched items', () => {
    const t1 = table('t1', [A])
    const t2 = table('t2', [GONE], { seats: [{ index: 0, guestId: GONE, pinned: true }] })
    const c = canvas(t1, t2)
    const before = structuredClone(c)
    const out = cleanSeats(c, new Set([A]), new Set([GONE]))
    expect(c).toEqual(before)
    expect(out.canvas).not.toBe(c)
    expect(out.canvas.items[0]).toBe(t1)
    expect(out.canvas.items[1]).not.toBe(t2)
    // Only the guest goes; the seat keeps its other fields.
    expect((out.canvas.items[1] as Table).seats[0]).toEqual({ index: 0, guestId: null, pinned: true })
  })

  it('leaves items without seats alone', () => {
    const c = canvas({
      id: 'f1',
      kind: 'fixture',
      type: 'bar',
      x: 0,
      y: 0,
      rotation: 0,
      locked: false,
      width: 100,
      height: 50,
      label: 'Bar',
    })
    expect(cleanSeats(c, new Set()).canvas).toBe(c)
  })
})

describe('seatedGuestIds', () => {
  it('lists each seated guest once, across tables and rows', () => {
    expect(seatedGuestIds(canvas(table('t1', [A, null, A]), row('r1', [B])))).toEqual([A, B])
  })
})
