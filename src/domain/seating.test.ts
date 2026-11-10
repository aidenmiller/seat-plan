import { describe, expect, it } from 'vitest'
import type { Canvas, ChairRow, Item, Seat, Table } from './canvas-schema'
import { seatLayout, SEAT_RADIUS_CM } from './seats'
import {
  applyDrop,
  chairRowSeatCenters,
  dropTarget,
  fullMessage,
  guestSeat,
  reorderWithinTable,
  seatAtTableFirstFree,
  seatGuest,
  seatsByGuest,
  unseatGuest,
  type SeatMove,
} from './seating'

const G = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const A = G(1)
const B = G(2)
const C = G(3)

function seats(n: number, taken: Record<number, string> = {}): Seat[] {
  return Array.from({ length: n }, (_, index) => ({ index, guestId: taken[index] ?? null }))
}

function table(id: string, x: number, taken: Record<number, string> = {}, overrides: Partial<Table> = {}): Table {
  const seatCount = overrides.seatCount ?? 8
  return {
    id,
    kind: 'table',
    shape: 'round',
    x,
    y: 0,
    rotation: 0,
    locked: false,
    width: 152.4,
    height: 152.4,
    number: Number(id.replace(/\D/g, '')) || 1,
    name: `Table ${Number(id.replace(/\D/g, '')) || 1}`,
    seatCount,
    seatSides: 'all',
    seats: seats(seatCount, taken),
    ...overrides,
  }
}

function row(id: string, taken: Record<number, string> = {}): ChairRow {
  return {
    id,
    kind: 'chairRow',
    x: 0,
    y: 600,
    rotation: 0,
    locked: false,
    chairCount: 6,
    spacing: 50.8,
    blockId: null,
    blockLabel: null,
    rowNumber: 1,
    rowLabel: '',
    reservedFor: null,
    seats: seats(6, taken),
  }
}

function canvas(...items: Item[]): Canvas {
  return { schemaVersion: 1, items }
}

function at(c: Canvas, itemId: string, index: number): string | null {
  const item = c.items.find((i) => i.id === itemId)
  if (!item || (item.kind !== 'table' && item.kind !== 'chairRow')) throw new Error('no such item')
  return item.seats[index].guestId
}

function seated(c: Canvas): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const item of c.items) {
    if (item.kind !== 'table' && item.kind !== 'chairRow') continue
    for (const s of item.seats) if (s.guestId) out.set(s.guestId, [...(out.get(s.guestId) ?? []), `${item.id}#${s.index}`])
  }
  return out
}

function move(result: SeatMove | 'full'): SeatMove {
  if (result === 'full') throw new Error('full')
  return result
}

describe('guestSeat', () => {
  it('finds the first seat by item order, then seat order', () => {
    const c = canvas(table('t1', 0, { 3: A }), table('t2', 400, { 1: B, 5: A }))
    expect(guestSeat(c, A)).toEqual({ itemId: 't1', seatIndex: 3 })
    expect(guestSeat(c, B)).toEqual({ itemId: 't2', seatIndex: 1 })
    expect(guestSeat(c, C)).toBeNull()
    expect(seatsByGuest(c)).toEqual(
      new Map([
        [A, { itemId: 't1', seatIndex: 3 }],
        [B, { itemId: 't2', seatIndex: 1 }],
      ]),
    )
  })
})

describe('seatGuest', () => {
  it('seats an unassigned guest in an empty seat, touching nothing else', () => {
    const c = canvas(table('t1', 0), table('t2', 400))
    const r = seatGuest(c, A, 't2', 4)
    expect(r).toMatchObject({ changed: true, seat: { itemId: 't2', seatIndex: 4 }, from: null, displaced: null })
    expect(at(r.canvas, 't2', 4)).toBe(A)
    expect(r.canvas.items[0]).toBe(c.items[0])
    // The input is left alone.
    expect(at(c, 't2', 4)).toBeNull()
  })

  it('moves a guest already seated in this layout', () => {
    const c = canvas(table('t1', 0, { 2: A }), table('t2', 400))
    const r = seatGuest(c, A, 't2', 0)
    expect(r).toMatchObject({ changed: true, from: { itemId: 't1', seatIndex: 2 }, seat: { itemId: 't2', seatIndex: 0 }, displaced: null })
    expect(seated(r.canvas)).toEqual(new Map([[A, ['t2#0']]]))
  })

  it('moves within one table', () => {
    const c = canvas(table('t1', 0, { 2: A }))
    const r = seatGuest(c, A, 't1', 6)
    expect(seated(r.canvas)).toEqual(new Map([[A, ['t1#6']]]))
  })

  it('swaps with the guest in a taken seat', () => {
    const c = canvas(table('t1', 0, { 0: A }), table('t2', 400, { 3: B }))
    const r = seatGuest(c, A, 't2', 3)
    expect(r.displaced).toEqual({ guestId: B, to: { itemId: 't1', seatIndex: 0 } })
    expect(seated(r.canvas)).toEqual(
      new Map([
        [B, ['t1#0']],
        [A, ['t2#3']],
      ]),
    )
  })

  it('sends the other guest to Unassigned when the dragged guest had no seat', () => {
    const c = canvas(table('t1', 0, { 3: B }))
    const r = seatGuest(c, A, 't1', 3)
    expect(r.displaced).toEqual({ guestId: B, to: null })
    expect(seated(r.canvas)).toEqual(new Map([[A, ['t1#3']]]))
  })

  it('carries a seat pinned flag with its guest', () => {
    const t1 = table('t1', 0, { 0: A, 1: B })
    t1.seats[0] = { index: 0, guestId: A, pinned: true }
    const r = seatGuest(canvas(t1), A, 't1', 1)
    const s = (r.canvas.items[0] as Table).seats
    expect(s[1]).toEqual({ index: 1, guestId: A, pinned: true })
    expect(s[0]).toEqual({ index: 0, guestId: B })
  })

  it('changes nothing for the seat the guest already has, or a seat that does not exist', () => {
    const c = canvas(table('t1', 0, { 2: A }), { ...table('f1', 0), kind: 'fixture' } as unknown as Item)
    for (const r of [seatGuest(c, A, 't1', 2), seatGuest(c, A, 't1', 8), seatGuest(c, A, 't1', -1), seatGuest(c, A, 'nope', 0), seatGuest(c, A, 'f1', 0)]) {
      expect(r.canvas).toBe(c)
      expect(r.changed).toBe(false)
      expect(r.from).toEqual({ itemId: 't1', seatIndex: 2 })
    }
  })

  it('leaves a guest the canvas held twice in one seat', () => {
    const c = canvas(table('t1', 0, { 0: A }), table('t2', 400, { 5: A, 6: B }))
    expect(seated(seatGuest(c, A, 't2', 1).canvas)).toEqual(
      new Map([
        [A, ['t2#1']],
        [B, ['t2#6']],
      ]),
    )
    // Dropped on the second of its two seats: kept there, the first emptied.
    const r = seatGuest(c, A, 't2', 5)
    expect(r.changed).toBe(true)
    expect(seated(r.canvas).get(A)).toEqual(['t2#5'])
  })

  it('seats guests on ceremony chairs too, locked or not', () => {
    const c = canvas({ ...row('r1', { 0: B }), locked: true })
    const r = seatGuest(c, A, 'r1', 0)
    expect(seated(r.canvas)).toEqual(new Map([[A, ['r1#0']]]))
  })
})

describe('seatAtTableFirstFree', () => {
  it('takes the lowest-numbered free seat', () => {
    const c = canvas(table('t1', 0, { 0: B, 1: C, 3: G(9) }))
    const r = move(seatAtTableFirstFree(c, A, 't1'))
    expect(r.seat).toEqual({ itemId: 't1', seatIndex: 2 })
    expect(at(r.canvas, 't1', 2)).toBe(A)
  })

  it("says 'full' when no seat is free, changing nothing", () => {
    const full = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [i, G(10 + i)]))
    expect(seatAtTableFirstFree(canvas(table('t1', 0, full)), A, 't1')).toBe('full')
    expect(seatAtTableFirstFree(canvas(table('t1', 0, {}, { seatCount: 0 })), A, 't1')).toBe('full')
  })

  it('keeps a guest who already sits at the table in their seat', () => {
    const c = canvas(table('t1', 0, { 4: A }))
    const r = move(seatAtTableFirstFree(c, A, 't1'))
    expect(r.canvas).toBe(c)
    expect(r.seat).toEqual({ itemId: 't1', seatIndex: 4 })
  })

  it('moves a guest from another table', () => {
    const c = canvas(table('t1', 0, { 4: A }), table('t2', 400, { 0: B }))
    const r = move(seatAtTableFirstFree(c, A, 't2'))
    expect(seated(r.canvas).get(A)).toEqual(['t2#1'])
    expect(r.from).toEqual({ itemId: 't1', seatIndex: 4 })
  })
})

describe('unseatGuest', () => {
  it('empties every seat the guest holds', () => {
    const c = canvas(table('t1', 0, { 0: A, 1: B }), table('t2', 400, { 2: A }))
    const r = unseatGuest(c, A)
    expect(r).toMatchObject({ changed: true, seat: null, from: { itemId: 't1', seatIndex: 0 } })
    expect(seated(r.canvas)).toEqual(new Map([[B, ['t1#1']]]))
  })

  it('returns the same canvas for a guest with no seat', () => {
    const c = canvas(table('t1', 0, { 1: B }))
    expect(unseatGuest(c, A).canvas).toBe(c)
  })
})

describe('reorderWithinTable', () => {
  it('moves to an empty seat and swaps with a taken one, like the canvas', () => {
    const c = canvas(table('t1', 0, { 0: A, 1: B }))
    expect(seated(reorderWithinTable(c, 't1', 0, 5).canvas)).toEqual(
      new Map([
        [B, ['t1#1']],
        [A, ['t1#5']],
      ]),
    )
    const swapped = reorderWithinTable(c, 't1', 0, 1)
    expect(swapped.displaced).toEqual({ guestId: B, to: { itemId: 't1', seatIndex: 0 } })
    expect(at(swapped.canvas, 't1', 0)).toBe(B)
    expect(at(swapped.canvas, 't1', 1)).toBe(A)
  })

  it('changes nothing from an empty seat, onto the same seat, or past the end', () => {
    const c = canvas(table('t1', 0, { 0: A }))
    expect(reorderWithinTable(c, 't1', 3, 0).canvas).toBe(c)
    expect(reorderWithinTable(c, 't1', 0, 0).canvas).toBe(c)
    expect(reorderWithinTable(c, 't1', 0, 8).canvas).toBe(c)
    expect(reorderWithinTable(c, 'zz', 0, 1).canvas).toBe(c)
  })
})

describe('dropTarget (PLAN "Seating guests")', () => {
  const t1 = table('t1', 0, { 0: B })
  const t2 = table('t2', 400)
  const places = seatLayout(t1)

  it('gives the seat whose circle holds the point, with whoever sits there', () => {
    const c = canvas(t1, t2)
    expect(dropTarget(c, places[0], 1)).toEqual({ kind: 'seat', itemId: 't1', seatIndex: 0, occupant: B })
    const edge = { x: places[2].x + SEAT_RADIUS_CM - 0.5, y: places[2].y }
    expect(dropTarget(c, edge, 1)).toEqual({ kind: 'seat', itemId: 't1', seatIndex: 2, occupant: null })
  })

  it("gives a table's first free seat for a drop on its top, or the dragged guest's own seat there", () => {
    const c = canvas(t1, t2)
    expect(dropTarget(c, { x: 10, y: 10 }, 1)).toEqual({ kind: 'table', itemId: 't1', seatIndex: 1 })
    const mine = canvas(table('t1', 0, { 0: B, 5: A }))
    expect(dropTarget(mine, { x: 0, y: 0 }, 1, { guestId: A })).toEqual({ kind: 'table', itemId: 't1', seatIndex: 5 })
  })

  it("says 'full' for a full table, naming it", () => {
    const full = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [i, G(10 + i)]))
    const c = canvas(table('t4', 0, full, { number: 4, name: 'Table 4' }))
    const target = dropTarget(c, { x: 0, y: 0 }, 1)
    expect(target).toEqual({ kind: 'full', itemId: 't4', label: 'Table 4' })
    expect(fullMessage('Table 4')).toBe('Table 4 is full')
    expect(applyDrop(c, A, target)).toBe('full')
  })

  it('gives the first free seat on the chair ring between seats, and nothing off the table', () => {
    const c = canvas(t1, t2)
    // Between seats 1 and 2, inside the chair ring but outside both circles.
    const mid = (a: number) => ({ x: Math.sin(a) * (76.2 + 50), y: -Math.cos(a) * (76.2 + 50) })
    const between = mid(Math.PI * 0.375)
    expect(Math.hypot(between.x - places[1].x, between.y - places[1].y)).toBeGreaterThan(SEAT_RADIUS_CM)
    expect(dropTarget(c, between, 1)).toEqual({ kind: 'table', itemId: 't1', seatIndex: 1 })
    expect(dropTarget(c, { x: 200, y: 300 }, 1)).toEqual({ kind: 'none' })
  })

  it('reaches a seat within 22 px on screen when zoomed out, but a drop on the table top still takes the first free seat', () => {
    const c = canvas(t1, t2)
    const outside = { x: places[2].x + 30, y: places[2].y }
    expect(dropTarget(c, outside, 1)).toEqual({ kind: 'none' })
    // At 50%, 22 px is 44 cm.
    expect(dropTarget(c, outside, 0.5)).toEqual({ kind: 'seat', itemId: 't1', seatIndex: 2, occupant: null })
    // At 10% the touch circle covers the whole table; its top still means "first free".
    expect(dropTarget(c, { x: 60, y: 0 }, 0.1)).toEqual({ kind: 'table', itemId: 't1', seatIndex: 1 })
    expect(dropTarget(c, { x: 0, y: -(76.2 + 30.5) }, 0.1)).toEqual({ kind: 'seat', itemId: 't1', seatIndex: 0, occupant: B })
  })

  it('never lands on a taken seat from outside its circle, at any zoom (review finding)', () => {
    const c = canvas(table('t1', 0, { 0: A, 1: B }))
    const placed = seatLayout(c.items[0] as Table)
    // On the chair ring halfway between seats 0 and 1, outside both circles.
    const between = { x: (placed[0].x + placed[1].x) / 2, y: (placed[0].y + placed[1].y) / 2 }
    expect(Math.hypot(between.x - placed[0].x, between.y - placed[0].y)).toBeGreaterThan(SEAT_RADIUS_CM)
    for (const zoom of [0.1, 0.3, 0.5, 0.8, 1, 2]) {
      expect(dropTarget(c, between, zoom), `zoom ${zoom}`).toEqual({ kind: 'table', itemId: 't1', seatIndex: 2 })
    }
    // A drop well outside the table beside a taken seat never takes it: zoomed right out
    // (22 px is 220 cm) the nearest empty seat, at 50% nothing.
    const beyond = { x: 0, y: placed[0].y - 80 }
    expect(dropTarget(c, beyond, 0.1)).toEqual({ kind: 'seat', itemId: 't1', seatIndex: 7, occupant: null })
    expect(dropTarget(c, beyond, 0.5)).toEqual({ kind: 'none' })
    // Beside an empty seat it still reaches that seat.
    const nearEmpty = { x: placed[4].x, y: placed[4].y + 60 }
    expect(dropTarget(c, nearEmpty, 0.1)).toEqual({ kind: 'seat', itemId: 't1', seatIndex: 4, occupant: null })
    // Inside a taken seat's circle, or just past its edge, it swaps.
    expect(dropTarget(c, { x: placed[1].x + SEAT_RADIUS_CM + 1, y: placed[1].y }, 1)).toEqual({ kind: 'seat', itemId: 't1', seatIndex: 1, occupant: B })
  })

  it('takes the topmost of overlapping tables, and only items it may reach', () => {
    const under = table('t1', 0)
    const over = table('t2', 20)
    const c = canvas(under, over)
    expect(dropTarget(c, { x: 10, y: 0 }, 1)).toMatchObject({ itemId: 't2' })
    expect(dropTarget(c, { x: 10, y: 0 }, 1, { reachable: (i) => i.id !== 't2' })).toMatchObject({ itemId: 't1' })
  })

  it('finds ceremony chairs, and a row between its chairs', () => {
    const r1 = row('r1', { 0: B })
    const centers = chairRowSeatCenters(r1)
    expect(centers).toHaveLength(6)
    // As ChairRowView draws them: the first chair at the row's left end, then one spacing apart.
    const length = 5 * 50.8 + 45
    expect(centers[0].x).toBeCloseTo(-length / 2 + SEAT_RADIUS_CM, 9)
    expect(centers[1].x - centers[0].x).toBeCloseTo(50.8, 9)
    const c = canvas(r1)
    expect(dropTarget(c, centers[3], 1)).toEqual({ kind: 'seat', itemId: 'r1', seatIndex: 3, occupant: null })
    expect(dropTarget(c, centers[0], 1)).toEqual({ kind: 'seat', itemId: 'r1', seatIndex: 0, occupant: B })
    const turned = { ...r1, rotation: 90 }
    const tc = chairRowSeatCenters(turned)
    expect(tc[0].x).toBeCloseTo(0, 9)
    expect(tc[0].y).toBeCloseTo(600 - length / 2 + SEAT_RADIUS_CM, 9)
  })

  it('applies a drop as one canvas change', () => {
    const c = canvas(t1, t2)
    const r = move(applyDrop(c, A, dropTarget(c, { x: 400, y: 0 }, 1)))
    expect(r.seat).toEqual({ itemId: 't2', seatIndex: 0 })
    const none = move(applyDrop(c, A, { kind: 'none' }))
    expect(none.canvas).toBe(c)
  })
})
