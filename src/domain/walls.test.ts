import { describe, expect, it } from 'vitest'
import type { Canvas, Item, Table } from './canvas-schema'
import { emptySeats } from './seats'
import type { FixedItem } from './venue-schema'
import { buildWallIndex, crossedTableIds, tableWallHits, wallCrossings, wallPenetration } from './walls'

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

function wall(id: string, points: { x: number; y: number }[], thickness = 20): FixedItem {
  return { id, type: 'wall', points, thickness, unsure: false, unsureNote: '' }
}

/** A long straight wall through `through` at `deg` degrees, pushed `offset` cm along its normal. */
function lineWall(id: string, deg: number, offset: number, thickness = 20, through = { x: 0, y: 0 }): FixedItem {
  const r = (deg * Math.PI) / 180
  const ux = Math.cos(r)
  const uy = Math.sin(r)
  const cx = through.x - uy * offset
  const cy = through.y + ux * offset
  return wall(id, [
    { x: cx - ux * 1000, y: cy - uy * 1000 },
    { x: cx + ux * 1000, y: cy + uy * 1000 },
  ], thickness)
}

const canvasOf = (...items: Item[]): Canvas => ({ schemaVersion: 1, items })

describe('wallCrossings', () => {
  it('flags a round table a wall runs through, at any angle', () => {
    for (const deg of [0, 30, 45, 90, 135, 170]) {
      expect(wallCrossings(canvasOf(table()), [lineWall('w', deg, 0)]), `${deg} degrees`).toEqual([{ tableId: 't1', wallIds: ['w'] }])
    }
  })

  it('leaves a round table alone when the wall face only touches its edge', () => {
    const r = 76.2
    for (const deg of [0, 30, 45, 90, 135]) {
      // Face exactly at the edge, and 0.5 cm in (inside the 1 cm tolerance).
      expect(wallCrossings(canvasOf(table()), [lineWall('w', deg, r + 10)])).toEqual([])
      expect(wallCrossings(canvasOf(table()), [lineWall('w', deg, r + 10 - 0.5)])).toEqual([])
      expect(wallCrossings(canvasOf(table()), [lineWall('w', deg, r + 10 - 2)])).toHaveLength(1)
    }
  })

  it('measures square and rect tables by their turned top, at several angles', () => {
    for (const rotation of [0, 30, 45, 90]) {
      const t = table({ shape: 'rect', width: 243.84, height: 76.2, rotation, seatCount: 8 })
      for (const deg of [0, 20, 45, 60, 90, 120, 160]) {
        // How far the turned top reaches along the wall's normal.
        const a = ((deg + 90 - rotation) * Math.PI) / 180
        const extent = (t.width / 2) * Math.abs(Math.cos(a)) + (t.height / 2) * Math.abs(Math.sin(a))
        const label = `table ${rotation}, wall ${deg}`
        expect(wallCrossings(canvasOf(t), [lineWall('w', deg, 0)]), label).toHaveLength(1)
        expect(wallCrossings(canvasOf(t), [lineWall('w', deg, extent + 10 + 0.5)]), label).toEqual([])
        expect(wallCrossings(canvasOf(t), [lineWall('w', deg, extent + 10 - 2)]), label).toHaveLength(1)
        expect(wallCrossings(canvasOf(t), [lineWall('w', deg, -(extent + 10 - 2))]), label).toHaveLength(1)
      }
    }
  })

  it('ignores chairs: a wall through the chair ring but not the top is fine', () => {
    // Round top r = 76.2; chairs reach 53 cm further.
    expect(wallCrossings(canvasOf(table()), [lineWall('w', 0, 76.2 + 10 + 30)])).toEqual([])
  })

  it('flags a thin wall through the middle and skips walls that end before the table', () => {
    expect(wallCrossings(canvasOf(table()), [lineWall('w', 0, 0, 1)])).toHaveLength(1)
    const short = wall('w', [
      { x: -500, y: 0 },
      { x: -100, y: 0 },
    ])
    expect(wallCrossings(canvasOf(table()), [short])).toEqual([])
    // A wall that turns a corner inside the table.
    const corner = wall('w', [
      { x: -500, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: -500 },
    ])
    expect(wallCrossings(canvasOf(table()), [corner])).toEqual([{ tableId: 't1', wallIds: ['w'] }])
  })

  it('lists tables in canvas order with each wall once, and skips other items', () => {
    const fixture: Item = { id: 'bar', kind: 'fixture', type: 'bar', x: 0, y: 0, rotation: 0, locked: false, width: 300, height: 300, label: 'Bar' }
    const a = table({ id: 'a', x: 0 })
    const b = table({ id: 'b', x: 1000 })
    const c = table({ id: 'c', x: 0, y: 1000 })
    const walls = [
      wall('w1', [
        { x: -300, y: 0 },
        { x: 300, y: 0 },
        { x: 300, y: 40 },
        { x: -300, y: 40 },
      ]),
      lineWall('w2', 90, 0, 20, { x: 1000, y: 0 }),
    ]
    const out = wallCrossings(canvasOf(fixture, b, a, c), walls)
    expect(out).toEqual([
      { tableId: 'b', wallIds: ['w2'] },
      { tableId: 'a', wallIds: ['w1'] },
    ])
    expect(crossedTableIds(canvasOf(a, b, c), walls)).toEqual(new Set(['a', 'b']))
    expect(wallCrossings(canvasOf(a), [])).toEqual([])
    // Rooms and other fixed items are not walls.
    const roomOnly: FixedItem = { id: 'r', type: 'room', points: [{ x: -300, y: -300 }, { x: 300, y: -300 }, { x: 0, y: 300 }], unsure: false, unsureNote: '' }
    expect(wallCrossings(canvasOf(a), [roomOnly])).toEqual([])
  })

  it('reports how deep a wall reaches into a table top', () => {
    const t = { kind: 'obb' as const, x: 0, y: 0, halfW: 100, halfH: 50, rotation: 0 }
    expect(wallPenetration({ x: -500, y: 70 }, { x: 500, y: 70 }, 10, t)).toBeCloseTo(-10)
    expect(wallPenetration({ x: -500, y: 0 }, { x: 500, y: 0 }, 10, t)).toBeCloseTo(60)
    // A diagonal crossing a corner: deepest where the two edge distances are equal.
    expect(wallPenetration({ x: 60, y: 60 }, { x: 140, y: -20 }, 0, t)).toBeCloseTo(15)
  })

  it('is fast enough for 40 tables and 2,000 wall pieces', () => {
    const items: Item[] = []
    for (let i = 0; i < 40; i++) items.push(table({ id: `t${i}`, x: (i % 8) * 400, y: Math.floor(i / 8) * 400, shape: i % 2 ? 'round' : 'rect', width: 182.88, height: i % 2 ? 182.88 : 91.44 }))
    let seed = 7
    const rand = () => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    const fixed: FixedItem[] = []
    for (let w = 0; w < 100; w++) {
      const points = [{ x: rand() * 3200, y: rand() * 2000 }]
      for (let k = 0; k < 20; k++) points.push({ x: points[k].x + (rand() - 0.5) * 300, y: points[k].y + (rand() - 0.5) * 300 })
      fixed.push(wall(`w${w}`, points, 15))
    }
    const index = buildWallIndex(fixed)
    expect(index.segments).toHaveLength(2000)
    let best = Infinity
    for (let run = 0; run < 5; run++) {
      const start = performance.now()
      wallCrossings(canvasOf(...items), fixed)
      best = Math.min(best, performance.now() - start)
    }
    expect(best).toBeLessThan(10)
    // The per-table check gives the same answer as the whole pass.
    const whole = wallCrossings(canvasOf(...items), fixed)
    const each = items.flatMap((t) => (t.kind === 'table' ? [{ tableId: t.id, wallIds: tableWallHits(t, index) }] : [])).filter((c) => c.wallIds.length > 0)
    expect(each).toEqual(whole)
  })
})
