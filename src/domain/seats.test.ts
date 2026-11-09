import { describe, expect, it } from 'vitest'
import { MAX_SEATS_RECT, MAX_SEATS_ROUND_OR_SQUARE, type Seat, type Table } from './canvas-schema'
import { localToWorld } from './geometry'
import {
  addSeat,
  addSeatSide,
  canAddSeat,
  edgePerSeatCm,
  emptySeats,
  firstFreeSeat,
  fitSeatCount,
  fitSeatsPlan,
  isBackArc,
  isTight,
  minEdgePerSeatCm,
  neighbors,
  remapSeats,
  removeSeatPlan,
  SEAT_CENTER_OUT_CM,
  seatedCount,
  seatIndexAt,
  seatLayout,
  seatLocalLayout,
  seatRuns,
  setSeatCount,
  sideCapacity,
  sideSeatCounts,
  tightReason,
} from './seats'

const G = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function table(overrides: Partial<Table> = {}): Table {
  const seatCount = overrides.seatCount ?? 8
  return {
    id: 't1',
    kind: 'table',
    shape: 'round',
    x: 0,
    y: 0,
    rotation: 0,
    locked: false,
    width: 152.4,
    height: 152.4,
    number: 1,
    name: 'Table 1',
    seatCount,
    seatSides: 'all',
    seats: emptySeats(seatCount),
    ...overrides,
  }
}

/** A table with guest G(i + 1) in each listed seat. */
function seated(t: Table, taken: number[]): Table {
  return { ...t, seats: t.seats.map((s, i) => (taken.includes(i) ? { ...s, guestId: G(i + 1) } : s)) }
}

const round60 = table()
const round72 = table({ width: 182.88, height: 182.88, seatCount: 10 })
const round48 = table({ width: 121.92, height: 121.92, seatCount: 6 })
const square48 = table({ shape: 'square', width: 121.92, height: 121.92 })
const rect8ft = table({ shape: 'rect', width: 243.84, height: 76.2, seatSides: 'noEnds' })
const head24ft = table({ shape: 'rect', width: 731.52, height: 76.2, seatCount: 12, seatSides: 'oneSide' })
const sweetheart = table({ width: 91.44, height: 91.44, seatCount: 2 })

function guestsOf(seats: Seat[]): string[] {
  return seats.filter((s) => s.guestId !== null).map((s) => s.guestId as string)
}

/** A small seeded random number generator, so property loops repeat exactly. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('the seat rule', () => {
  it('fits the usual counts (PLAN change 4)', () => {
    expect(fitSeatCount(head24ft)).toBe(12)
    expect(fitSeatCount(round60)).toBe(8)
    expect(fitSeatCount(round72)).toBe(10)
    expect(fitSeatCount(round48)).toBe(6)
    expect(fitSeatCount(rect8ft)).toBe(8)
    expect(fitSeatCount(square48)).toBe(8)
  })

  it('leaves every preset untight', () => {
    for (const t of [round60, round72, round48, square48, rect8ft, head24ft, sweetheart]) expect(isTight(t)).toBe(false)
  })

  it('uses 22 in per seat on round tables and 24 in on straight edges', () => {
    expect(minEdgePerSeatCm('round')).toBe(55.88)
    expect(minEdgePerSeatCm('square')).toBe(60.96)
    expect(minEdgePerSeatCm('rect')).toBe(60.96)
    expect(edgePerSeatCm(round60)).toBeCloseTo((Math.PI * 152.4) / 8, 9)
    expect(edgePerSeatCm(head24ft)).toBeCloseTo(60.96, 9)
    expect(edgePerSeatCm(table({ seatCount: 0, seats: [] }))).toBeNull()
  })

  it('counts a side half a centimeter short as fitting, and no more', () => {
    expect(sideCapacity(731.52)).toBe(12)
    expect(sideCapacity(731.1)).toBe(12)
    expect(sideCapacity(731.0)).toBe(11)
    expect(isTight({ ...head24ft, width: 731.1 })).toBe(false)
    expect(isTight({ ...head24ft, width: 731.0 })).toBe(true)
    expect(sideCapacity(0)).toBe(0)
  })

  it('flags 9 seats at a 60 in round and says why in feet and in meters', () => {
    const nine = table({ seatCount: 9 })
    expect(isTight(nine)).toBe(true)
    expect(tightReason(nine, 'ft')).toBe('9 seats need 16′ 6″ of edge at 22″ each; this table has 15′ 8″')
    expect(tightReason(nine, 'm')).toBe('9 seats need 5.03 m of edge at 0.56 m each; this table has 4.79 m')
    expect(tightReason(round60, 'ft')).toBeNull()
  })

  it('flags a crowded side even when the whole edge would be long enough', () => {
    // 170 by 100: the long sides hold 2 each and the ends 1 each, 6 in all.
    const t = table({ shape: 'rect', width: 170, height: 100, seatCount: 7 })
    expect(fitSeatCount(t)).toBe(6)
    expect(isTight({ ...t, seatCount: 6 })).toBe(false)
    expect(isTight(t)).toBe(true)
    expect(tightReason(t, 'ft')).toBe('3 seats need 6′ 0″ of edge at 24″ each on one side; that side has 5′ 7″')
  })

  it('is tight exactly when the count is over Fit seats, for any size and sides', () => {
    const random = rng(1)
    for (let i = 0; i < 400; i++) {
      const shape = (['round', 'square', 'rect'] as const)[i % 3]
      const width = 60.96 + random() * 700
      const height = shape === 'rect' ? 60.96 + random() * 300 : width
      const seatSides = (['all', 'noEnds', 'oneSide'] as const)[Math.floor(random() * 3)]
      const base = table({ shape, width, height, seatSides })
      const fit = fitSeatCount(base)
      for (let n = 1; n <= Math.min(fit + 2, shape === 'rect' ? MAX_SEATS_RECT : MAX_SEATS_ROUND_OR_SQUARE); n++) {
        expect(isTight({ ...base, seatCount: n }), `${shape} ${width}x${height} ${seatSides} n=${n} fit=${fit}`).toBe(n > fit)
      }
    }
  })

  it('fits a 340 by 120 all-sides table without crowding an end', () => {
    // Plain largest-remainder sharing gives the 120 cm ends 2 seats each here.
    const t = table({ shape: 'rect', width: 340, height: 120 })
    const fit = fitSeatCount(t)
    expect(fit).toBe(12)
    expect(sideSeatCounts({ ...t, seatCount: fit })).toEqual({ top: 5, right: 1, bottom: 5, left: 1 })
    expect(isTight({ ...t, seatCount: fit })).toBe(false)
  })

  it('caps Fit seats at the seat limit and never goes below 1', () => {
    expect(fitSeatCount(table({ width: 2000, height: 2000 }))).toBe(MAX_SEATS_ROUND_OR_SQUARE)
    expect(fitSeatCount(table({ shape: 'rect', width: 9000, height: 61, seatSides: 'oneSide' }))).toBe(MAX_SEATS_RECT)
    expect(fitSeatCount(table({ shape: 'rect', width: 30, height: 30, seatSides: 'oneSide' }))).toBe(1)
  })
})

describe('round tables', () => {
  it('spaces seats evenly, 8 cm out, seat 0 at the top, clockwise, facing the center', () => {
    const seats = seatLocalLayout(round60)
    const r = 152.4 / 2 + SEAT_CENTER_OUT_CM
    expect(seats).toHaveLength(8)
    for (const s of seats) {
      expect(Math.hypot(s.x, s.y)).toBeCloseTo(r, 9)
      expect(s.side).toBe('round')
      expect(s.slot).toBe(s.index)
      // Facing the center: the facing direction points back at the origin.
      const a = (s.angle * Math.PI) / 180
      expect(s.x + Math.cos(a) * r).toBeCloseTo(0, 6)
      expect(s.y + Math.sin(a) * r).toBeCloseTo(0, 6)
    }
    expect(seats[0].x).toBeCloseTo(0, 9)
    expect(seats[0].y).toBeCloseTo(-r, 9)
    expect(seats[0].angle).toBeCloseTo(90, 9)
    expect(seats[1].x).toBeGreaterThan(0)
  })

  it('gives 9 evenly spaced circles after + on an 8-seat round (acceptance 7)', () => {
    const nine = addSeat(round60)
    expect(nine.seatCount).toBe(9)
    expect(nine.seats).toHaveLength(9)
    const seats = seatLocalLayout(nine)
    const gaps = seats.map((s, i) => {
      const n = seats[(i + 1) % seats.length]
      return Math.hypot(n.x - s.x, n.y - s.y)
    })
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0], 9)
  })

  it('seats a sweetheart table side by side on the back arc, facing the room (DECISIONS 6)', () => {
    expect(isBackArc(sweetheart)).toBe(true)
    const [a, b] = seatLocalLayout(sweetheart)
    expect(a.y).toBeLessThan(0)
    expect(a.y).toBeCloseTo(b.y, 9)
    expect(a.x).toBeCloseTo(-b.x, 9)
    expect(a.x).toBeLessThan(0)
    // 22 in of edge between them, measured along the table's edge.
    const r = 91.44 / 2
    const arc = r * (Math.atan2(b.x, -b.y) - Math.atan2(a.x, -a.y))
    expect(arc).toBeCloseTo(55.88, 6)
    // Both face the table, and so the room in front of it.
    expect(a.angle).toBeGreaterThan(0)
    expect(a.angle).toBeLessThan(180)
    expect(b.angle).toBeGreaterThan(0)
    expect(b.angle).toBeLessThan(180)
  })

  it('puts any one-sided round table on the back arc, left to right', () => {
    const t = table({ seatCount: 4, seatSides: 'oneSide' })
    const seats = seatLocalLayout(t)
    for (let i = 1; i < seats.length; i++) expect(seats[i].x).toBeGreaterThan(seats[i - 1].x)
    for (const s of seats) expect(s.y).toBeLessThan(0)
    // A round table seated all round with 2 seats is a back arc too.
    expect(isBackArc(table({ seatCount: 2 }))).toBe(true)
    expect(isBackArc(table({ seatCount: 3 }))).toBe(false)
  })

  it('never laps a back arc over itself', () => {
    const t = table({ width: 60.96, height: 60.96, seatCount: 6, seatSides: 'oneSide' })
    const seats = seatLocalLayout(t)
    const angles = seats.map((s) => Math.atan2(s.x, -s.y))
    expect(angles[angles.length - 1] - angles[0]).toBeLessThan(2 * Math.PI)
  })
})

describe('square and rect tables', () => {
  it('seats a 24 ft head table along the back edge, 24 in apart, facing the room', () => {
    const seats = seatLocalLayout(head24ft)
    expect(seats).toHaveLength(12)
    for (const s of seats) {
      expect(s.side).toBe('top')
      expect(s.y).toBeCloseTo(-76.2 / 2 - SEAT_CENTER_OUT_CM, 9)
      expect(s.angle).toBe(90)
    }
    expect(seats.map((s) => s.slot)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    for (let i = 1; i < 12; i++) expect(seats[i].x - seats[i - 1].x).toBeCloseTo(60.96, 9)
    expect(seats[0].x).toBeCloseTo(-731.52 / 2 + 30.48, 9)
  })

  it('seats the rect preset 4 and 4 on the long sides, numbered clockwise', () => {
    const seats = seatLocalLayout(rect8ft)
    expect(seats.map((s) => s.side)).toEqual(['top', 'top', 'top', 'top', 'bottom', 'bottom', 'bottom', 'bottom'])
    expect(seats[0].x).toBeLessThan(seats[3].x)
    expect(seats[4].x).toBeGreaterThan(seats[7].x)
    expect(seats[4].angle).toBe(270)
  })

  it('seats the square preset 2 per side', () => {
    expect(sideSeatCounts(square48)).toEqual({ top: 2, right: 2, bottom: 2, left: 2 })
    const seats = seatLocalLayout(square48)
    expect(seats.map((s) => s.side)).toEqual(['top', 'top', 'right', 'right', 'bottom', 'bottom', 'left', 'left'])
    expect(seats.map((s) => s.angle)).toEqual([90, 90, 180, 180, 270, 270, 0, 0])
    // Right side runs top to bottom, left side bottom to top.
    expect(seats[2].y).toBeLessThan(seats[3].y)
    expect(seats[6].y).toBeGreaterThan(seats[7].y)
  })

  it('takes the long sides of a tall no-ends table, and top and bottom on a square', () => {
    const tall = table({ shape: 'rect', width: 76.2, height: 243.84, seatSides: 'noEnds' })
    expect(sideSeatCounts(tall)).toEqual({ top: 0, right: 4, bottom: 0, left: 4 })
    const sq = table({ shape: 'square', width: 121.92, height: 121.92, seatCount: 4, seatSides: 'noEnds' })
    expect(sideSeatCounts(sq)).toEqual({ top: 2, right: 0, bottom: 2, left: 0 })
  })

  it('shares seats by length on a table seated all round', () => {
    const rect = table({ shape: 'rect', width: 243.84, height: 76.2, seatSides: 'all' })
    expect(sideSeatCounts(rect)).toEqual({ top: 3, right: 1, bottom: 3, left: 1 })
    // 2 seats on a square face each other.
    expect(sideSeatCounts({ ...square48, seatCount: 2 })).toEqual({ top: 1, right: 0, bottom: 1, left: 0 })
  })

  it('adds and removes one seat at a time on one side, for any size', () => {
    const random = rng(2)
    for (let i = 0; i < 200; i++) {
      const t = table({
        shape: 'rect',
        width: 60.96 + random() * 600,
        height: 60.96 + random() * 600,
        seatSides: (['all', 'noEnds', 'oneSide'] as const)[i % 3],
      })
      let prev = sideSeatCounts({ ...t, seatCount: 0 })
      for (let n = 1; n <= 30; n++) {
        const next = sideSeatCounts({ ...t, seatCount: n })
        const diffs = (['top', 'right', 'bottom', 'left'] as const).map((s) => next[s] - prev[s])
        expect(diffs.filter((d) => d === 1)).toHaveLength(1)
        expect(diffs.filter((d) => d !== 0 && d !== 1)).toHaveLength(0)
        prev = next
      }
    }
  })

  it('places world seats by the table position and rotation', () => {
    const t = { ...head24ft, x: 500, y: -200, rotation: 90 }
    const local = seatLocalLayout(t)
    const world = seatLayout(t)
    world.forEach((s, i) => {
      const p = localToWorld(t, local[i])
      expect(s.x).toBeCloseTo(p.x, 9)
      expect(s.y).toBeCloseTo(p.y, 9)
      expect(s.angle).toBe(180)
    })
    // Turned a quarter clockwise, the back edge is on the right, so its seats sit there, facing left.
    for (const s of world) expect(s.x).toBeGreaterThan(500)
  })
})

describe('neighbors (PLAN change 15)', () => {
  it('wraps around a round table', () => {
    const n = neighbors(round60)
    expect(n[0]).toEqual([1, 7])
    expect(n[4]).toEqual([3, 5])
  })

  it('wraps around a table seated on all sides, across corners', () => {
    const n = neighbors(square48)
    expect(n[1]).toEqual([0, 2])
    expect(n[7]).toEqual([0, 6])
    expect(seatRuns(square48)).toEqual([{ seats: [0, 1, 2, 3, 4, 5, 6, 7], wraps: true }])
  })

  it('keeps each long side of a no-ends table its own run', () => {
    expect(seatRuns(rect8ft)).toEqual([
      { seats: [0, 1, 2, 3], wraps: false },
      { seats: [4, 5, 6, 7], wraps: false },
    ])
    const n = neighbors(rect8ft)
    expect(n[3]).toEqual([2])
    expect(n[4]).toEqual([5])
    expect(n[0]).toEqual([1])
    expect(n[7]).toEqual([6])
  })

  it('makes a one-sided table and a back arc one run without a wrap', () => {
    const n = neighbors(head24ft)
    expect(n[0]).toEqual([1])
    expect(n[11]).toEqual([10])
    expect(neighbors(sweetheart)).toEqual([[1], [0]])
    const arc = neighbors(table({ seatCount: 4, seatSides: 'oneSide' }))
    expect(arc[0]).toEqual([1])
    expect(arc[3]).toEqual([2])
  })

  it('gives nothing to a lone seat or an empty table', () => {
    expect(neighbors(table({ seatCount: 1, seats: emptySeats(1) }))).toEqual([[]])
    expect(neighbors(table({ seatCount: 0, seats: [] }))).toEqual([])
    expect(seatRuns(table({ seatCount: 0, seats: [] }))).toEqual([])
  })
})

describe('moving guests when seats change', () => {
  it('leaves every guest in place when only the size changes', () => {
    const t = seated(rect8ft, [0, 2, 5, 7])
    const plan = remapSeats(t, { ...t, width: 731.52 })
    expect(plan.unseated).toEqual([])
    expect(plan.canvasSeats).toEqual(t.seats)
  })

  it('keeps guests in order around a round table when a seat is added', () => {
    const t = seated(round60, [0, 1, 2, 3, 4, 5, 6, 7])
    const nine = addSeat(t)
    expect(guestsOf(nine.seats).sort()).toEqual(guestsOf(t.seats).sort())
    // Reading round from guest 1, the order is unchanged.
    const order = nine.seats.map((s) => s.guestId).filter((g): g is string => g !== null)
    const start = order.indexOf(G(1))
    const rotated = [...order.slice(start), ...order.slice(0, start)]
    expect(rotated).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map(G))
    // Nobody moves more than half a seat's spacing.
    const before = seatLocalLayout(t)
    const after = seatLocalLayout(nine)
    nine.seats.forEach((s, j) => {
      if (s.guestId === null) return
      const i = t.seats.findIndex((o) => o.guestId === s.guestId)
      const a = Math.atan2(before[i].x, -before[i].y)
      const b = Math.atan2(after[j].x, -after[j].y)
      const d = Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))
      expect(d).toBeLessThanOrEqual(Math.PI / 8 + 1e-9)
    })
  })

  it('removes an empty seat first, so nobody is unseated', () => {
    const t = seated(round60, [0, 3, 5])
    const plan = removeSeatPlan(t, 7)
    expect(plan.unseated).toEqual([])
    expect(plan.canvasSeats).toHaveLength(7)
    expect(guestsOf(plan.canvasSeats).sort()).toEqual([G(1), G(4), G(6)].sort())
    expect(plan.table.seatCount).toBe(7)
    expect(plan.table.seats).toBe(plan.canvasSeats)
  })

  it('unseats the guests in the highest seat numbers when every seat is taken', () => {
    const t = seated(round60, [0, 1, 2, 3, 4, 5, 6, 7])
    const plan = removeSeatPlan(t, 6)
    expect(plan.unseated).toEqual([G(8), G(7)])
    expect(guestsOf(plan.canvasSeats).sort()).toEqual([1, 2, 3, 4, 5, 6].map(G).sort())
  })

  it('names 2 guests before dropping 12 seats with 10 seated to 8 (acceptance 12)', () => {
    const t = seated(table({ seatCount: 12, width: 213.36, height: 213.36 }), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    const plan = removeSeatPlan(t, 8)
    expect(plan.unseated).toEqual([G(10), G(9)])
    expect(guestsOf(plan.canvasSeats)).toHaveLength(8)
  })

  it('moves guests to the back edge when a table switches to one side', () => {
    const t = seated(rect8ft, [0, 1, 4, 6])
    const one = { ...t, seatSides: 'oneSide' as const }
    const plan = remapSeats(t, one)
    expect(plan.unseated).toEqual([])
    expect(guestsOf(plan.canvasSeats).sort()).toEqual([G(1), G(2), G(5), G(7)].sort())
    // The guests already on the back edge stay within one new seat's spacing of where they were.
    const before = seatLocalLayout(t)
    const after = seatLocalLayout(one)
    for (const [old, guest] of [
      [0, G(1)],
      [1, G(2)],
    ] as const) {
      const now = plan.canvasSeats.findIndex((s) => s.guestId === guest)
      expect(Math.abs(after[now].x - before[old].x)).toBeLessThanOrEqual(243.84 / 16 + 1e-9)
    }
  })

  it('moves guests to the nearest seat when a square is stretched and its seats re-share', () => {
    // 2 per side on the square, guests on the right side (seats 2 and 3).
    const t = seated(square48, [2, 3])
    const wide = { ...t, shape: 'rect' as const, width: 400 }
    expect(sideSeatCounts(wide)).toEqual({ top: 3, right: 1, bottom: 3, left: 1 })
    const plan = remapSeats(t, wide)
    const places = seatLocalLayout(wide)
    const at = (guest: string) => places[plan.canvasSeats.findIndex((s) => s.guestId === guest)]
    // One keeps the end; the other goes round the nearest corner, and they stay in order.
    const sides = [at(G(3)), at(G(4))].map((p) => `${p.side}:${p.slot}`)
    expect([
      ['right:0', 'bottom:0'],
      ['top:2', 'right:0'],
    ]).toContainEqual(sides)
  })

  it('carries a pinned mark with its guest', () => {
    const t = { ...round60, seats: round60.seats.map((s, i) => (i === 7 ? { index: 7, guestId: G(1), pinned: true } : s)) }
    const plan = removeSeatPlan(t, 6)
    const seat = plan.canvasSeats.find((s) => s.guestId === G(1))
    expect(seat?.pinned).toBe(true)
    expect(plan.canvasSeats.filter((s) => s.guestId === null).every((s) => s.pinned === undefined)).toBe(true)
  })

  it('takes the empty seat out of a round table on −, so everyone moves less than a seat and keeps their neighbors', () => {
    const angleOf = (p: { x: number; y: number }) => Math.atan2(p.x, -p.y)
    const turn = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))
    /** The guests in seat order, read round from `first`. */
    const fromFirst = (order: string[], first: string) => {
      const i = order.indexOf(first)
      return [...order.slice(i), ...order.slice(0, i)]
    }
    for (let empty = 0; empty < 8; empty++) {
      const t = seated(round60, [0, 1, 2, 3, 4, 5, 6, 7].filter((i) => i !== empty))
      const plan = removeSeatPlan(t)
      expect(plan.unseated).toEqual([])
      expect(plan.table.seatCount).toBe(7)
      // Every seat is taken now, by the same guests in the same order round the table.
      expect(guestsOf(plan.canvasSeats)).toHaveLength(7)
      const first = guestsOf(t.seats)[0]
      expect(fromFirst(guestsOf(plan.canvasSeats), first)).toEqual(fromFirst(guestsOf(t.seats), first))
      const before = seatLocalLayout(t)
      const after = seatLocalLayout(plan.table)
      const step = (2 * Math.PI) / 7
      plan.canvasSeats.forEach((s, j) => {
        if (s.guestId === null) return
        const i = t.seats.findIndex((o) => o.guestId === s.guestId)
        expect(turn(angleOf(before[i]), angleOf(after[j]))).toBeLessThan(step)
      })
      // Neighbors at the table are the guests either side, and they have not changed.
      const neighborIds = (table: Table, guest: string) => {
        const k = table.seats.findIndex((x) => x.guestId === guest)
        return neighbors(table)[k].map((n) => table.seats[n].guestId).filter((g): g is string => g !== null).sort()
      }
      for (const guest of guestsOf(t.seats)) {
        const others = guestsOf(t.seats)
        const k = others.indexOf(guest)
        const wasNext = [others[(k + 1) % others.length], others[(k + others.length - 1) % others.length]].sort()
        expect(neighborIds(plan.table, guest)).toEqual(wasNext)
      }
    }
  })

  it('takes the seat on − from the side holding the empty seat of a 4 + 4 rect, so nobody changes side', () => {
    const sideOf = (table: Table) => {
      const places = seatLocalLayout(table)
      const out = new Map<string, string>()
      table.seats.forEach((s, i) => {
        if (s.guestId !== null) out.set(s.guestId, places[i].side)
      })
      return out
    }
    for (let empty = 0; empty < 8; empty++) {
      const t = seated(rect8ft, [0, 1, 2, 3, 4, 5, 6, 7].filter((i) => i !== empty))
      const plan = removeSeatPlan(t)
      expect(plan.unseated).toEqual([])
      const onTop = empty < 4
      expect(sideSeatCounts(plan.table)).toMatchObject(onTop ? { top: 3, bottom: 4 } : { top: 4, bottom: 3 })
      expect(sideOf(plan.table)).toEqual(sideOf(t))
      // Along each side the guests keep their order.
      expect(guestsOf(plan.canvasSeats)).toEqual(guestsOf(t.seats))
    }
    // The side it chose is kept, so + gives the seat back to that side.
    const lost = removeSeatPlan(seated(rect8ft, [0, 2, 3, 4, 5, 6, 7])).table
    expect(lost.fewerSeatsSide).toBe('top')
    expect(sideSeatCounts(addSeat(lost))).toMatchObject({ top: 4, bottom: 4 })
  })

  it('moves a guest round the nearest end only when their side has no seat left for them', () => {
    // 7 seats: top 4 (all taken), bottom 3 with one empty. 6 seats share 3 and 3.
    const seven = { ...rect8ft, seatCount: 7, seats: emptySeats(7) }
    const t = seated(seven, [0, 1, 2, 3, 4, 6])
    const plan = removeSeatPlan(t)
    expect(plan.unseated).toEqual([])
    expect(sideSeatCounts(plan.table)).toMatchObject({ top: 3, bottom: 3 })
    // Seat order is kept round the table: the last top guest goes round the right end.
    expect(guestsOf(plan.canvasSeats)).toEqual([G(1), G(2), G(3), G(4), G(5), G(7)])
  })

  it('keeps seat order on a one-sided head table when the count changes', () => {
    const t = seated(head24ft, [0, 3, 4, 8, 11])
    const plan = setSeatCount(t, 10)
    expect(guestsOf(plan.table.seats)).toEqual(guestsOf(t.seats))
  })

  it('never puts two guests in one seat and keeps indexes in order, for any change', () => {
    const random = rng(3)
    const shapes = ['round', 'square', 'rect'] as const
    const sides = ['all', 'noEnds', 'oneSide'] as const
    for (let i = 0; i < 300; i++) {
      const shape = shapes[Math.floor(random() * 3)]
      const width = 60.96 + random() * 500
      const n = 1 + Math.floor(random() * 20)
      const t = table({ shape, width, height: shape === 'round' ? width : 60.96 + random() * 300, seatCount: n, seatSides: sides[Math.floor(random() * 3)] })
      const taken = Array.from({ length: n }, (_, k) => k).filter(() => random() < 0.6)
      const before = seated({ ...t, seats: emptySeats(n) }, taken)
      const newShape = shapes[Math.floor(random() * 3)]
      const newWidth = 60.96 + random() * 500
      const next = {
        ...t,
        shape: newShape,
        width: newWidth,
        height: newShape === 'round' ? newWidth : 60.96 + random() * 300,
        seatCount: Math.floor(random() * 22),
        seatSides: sides[Math.floor(random() * 3)],
      }
      const plan = remapSeats(before, next)
      expect(plan.canvasSeats).toHaveLength(next.seatCount)
      plan.canvasSeats.forEach((s, k) => expect(s.index).toBe(k))
      const kept = guestsOf(plan.canvasSeats)
      expect(new Set(kept).size).toBe(kept.length)
      expect([...kept, ...plan.unseated].sort()).toEqual(guestsOf(before.seats).sort())
      expect(plan.unseated).toHaveLength(Math.max(0, taken.length - next.seatCount))
    }
  })
})

describe('+ and − and Fit seats', () => {
  it('adds a seat on the side with the most spare edge', () => {
    expect(addSeatSide(round60)).toBe('round')
    expect(addSeatSide(rect8ft)).toBe('top')
    expect(addSeatSide({ ...rect8ft, seatCount: 9 })).toBe('bottom')
    // 3,1,3,1 on an all-sides rect: a fourth seat on the 8 ft side gets 61 cm; a second on the end only 38.
    const all = table({ shape: 'rect', width: 243.84, height: 76.2 })
    expect(addSeatSide(all)).toBe('top')
    expect(sideSeatCounts(addSeat(all))).toEqual({ top: 4, right: 1, bottom: 3, left: 1 })
  })

  it('stops at the seat limit', () => {
    const full = table({ seatCount: MAX_SEATS_ROUND_OR_SQUARE, width: 600, height: 600 })
    expect(canAddSeat(full)).toBe(false)
    expect(addSeat(full)).toBe(full)
    expect(addSeatSide(full)).toBeNull()
    expect(setSeatCount(full, 99).table.seatCount).toBe(MAX_SEATS_ROUND_OR_SQUARE)
    expect(setSeatCount(full, -3).table.seatCount).toBe(0)
  })

  it('stretches the rect preset to 24 ft and fits 12 per side, or 12 on one side (acceptance 10, Q3)', () => {
    const long = { ...rect8ft, width: 731.52 }
    const plan = fitSeatsPlan(long)
    expect(plan.table.seatCount).toBe(24)
    expect(sideSeatCounts(plan.table)).toEqual({ top: 12, right: 0, bottom: 12, left: 0 })
    const one = fitSeatsPlan({ ...long, seatSides: 'oneSide' })
    expect(one.table.seatCount).toBe(12)
    expect(isTight(one.table)).toBe(false)
  })

  it('makes a round shrunk to 36 in with 2 seats a sweetheart table (acceptance 10)', () => {
    const small = setSeatCount({ ...round60, width: 91.44, height: 91.44 }, 2).table
    expect(isBackArc(small)).toBe(true)
    expect(isTight(small)).toBe(false)
  })

  it('names who Fit seats would unseat before it does', () => {
    const t = seated(table({ seatCount: 10 }), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    const plan = fitSeatsPlan(t)
    expect(plan.table.seatCount).toBe(8)
    expect(plan.unseated).toEqual([G(10), G(9)])
  })
})

describe('finding seats', () => {
  it('finds the seat under a point, on a turned table', () => {
    const t = { ...rect8ft, x: 100, y: 50, rotation: 30 }
    for (const s of seatLayout(t)) {
      expect(seatIndexAt(t, { x: s.x + 5, y: s.y - 5 })).toBe(s.index)
    }
    expect(seatIndexAt(t, { x: 100, y: 50 })).toBeNull()
    const s0 = seatLayout(t)[0]
    expect(seatIndexAt(t, { x: s0.x + 25, y: s0.y })).toBeNull()
    expect(seatIndexAt(t, { x: s0.x + 25, y: s0.y }, 5)).toBe(0)
  })

  it('finds the first free seat and counts the taken ones', () => {
    const t = seated(round60, [0, 1, 3])
    expect(firstFreeSeat(t)).toBe(2)
    expect(seatedCount(t)).toBe(3)
    expect(firstFreeSeat(seated(round60, [0, 1, 2, 3, 4, 5, 6, 7]))).toBeNull()
  })
})
