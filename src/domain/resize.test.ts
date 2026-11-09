import { describe, expect, it } from 'vitest'
import { MIN_TABLE_CM, type Fixture, type Item, type Shape, type Table } from './canvas-schema'
import { distance, localToWorld, type Point } from './geometry'
import {
  handlePoint,
  HANDLES,
  MAX_TABLE_CM,
  MIN_ITEM_CM,
  resizeByHandle,
  resizeFromCenterByDrag,
  rotateByHandle,
  rotateHandlePoint,
  snapAngle,
  type Handle,
} from './resize'
import { emptySeats, fitSeatsPlan, isBackArc, seatLocalLayout, setSeatCount, sideSeatCounts } from './seats'

const G = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function table(overrides: Partial<Table> = {}): Table {
  const seatCount = overrides.seatCount ?? 8
  return {
    id: 't',
    kind: 'table',
    shape: 'rect',
    x: 0,
    y: 0,
    rotation: 0,
    locked: false,
    width: 243.84,
    height: 76.2,
    number: 1,
    name: 'Table 1',
    seatCount,
    seatSides: 'noEnds',
    seats: emptySeats(seatCount),
    ...overrides,
  }
}

function fixture(overrides: Partial<Fixture> = {}): Fixture {
  return { id: 'f', kind: 'fixture', type: 'stage', x: 0, y: 0, rotation: 0, locked: false, width: 200, height: 100, label: 'Stage', ...overrides }
}

const OPPOSITE: Record<Handle, Handle> = { n: 's', ne: 'sw', e: 'w', se: 'nw', s: 'n', sw: 'ne', w: 'e', nw: 'se' }

function close(p: Point, q: Point, digits = 6) {
  expect(p.x).toBeCloseTo(q.x, digits)
  expect(p.y).toBeCloseTo(q.y, digits)
}

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

describe('resizeByHandle', () => {
  it('stretches from the east handle, keeping the west edge still', () => {
    const f = fixture({ x: 100, y: 100 })
    const r = resizeByHandle(f, 'e', { x: 300, y: 130 })
    expect(r).toMatchObject({ width: 300, height: 100, x: 150, y: 100 })
  })

  it('keeps the opposite edge or corner still at any rotation', () => {
    const random = rng(20)
    for (let i = 0; i < 300; i++) {
      const f = fixture({ x: random() * 400, y: random() * 400, rotation: random() * 360, width: 100 + random() * 200, height: 100 + random() * 200 })
      const handle = HANDLES[i % 8]
      const keepRatio = random() < 0.5
      // Push the handle outward so no minimum clamps it.
      const out = localToWorld(f, { x: (f.width / 2 + 50) * (handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0), y: (f.height / 2 + 50) * (handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0) })
      const r = resizeByHandle(f, handle, out, { keepRatio })
      close(handlePoint(r, OPPOSITE[handle]), handlePoint(f, OPPOSITE[handle]))
      expect(r.rotation).toBe(f.rotation)
      if (keepRatio) expect(r.width / r.height).toBeCloseTo(f.width / f.height, 9)
    }
  })

  it('resizes about the center with fromCenter', () => {
    const f = fixture({ x: 50, y: 60, rotation: 30 })
    const r = resizeByHandle(f, 'se', localToWorld(f, { x: 150, y: 80 }), { fromCenter: true })
    expect(r.x).toBeCloseTo(50, 9)
    expect(r.y).toBeCloseTo(60, 9)
    expect(r.width).toBeCloseTo(300, 6)
    expect(r.height).toBeCloseTo(160, 6)
  })

  it('keeps proportions from a corner using the larger stretch', () => {
    const f = fixture()
    const r = resizeByHandle(f, 'se', { x: 300, y: 60 }, { keepRatio: true })
    // From the north-west corner: 400 wide (x2) beats 110 high (x1.1).
    expect(r.width).toBeCloseTo(400, 9)
    expect(r.height).toBeCloseTo(200, 9)
    close(handlePoint(r, 'nw'), handlePoint(f, 'nw'))
  })

  it('keeps an edge-handle resize with proportions centered across', () => {
    const f = fixture()
    const r = resizeByHandle(f, 'e', { x: 300, y: 0 }, { keepRatio: true })
    expect(r).toMatchObject({ width: 400, height: 200 })
    expect(r.y).toBeCloseTo(0, 9)
    expect(r.x).toBeCloseTo(100, 9)
  })

  it('keeps round tables round from every handle', () => {
    const t = table({ shape: 'round', width: 152.4, height: 152.4, seatSides: 'all' })
    for (const h of HANDLES) {
      const r = resizeByHandle(t, h, { x: 260, y: -170 })
      expect(r.width, h).toBeCloseTo(r.height, 9)
      expect(r.width).toBeGreaterThanOrEqual(MIN_TABLE_CM)
    }
  })

  it('stops tables at 24 in and other items at 10 cm, without flipping', () => {
    const t = table({ x: 0 })
    const r = resizeByHandle(t, 'e', { x: -500, y: 0 })
    expect(r.width).toBeCloseTo(MIN_TABLE_CM, 9)
    // The west edge stays at -121.92 and the table sits to its right.
    expect(r.x - r.width / 2).toBeCloseTo(-121.92, 9)
    const n = resizeByHandle(t, 'n', { x: 0, y: 500 })
    expect(n.height).toBeCloseTo(MIN_TABLE_CM, 9)
    const f = resizeByHandle(fixture(), 'nw', { x: 500, y: 500 })
    expect(f).toMatchObject({ width: MIN_ITEM_CM, height: MIN_ITEM_CM })
    const kept = resizeByHandle(fixture(), 'se', { x: -500, y: -500 }, { keepRatio: true })
    expect(kept.width / kept.height).toBeCloseTo(2, 9)
    expect(kept.height).toBeCloseTo(MIN_ITEM_CM, 9)
    // A larger minimum may be asked for, but a table never goes under 24 in.
    expect(resizeByHandle(fixture(), 'e', { x: -500, y: 0 }, { minCm: 40 }).width).toBe(40)
    expect(resizeByHandle(t, 'e', { x: -500, y: 0 }, { minCm: 5 }).width).toBeCloseTo(MIN_TABLE_CM, 9)
  })

  it('scales shape points with the shape', () => {
    const line: Shape = {
      id: 'l',
      kind: 'shape',
      type: 'line',
      x: 0,
      y: 0,
      rotation: 0,
      locked: false,
      width: 200,
      height: 10,
      points: [
        { x: -100, y: 0 },
        { x: 100, y: 5 },
      ],
      style: { stroke: '#000', fill: 'none', strokeWidth: 3 },
    }
    const r = resizeByHandle(line, 'e', { x: 300, y: 0 })
    expect(r.width).toBe(400)
    expect(r.points).toEqual([
      { x: -200, y: 0 },
      { x: 200, y: 5 },
    ])
  })

  it('leaves seat counts alone and keeps guests near their places', () => {
    const square: Table = { ...table({ shape: 'square', width: 121.92, height: 121.92, seatSides: 'all' }) }
    square.seats = square.seats.map((s, i) => (i === 2 ? { ...s, guestId: G(1) } : s))
    const wide = resizeByHandle(square, 'e', { x: 400, y: 0 })
    expect(wide.seatCount).toBe(8)
    expect(sideSeatCounts(wide)).not.toEqual(sideSeatCounts(square))
    const at = wide.seats.findIndex((s) => s.guestId === G(1))
    expect(seatLocalLayout(wide)[at].side).toBe('right')
  })

  it('leaves chair rows alone', () => {
    const row: Item = {
      id: 'r',
      kind: 'chairRow',
      x: 0,
      y: 0,
      rotation: 0,
      locked: false,
      chairCount: 4,
      spacing: 50.8,
      blockId: null,
      blockLabel: null,
      rowNumber: 1,
      rowLabel: 'Row 1',
      reservedFor: null,
      seats: emptySeats(4),
    }
    expect(resizeByHandle(row, 'e', { x: 500, y: 0 })).toBe(row)
    expect(resizeFromCenterByDrag(row, { x: 10, y: 0 }, { x: 50, y: 0 })).toBe(row)
  })

  it('stretches the rect preset to 24 ft and Fit seats gives 12 a side (acceptance 10)', () => {
    const t = table()
    const long = resizeByHandle(t, 'e', { x: -121.92 + 731.52, y: 10 })
    expect(long.width).toBeCloseTo(731.52, 6)
    expect(long.seatCount).toBe(8)
    expect(fitSeatsPlan(long).table.seatCount).toBe(24)
    expect(fitSeatsPlan({ ...long, seatSides: 'oneSide' }).table.seatCount).toBe(12)
  })

  it('shrinks a round table by a corner to a 36 in sweetheart table (acceptance 10)', () => {
    const t = table({ shape: 'round', width: 152.4, height: 152.4, seatSides: 'all' })
    // The south-east corner of the box; the north-west one stays.
    const small = resizeByHandle(t, 'se', { x: -76.2 + 91.44, y: -76.2 + 91.44 })
    expect(small.width).toBeCloseTo(91.44, 6)
    expect(small.height).toBeCloseTo(91.44, 6)
    const sweet = setSeatCount(small, 2).table
    expect(isBackArc(sweet)).toBe(true)
  })
})

describe('resizeByHandle on the grid (snapping on)', () => {
  const FT = 30.48

  it('reaches 36, 48 and 72 in from a corner of a 60 in round, the far corner kept', () => {
    const t = table({ shape: 'round', width: 152.4, height: 152.4, seatSides: 'all', x: 17, y: -5 })
    const nw = handlePoint(t, 'nw')
    for (const inches of [36, 48, 72]) {
      const want = inches * 2.54
      // A pointer near (not on) the corner for that size.
      const r = resizeByHandle(t, 'se', { x: nw.x + want + 7, y: nw.y + want - 9 }, { gridStep: FT })
      expect(r.width, `${inches} in`).toBeCloseTo(want, 6)
      expect(r.height).toBeCloseTo(want, 6)
      close(handlePoint(r, 'nw'), nw)
    }
  })

  it('rounds the side a handle moves to whole steps in the item frame, at any rotation', () => {
    const f = fixture({ x: 40, y: 70, rotation: 30, width: 200, height: 100 })
    const r = resizeByHandle(f, 'e', localToWorld(f, { x: 100 + 47, y: 12 }), { gridStep: FT })
    expect(r.width).toBeCloseTo(8 * FT, 6)
    expect(r.height).toBe(100)
    close(handlePoint(r, 'w'), handlePoint(f, 'w'))
    const c = resizeByHandle(f, 'sw', localToWorld(f, { x: -100 - 20, y: 50 + 20 }), { gridStep: FT })
    expect([c.width / FT, c.height / FT].map((v) => Math.abs(v - Math.round(v)) < 1e-6)).toEqual([true, true])
    close(handlePoint(c, 'ne'), handlePoint(f, 'ne'))
  })

  it('keeps proportions by rounding the dragged side, and never goes under the minimum', () => {
    const t = table()
    const r = resizeByHandle(t, 'e', { x: -121.92 + 9.6 * FT, y: 0 }, { gridStep: FT, keepRatio: true })
    expect(r.width).toBeCloseTo(10 * FT, 6)
    expect(r.width / r.height).toBeCloseTo(243.84 / 76.2, 9)
    const tiny = resizeByHandle(t, 'e', { x: -121.92 + 10, y: 0 }, { gridStep: 50 })
    expect(tiny.width).toBeCloseTo(MIN_TABLE_CM, 9)
  })

  it('uses the raw size with no grid step (Alt)', () => {
    const t = table({ shape: 'round', width: 152.4, height: 152.4, seatSides: 'all' })
    const r = resizeByHandle(t, 'se', { x: -76.2 + 100, y: -76.2 + 100 })
    expect(r.width).toBeCloseTo(100, 9)
  })

  it('stops tables at the maximum length', () => {
    const t = table()
    expect(resizeByHandle(t, 'e', { x: 900_000, y: 0 }).width).toBeCloseTo(MAX_TABLE_CM, 9)
    expect(resizeByHandle(fixture(), 'e', { x: 9_000, y: 0 }).width).toBeCloseTo(9_100, 9)
  })
})

describe('resizeFromCenterByDrag (Shift+drag on a body)', () => {
  it('moves a round table edge with the pointer, about the center', () => {
    const t = table({ shape: 'round', width: 152.4, height: 152.4, seatSides: 'all', x: 100, y: 100 })
    // Pressed 50 cm out, now 75 cm out: the radius grows by the 25 cm moved outward.
    const r = resizeFromCenterByDrag(t, { x: 150, y: 100 }, { x: 100, y: 175 })
    expect(r.x).toBe(100)
    expect(r.y).toBe(100)
    expect(r.width).toBeCloseTo(152.4 + 50, 6)
    expect(r.height).toBeCloseTo(r.width, 9)
    // Pressed outside the table, the scale is the distance now over the distance then.
    expect(resizeFromCenterByDrag(t, { x: 300, y: 100 }, { x: 500, y: 100 }).width).toBeCloseTo(152.4 * 2, 6)
  })

  it('does not jump when pressed near the center (C8)', () => {
    const t = table({ shape: 'round', width: 152.4, height: 152.4, seatSides: 'all' })
    // 1 cm out, then 2 cm out: the old rule doubled the table here.
    expect(resizeFromCenterByDrag(t, { x: 1, y: 0 }, { x: 2, y: 0 }).width).toBeCloseTo(152.4 + 2, 6)
    // A press on the very center grows by the outward move too.
    expect(resizeFromCenterByDrag(t, { x: 0, y: 0 }, { x: 10, y: 0 }).width).toBeCloseTo(152.4 + 20, 6)
    // A rect measures against half its diagonal, so its corner follows the pointer.
    const r = table()
    const half = Math.hypot(243.84, 76.2) / 2
    const grown = resizeFromCenterByDrag(r, { x: 5, y: 0 }, { x: 5 + half, y: 0 })
    expect(grown.width).toBeCloseTo(243.84 * 2, 6)
    expect(grown.height).toBeCloseTo(76.2 * 2, 6)
  })

  it('keeps proportions and stops at the minimum and the maximum', () => {
    const t = table()
    const r = resizeFromCenterByDrag(t, { x: 100, y: 0 }, { x: 1, y: 0 })
    expect(r.height).toBeCloseTo(MIN_TABLE_CM, 9)
    expect(r.width / r.height).toBeCloseTo(243.84 / 76.2, 9)
    expect(resizeFromCenterByDrag(t, { x: 100, y: 0 }, { x: 100, y: 0 })).toBe(t)
    const huge = resizeFromCenterByDrag(t, { x: 100, y: 0 }, { x: 900_000, y: 0 })
    expect(huge.width).toBeCloseTo(MAX_TABLE_CM, 6)
    expect(huge.width / huge.height).toBeCloseTo(243.84 / 76.2, 9)
    const round = table({ shape: 'round', width: 152.4, height: 152.4, seatSides: 'all' })
    expect(resizeFromCenterByDrag(round, { x: 100, y: 0 }, { x: 900_000, y: 0 })).toMatchObject({ width: MAX_TABLE_CM, height: MAX_TABLE_CM })
  })
})

describe('rotation', () => {
  it('turns so the top faces the pointer, in 15 degree steps', () => {
    const f = fixture({ x: 10, y: 10 })
    expect(rotateByHandle(f, { x: 10, y: -100 }).rotation).toBe(0)
    expect(rotateByHandle(f, { x: 200, y: 10 }).rotation).toBe(90)
    expect(rotateByHandle(f, { x: 10, y: 200 }).rotation).toBe(180)
    expect(rotateByHandle(f, { x: -200, y: 10 }).rotation).toBe(270)
    // 50 degrees clockwise from straight up snaps to 45.
    const a = (50 * Math.PI) / 180
    const p = { x: 10 + 100 * Math.sin(a), y: 10 - 100 * Math.cos(a) }
    expect(rotateByHandle(f, p).rotation).toBe(45)
    expect(rotateByHandle(f, p, { snapDegrees: null }).rotation).toBeCloseTo(50, 9)
    expect(rotateByHandle(f, { x: 10, y: 10 })).toBe(f)
  })

  it('snaps angles into [0, 360)', () => {
    expect(snapAngle(353)).toBe(0)
    expect(snapAngle(352)).toBe(345)
    expect(snapAngle(-7)).toBe(0)
    expect(snapAngle(-8)).toBe(345)
    expect(snapAngle(-23)).toBe(330)
    expect(snapAngle(97, 0)).toBe(97)
  })

  it('places the rotate handle above the item, the same screen distance at any zoom', () => {
    const f = fixture({ rotation: 90 })
    const p1 = rotateHandlePoint(f, 1)
    close(p1, { x: 50 + 28, y: 0 })
    const p2 = rotateHandlePoint(f, 2)
    expect(distance(p2, f)).toBeCloseTo(50 + 14, 9)
    close(handlePoint(f, 'e'), { x: 0, y: 100 })
  })
})
