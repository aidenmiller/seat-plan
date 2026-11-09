import { describe, expect, it } from 'vitest'
import type { Fixture, Item, Table } from './canvas-schema'
import { distance, itemBodyFootprint, itemFootprint, obbCorners, type Footprint, type Obb, type Point } from './geometry'
import { emptySeats } from './seats'
import { DEFAULT_MIN_GAP_CM, footprintGap, gapBetween, gapDetails, gapText, isNarrowGap, narrowGaps, nearestGapAmong, nearestTableGap } from './spacing'

function table(overrides: Partial<Table> = {}): Table {
  const seatCount = overrides.seatCount ?? 8
  return {
    id: 't',
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

const rect = (overrides: Partial<Table> = {}) => table({ shape: 'rect', width: 243.84, height: 76.2, seatSides: 'noEnds', ...overrides })
const bare = (overrides: Partial<Table> = {}) => rect({ seatCount: 0, seats: [], ...overrides })
/** A 60 in round's top: gaps run between table edges, chairs not counted. */
const R = 76.2

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

/** Points along a footprint's outline, for a brute-force check. */
function outline(f: Footprint, per = 120): Point[] {
  if (f.kind === 'circle') {
    return Array.from({ length: per * 4 }, (_, i) => {
      const a = (2 * Math.PI * i) / (per * 4)
      return { x: f.x + f.r * Math.cos(a), y: f.y + f.r * Math.sin(a) }
    })
  }
  const c = obbCorners(f)
  const out: Point[] = []
  for (let i = 0; i < 4; i++) {
    const a = c[i]
    const b = c[(i + 1) % 4]
    for (let k = 0; k < per; k++) out.push({ x: a.x + ((b.x - a.x) * k) / per, y: a.y + ((b.y - a.y) * k) / per })
  }
  return out
}

describe('gapBetween', () => {
  it('measures round tables edge to edge, chairs not counted', () => {
    expect(gapBetween(table(), table({ id: 'b', x: 400 }))).toBeCloseTo(400 - 2 * R, 9)
    const g = gapDetails(table(), table({ id: 'b', x: 0, y: 500 }))
    expect(g.from.y).toBeCloseTo(R, 9)
    expect(g.to.y).toBeCloseTo(500 - R, 9)
  })

  it('measures a round table to a rect at 0, 45 and 90 degrees', () => {
    const t = bare({ id: 'r', x: 500, y: 0, width: 200, height: 100 })
    // 0: the rect's left edge is at 400.
    expect(gapBetween(table(), t)).toBeCloseTo(400 - R, 9)
    // 90: its half width across x is now 50.
    expect(gapBetween(table(), { ...t, rotation: 90 })).toBeCloseTo(450 - R, 9)
    // 45: its nearest corner points at the circle.
    const corner = Math.min(...obbCorners(itemBodyFootprint({ ...t, rotation: 45 }) as Obb).map((p) => p.x))
    const g = gapBetween(table(), { ...t, rotation: 45 })
    // The corner is not quite on the line between centers, so the gap is a touch more.
    expect(g).toBeGreaterThan(corner - R - 1e-9)
    expect(g).toBeLessThan(corner - R + 10)
  })

  it('measures rects at 0, 45 and 90 degrees', () => {
    const a = bare({ width: 200, height: 100 })
    expect(gapBetween(a, bare({ id: 'b', x: 400, width: 200, height: 100 }))).toBeCloseTo(200, 9)
    expect(gapBetween(a, bare({ id: 'b', x: 400, width: 200, height: 100, rotation: 90 }))).toBeCloseTo(250, 9)
    // A unit square turned 45 degrees puts its corner half a diagonal from its center.
    const d = bare({ id: 'b', x: 400, width: 100, height: 100, rotation: 45 })
    expect(gapBetween(a, d)).toBeCloseTo(400 - 50 * Math.SQRT2 - 100, 9)
    // Diagonal apart: corner to corner.
    expect(gapBetween(a, bare({ id: 'b', x: 300, y: 200, width: 200, height: 100 }))).toBeCloseTo(Math.hypot(100, 100), 9)
  })

  it('agrees with a brute-force distance between outlines', () => {
    const random = rng(40)
    for (let i = 0; i < 40; i++) {
      const make = (id: string): Item =>
        random() < 0.3
          ? table({ id, x: random() * 800, y: random() * 800, width: 60.96 + random() * 150, height: 0, seatCount: 0, seats: [] })
          : bare({ id, x: random() * 800, y: random() * 800, width: 60.96 + random() * 300, height: 60.96 + random() * 100, rotation: random() * 360 })
      const a = make('a')
      const b = make('b')
      const fixRound = (it: Item) => (it.kind === 'table' && it.shape === 'round' ? { ...it, height: it.width } : it)
      const fa = itemFootprint(fixRound(a))
      const fb = itemFootprint(fixRound(b))
      const g = footprintGap(fa, fb)
      if (g.gapCm <= 0) continue
      const pa = outline(fa)
      const pb = outline(fb)
      let brute = Infinity
      for (const p of pa) for (const q of pb) brute = Math.min(brute, distance(p, q))
      expect(g.gapCm).toBeLessThanOrEqual(brute + 1e-6)
      expect(brute - g.gapCm).toBeLessThan(3)
      expect(distance(g.from, g.to)).toBeCloseTo(g.gapCm, 6)
    }
  })

  it('is the same both ways round', () => {
    const a = table()
    const b = rect({ id: 'b', x: 300, y: 120, rotation: 30 })
    expect(gapBetween(a, b)).toBeCloseTo(gapBetween(b, a), 9)
    const ab = gapDetails(a, b)
    const ba = gapDetails(b, a)
    expect(ab.from.x).toBeCloseTo(ba.to.x, 9)
    expect(ab.to.y).toBeCloseTo(ba.from.y, 9)
  })

  it('measures between table edges whatever the seats', () => {
    // End to end and side by side, chairs or not.
    expect(gapBetween(rect(), rect({ id: 'b', x: 300 }))).toBeCloseTo(300 - 243.84, 9)
    expect(gapBetween(rect(), rect({ id: 'b', y: 300 }))).toBeCloseTo(300 - 76.2, 9)
    expect(gapBetween(rect({ seatSides: 'all', seatCount: 10, seats: emptySeats(10) }), bare({ id: 'b', y: 300 }))).toBeCloseTo(300 - 76.2, 9)
  })

  it('reads two 60 in rounds 5 ft apart edge to edge as 5′ 0″, with no warning', () => {
    for (const [x, y, angle] of [
      [0, 0, 0],
      [12.3, 45.6, 0],
      [-731.52, 91.44, 30],
      [1000.1, -2000.7, 135],
    ]) {
      const a = table({ id: 'a', x, y })
      const r = (angle * Math.PI) / 180
      const b = table({ id: 'b', x: x + 304.8 * Math.cos(r), y: y + 304.8 * Math.sin(r) })
      const g = nearestTableGap({ items: [a, b] }, 'a')!
      expect(g.gapCm).toBeCloseTo(152.4, 6)
      expect(gapText(g.gapCm, 'ft')).toBe('5′ 0″')
      expect(isNarrowGap(g.gapCm, DEFAULT_MIN_GAP_CM)).toBe(false)
      expect(narrowGaps({ items: [a, b] }, DEFAULT_MIN_GAP_CM)).toEqual([])
      // A centimeter closer does warn.
      const nearer = table({ id: 'b', x: x + 303.8 * Math.cos(r), y: y + 303.8 * Math.sin(r) })
      expect(narrowGaps({ items: [a, nearer] }, DEFAULT_MIN_GAP_CM)).toHaveLength(1)
    }
  })

  it('gives 0 for touching and how far they overlap below that', () => {
    expect(gapBetween(bare({ width: 100, height: 100 }), bare({ id: 'b', x: 100, width: 100, height: 100 }))).toBeCloseTo(0, 9)
    expect(gapBetween(bare({ width: 100, height: 100 }), bare({ id: 'b', x: 80, width: 100, height: 100 }))).toBeCloseTo(-20, 9)
    expect(gapBetween(table(), table({ id: 'b', x: 10 }))).toBeLessThan(0)
    expect(gapBetween(table({ seatCount: 0, seats: [] }), bare({ id: 'b', width: 300, height: 300 }))).toBeLessThan(0)
  })
})

describe('nearestTableGap', () => {
  const dance: Fixture = { id: 'dance', kind: 'fixture', type: 'danceFloor', x: 300, y: 0, rotation: 0, locked: false, width: 100, height: 100, label: 'Dance floor' }

  it('finds the nearest table and ignores everything else', () => {
    const items: Item[] = [table({ id: 'a' }), dance, table({ id: 'b', x: 600 }), table({ id: 'c', x: 0, y: 450 })]
    const g = nearestTableGap({ items }, 'a')
    expect(g?.otherId).toBe('c')
    expect(g?.gapCm).toBeCloseTo(450 - 2 * R, 9)
    expect(distance(g!.from, g!.to)).toBeCloseTo(g!.gapCm, 9)
  })

  it('measures from a dragged fixture body, and agrees with nearestGapAmong', () => {
    const items: Item[] = [table({ id: 'a' }), dance, table({ id: 'b', x: 600 })]
    // The dance floor's left edge is at 250; table a's right edge at 76.2.
    expect(nearestTableGap({ items }, 'dance')?.gapCm).toBeCloseTo(250 - 76.2, 9)
    const tables = items.filter((i): i is Table => i.kind === 'table')
    expect(nearestGapAmong(items[0], tables)).toEqual(nearestTableGap({ items }, 'a'))
  })

  it('works for a dragged fixture too, and is null with no other table', () => {
    expect(nearestTableGap({ items: [table({ id: 'a' }), dance] }, 'dance')?.otherId).toBe('a')
    expect(nearestTableGap({ items: [table({ id: 'a' }), dance] }, 'a')).toBeNull()
    expect(nearestTableGap({ items: [table({ id: 'a' })] }, 'missing')).toBeNull()
  })
})

describe('narrowGaps', () => {
  it('lists table pairs under the minimum, narrowest first, overlapping flagged', () => {
    const items: Item[] = [
      table({ id: 'a' }),
      table({ id: 'b', x: 2 * R + 100 }),
      table({ id: 'c', x: 2000 }),
      table({ id: 'd', x: 2000, y: 2 * R - 10 }),
    ]
    const gaps = narrowGaps({ items }, DEFAULT_MIN_GAP_CM)
    expect(gaps.map((g) => [g.aId, g.bId, g.overlapping])).toEqual([
      ['c', 'd', true],
      ['a', 'b', false],
    ])
    expect(gaps[1].gapCm).toBeCloseTo(100, 9)
    expect(narrowGaps({ items }, 50).map((g) => g.aId)).toEqual(['c'])
  })
})

describe('gapText', () => {
  it('reads in the wedding unit, or says overlapping', () => {
    expect(gapText(152.4, 'ft')).toBe('5′ 0″')
    expect(gapText(152.4, 'm')).toBe('1.52 m')
    expect(gapText(0, 'ft')).toBe('Overlapping')
    expect(gapText(-3, 'm')).toBe('Overlapping')
  })
})
