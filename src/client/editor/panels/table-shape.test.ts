import { describe, expect, it } from 'vitest'
import { emptyCanvas, type Table } from '@/domain/canvas-schema'
import { makeItem } from '@/domain/presets'
import { emptySeats, isBackArc, seatLocalLayout, seatRuns } from '@/domain/seats'
import { canTakeShape, changeTableShape, withTableShape } from './table-shape'

const GUEST_A = '11111111-1111-4111-8111-111111111111'
const GUEST_B = '22222222-2222-4222-8222-222222222222'

function table(preset: 'round' | 'square' | 'rect' | 'head', patch: Partial<Table> = {}): Table {
  return { ...(makeItem(preset, { x: 0, y: 0 }, 't1', emptyCanvas()) as Table), ...patch }
}

describe('withTableShape', () => {
  it('turns a rectangle round at the mean of its sides, keeping the seat count', () => {
    const t = withTableShape(table('rect'), 'round')
    expect(t.shape).toBe('round')
    expect(t.width).toBeCloseTo((243.84 + 76.2) / 2)
    expect(t.height).toBe(t.width)
    expect(t.seatCount).toBe(8)
    expect(t.seats).toHaveLength(8)
  })

  it('turns a round table into a rectangle twice as long as deep', () => {
    const t = withTableShape(table('round'), 'rect')
    expect(t.width).toBeCloseTo(152.4)
    expect(t.height).toBeCloseTo(76.2)
  })

  it('turns a square into a rectangle and a rectangle into a square', () => {
    const rect = withTableShape(table('square'), 'rect')
    expect(rect.width).toBeGreaterThan(rect.height)
    const square = withTableShape(table('rect'), 'square')
    expect(square.width).toBe(square.height)
  })

  it('never goes under 24 in', () => {
    const t = withTableShape(table('round', { width: 60.96, height: 60.96 }), 'rect')
    expect(t.height).toBeCloseTo(60.96)
  })

  it('keeps every seated guest', () => {
    const seated = table('rect')
    seated.seats = seated.seats.map((s, i) => ({ ...s, guestId: i === 0 ? GUEST_A : i === 7 ? GUEST_B : null }))
    const t = withTableShape(seated, 'round')
    const guests = t.seats.map((s) => s.guestId).filter((g) => g !== null)
    expect(guests.sort()).toEqual([GUEST_A, GUEST_B])
  })

  it('seats a table turned round all the way round, not on the back arc', () => {
    const head = table('head')
    expect(head.seatSides).toBe('oneSide')
    head.seats = head.seats.map((s, i) => ({ ...s, guestId: i === 0 ? GUEST_A : i === 11 ? GUEST_B : null }))
    const t = withTableShape(head, 'round')
    expect(t.seatSides).toBe('all')
    expect(t.seatCount).toBe(12)
    expect(isBackArc(t)).toBe(false)
    expect(seatRuns(t)).toEqual([{ seats: Array.from({ length: 12 }, (_, i) => i), wraps: true }])
    // Seats all round: some below the center, not only on the back arc.
    expect(seatLocalLayout(t).some((p) => p.y > 0)).toBe(true)
    // The guests moved to the nearest new seats; nobody was unseated.
    expect(t.seats.map((s) => s.guestId).filter((g) => g !== null).sort()).toEqual([GUEST_A, GUEST_B])
  })

  it('keeps a 2-seat table side by side on the back arc when it turns round', () => {
    const two = table('rect', { seatCount: 2, seatSides: 'oneSide', seats: emptySeats(2) })
    two.seats[1] = { index: 1, guestId: GUEST_A }
    const t = withTableShape(two, 'round')
    expect(t.seatSides).toBe('all')
    expect(isBackArc(t)).toBe(true)
    const places = seatLocalLayout(t)
    expect(places).toHaveLength(2)
    expect(places.every((p) => p.y < 0)).toBe(true)
    expect(t.seats.filter((s) => s.guestId === GUEST_A)).toHaveLength(1)
  })

  it('keeps the seat sides of a square or rectangle', () => {
    const noEnds = table('rect')
    expect(noEnds.seatSides).toBe('noEnds')
    expect(withTableShape(noEnds, 'square').seatSides).toBe('noEnds')
    expect(withTableShape(table('head'), 'square').seatSides).toBe('oneSide')
  })

  it('leaves locked tables, the same shape and too many seats alone', () => {
    const locked = table('rect', { locked: true })
    expect(withTableShape(locked, 'round')).toBe(locked)
    const same = table('rect')
    expect(withTableShape(same, 'rect')).toBe(same)
    const crowded = table('head', { seatCount: 40, seats: Array.from({ length: 40 }, (_, index) => ({ index, guestId: null })) })
    expect(canTakeShape(crowded, 'round')).toBe(false)
    expect(withTableShape(crowded, 'round')).toBe(crowded)
  })
})

describe('changeTableShape', () => {
  it('returns the same canvas when nothing changes', () => {
    const canvas = { ...emptyCanvas(), items: [table('round')] }
    expect(changeTableShape(canvas, 't1', 'round')).toBe(canvas)
    expect(changeTableShape(canvas, 'nope', 'rect')).toBe(canvas)
    expect(changeTableShape(canvas, 't1', 'square')).not.toBe(canvas)
  })
})
