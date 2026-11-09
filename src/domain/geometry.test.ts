import { describe, expect, it } from 'vitest'
import type { Fixture, Item, Note, Shape, Table } from './canvas-schema'
import {
  boxContains,
  boxDistance,
  boxesIntersect,
  boxFromCorners,
  boxSelects,
  closestPointOnSegment,
  contentBox,
  distanceToPolyline,
  fixedItemBox,
  itemBodyFootprint,
  tableBodyFootprint,
  venueBox,
  distanceToSegment,
  footprintBox,
  hitTestItem,
  itemBox,
  itemCorners,
  itemFootprint,
  itemLocalBounds,
  localToWorld,
  normalizeDegrees,
  pointInPolygon,
  rotatePoint,
  segmentIntersection,
  segmentsIntersect,
  unionBoxes,
  worldToLocal,
  type Point,
} from './geometry'
import { CHAIR_DEPTH_CM, emptySeats } from './seats'
import type { FixedItem } from './venue-schema'

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

function fixture(overrides: Partial<Fixture> = {}): Fixture {
  return { id: 'f', kind: 'fixture', type: 'bar', x: 0, y: 0, rotation: 0, locked: false, width: 200, height: 100, label: 'Bar', ...overrides }
}

function shape(overrides: Partial<Shape> = {}): Shape {
  return {
    id: 's',
    kind: 'shape',
    type: 'rect',
    x: 0,
    y: 0,
    rotation: 0,
    locked: false,
    width: 100,
    height: 50,
    style: { stroke: '#000', fill: 'none', strokeWidth: 2 },
    ...overrides,
  }
}

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: 'n',
    kind: 'note',
    type: 'sticky',
    x: 0,
    y: 0,
    rotation: 0,
    locked: false,
    width: 100,
    height: 100,
    text: '',
    color: 'yellow',
    author: 'Noa',
    done: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    attachedTo: { start: null, end: null },
    ...overrides,
  }
}

function close(p: Point, q: Point, digits = 9) {
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

describe('turning points', () => {
  it('turns clockwise on screen, where y points down', () => {
    close(rotatePoint({ x: 1, y: 0 }, 90), { x: 0, y: 1 })
    close(rotatePoint({ x: 0, y: -1 }, 90), { x: 1, y: 0 })
    close(rotatePoint({ x: 2, y: 1 }, 180, { x: 1, y: 1 }), { x: 0, y: 1 })
  })

  it('goes from an item frame to the canvas and back', () => {
    const random = rng(10)
    for (let i = 0; i < 200; i++) {
      const pose = { x: random() * 2000 - 1000, y: random() * 2000 - 1000, rotation: random() * 720 - 360 }
      const p = { x: random() * 400 - 200, y: random() * 400 - 200 }
      close(worldToLocal(pose, localToWorld(pose, p)), p, 6)
      close(localToWorld(pose, worldToLocal(pose, p)), p, 6)
    }
  })

  it('keeps angles in [0, 360)', () => {
    expect(normalizeDegrees(-15)).toBe(345)
    expect(normalizeDegrees(720)).toBe(0)
    expect(normalizeDegrees(370)).toBe(10)
    expect(normalizeDegrees(-360)).toBe(0)
  })
})

describe('item outlines', () => {
  it('gives the corners of a turned rectangle in its own order', () => {
    const corners = itemCorners(fixture({ x: 10, y: 20, rotation: 90 }))
    close(corners[0], { x: 10 + 50, y: 20 - 100 })
    close(corners[1], { x: 10 + 50, y: 20 + 100 })
    close(corners[2], { x: 10 - 50, y: 20 + 100 })
    close(corners[3], { x: 10 - 50, y: 20 - 100 })
  })

  it('boxes a turned item by its corners, and a round table by its circle', () => {
    const b = itemBox(fixture({ width: 100, height: 100, rotation: 45 }))
    const half = 50 * Math.SQRT2
    expect(b.minX).toBeCloseTo(-half, 9)
    expect(b.maxY).toBeCloseTo(half, 9)
    const r = itemBox(table({ x: 5, rotation: 33 }))
    expect(r).toEqual({ minX: 5 - 76.2, minY: -76.2, maxX: 5 + 76.2, maxY: 76.2 })
  })

  it('counts a chair row as its chairs', () => {
    const row: Item = {
      id: 'r',
      kind: 'chairRow',
      x: 0,
      y: 0,
      rotation: 0,
      locked: false,
      chairCount: 5,
      spacing: 50.8,
      blockId: null,
      blockLabel: null,
      rowNumber: 1,
      rowLabel: 'Row 1',
      reservedFor: null,
      seats: emptySeats(5),
    }
    expect(itemLocalBounds(row)).toEqual({ minX: -(4 * 50.8 + 45) / 2, minY: -22.5, maxX: (4 * 50.8 + 45) / 2, maxY: 22.5 })
  })

  it('takes in every point of a shape, wherever its box is', () => {
    const s = shape({ points: [{ x: -80, y: 0 }, { x: 10, y: 70 }] })
    expect(itemLocalBounds(s)).toEqual({ minX: -80, minY: -25, maxX: 50, maxY: 70 })
  })
})

describe('footprints with chairs', () => {
  it('puts a chair ring round a seated round table, and none round an empty one', () => {
    const f = itemFootprint(table({ x: 100, y: 50 }))
    expect(f).toEqual({ kind: 'circle', x: 100, y: 50, r: 76.2 + CHAIR_DEPTH_CM })
    expect(itemFootprint(table({ seatCount: 0, seats: [] }))).toEqual({ kind: 'circle', x: 0, y: 0, r: 76.2 })
  })

  it('adds chairs only on the sides that have seats', () => {
    const noEnds = footprintBox(table({ shape: 'rect', width: 243.84, height: 76.2, seatSides: 'noEnds' }))
    expect(noEnds.minX).toBeCloseTo(-121.92, 9)
    expect(noEnds.maxX).toBeCloseTo(121.92, 9)
    expect(noEnds.minY).toBeCloseTo(-38.1 - CHAIR_DEPTH_CM, 9)
    expect(noEnds.maxY).toBeCloseTo(38.1 + CHAIR_DEPTH_CM, 9)

    const head = table({ shape: 'rect', width: 731.52, height: 76.2, seatCount: 12, seatSides: 'oneSide' })
    const f = itemFootprint(head)
    expect(f.kind).toBe('obb')
    if (f.kind !== 'obb') return
    expect(f.halfH).toBeCloseTo((76.2 + CHAIR_DEPTH_CM) / 2, 9)
    expect(f.y).toBeCloseTo(-CHAIR_DEPTH_CM / 2, 9)
    const b = footprintBox(head)
    expect(b.minY).toBeCloseTo(-38.1 - CHAIR_DEPTH_CM, 9)
    expect(b.maxY).toBeCloseTo(38.1, 9)
    // Turned a quarter clockwise, the chairs sit to the right.
    const turned = footprintBox({ ...head, rotation: 90 })
    expect(turned.maxX).toBeCloseTo(38.1 + CHAIR_DEPTH_CM, 9)
    expect(turned.minX).toBeCloseTo(-38.1, 9)
  })

  it('counts a wall as thick as it is, and a fixture as its body', () => {
    const wall = shape({ type: 'wall', width: 300, height: 15, points: [{ x: -150, y: 0 }, { x: 150, y: 0 }], style: { stroke: '#000', fill: 'none', strokeWidth: 15 } })
    expect(footprintBox(wall)).toEqual({ minX: -157.5, minY: -7.5, maxX: 157.5, maxY: 7.5 })
    const turned = footprintBox({ ...wall, rotation: 90 })
    expect(turned.minY).toBeCloseTo(-157.5, 9)
    expect(turned.maxX).toBeCloseTo(7.5, 9)
    expect(footprintBox(fixture())).toEqual({ minX: -100, minY: -50, maxX: 100, maxY: 50 })
  })

  it('gives a table top alone, no chairs, for the space check (A1)', () => {
    expect(tableBodyFootprint(table({ x: 100, y: 50 }))).toEqual({ kind: 'circle', x: 100, y: 50, r: 76.2 })
    const rect = table({ shape: 'rect', width: 243.84, height: 76.2, seatSides: 'noEnds', rotation: 30, x: 5 })
    expect(tableBodyFootprint(rect)).toEqual({ kind: 'obb', x: 5, y: 0, halfW: 121.92, halfH: 38.1, rotation: 30 })
    const head = table({ shape: 'rect', width: 731.52, height: 76.2, seatCount: 12, seatSides: 'oneSide' })
    expect(itemBodyFootprint(head)).toMatchObject({ kind: 'obb', y: 0, halfH: 38.1 })
    expect(itemBodyFootprint(fixture())).toEqual(itemFootprint(fixture()))
  })

  it('boxes the whole canvas, or nothing when empty', () => {
    expect(contentBox({ items: [] })).toBeNull()
    const b = contentBox({ items: [fixture({ x: 1000 }), table()] })
    expect(b).toEqual({ minX: -76.2 - CHAIR_DEPTH_CM, minY: -76.2 - CHAIR_DEPTH_CM, maxX: 1100, maxY: 76.2 + CHAIR_DEPTH_CM })
  })
})

describe('hit testing', () => {
  it('tests a round table as a circle', () => {
    const t = table()
    expect(hitTestItem(t, { x: 70, y: 0 })).toBe(true)
    // Inside the box but outside the circle.
    expect(hitTestItem(t, { x: 70, y: 70 })).toBe(false)
    expect(hitTestItem(t, { x: 80, y: 0 })).toBe(false)
    expect(hitTestItem(t, { x: 80, y: 0 }, 5)).toBe(true)
  })

  it('tests a turned rectangle in its own frame', () => {
    const f = fixture({ width: 200, height: 20, rotation: 45 })
    expect(hitTestItem(f, { x: 60, y: 60 })).toBe(true)
    expect(hitTestItem(f, { x: 60, y: -60 })).toBe(false)
    expect(hitTestItem(table({ shape: 'rect', width: 243.84, height: 76.2, rotation: 90 }), { x: 0, y: 100 })).toBe(true)
  })

  it('tests ellipses and circle notes as ellipses', () => {
    const e = shape({ type: 'ellipse', width: 200, height: 100 })
    expect(hitTestItem(e, { x: 99, y: 0 })).toBe(true)
    expect(hitTestItem(e, { x: 90, y: 40 })).toBe(false)
    expect(hitTestItem(note({ type: 'circle' }), { x: 45, y: 45 })).toBe(false)
    expect(hitTestItem(note({ type: 'circle' }), { x: 30, y: 30 })).toBe(true)
  })

  it('tests lines and walls along their path', () => {
    const line = shape({ type: 'line', width: 200, height: 10, points: [{ x: -100, y: 0 }, { x: 100, y: 0 }], rotation: 90, style: { stroke: '#000', fill: 'none', strokeWidth: 4 } })
    expect(hitTestItem(line, { x: 1, y: 90 })).toBe(true)
    expect(hitTestItem(line, { x: 5, y: 90 })).toBe(false)
    expect(hitTestItem(line, { x: 5, y: 90 }, 4)).toBe(true)
    const wall = shape({ type: 'wall', width: 300, height: 15, points: [{ x: -150, y: 0 }, { x: 150, y: 0 }], style: { stroke: '#000', fill: 'none', strokeWidth: 1 } })
    expect(hitTestItem(wall, { x: 0, y: 7 })).toBe(true)
    expect(hitTestItem(wall, { x: 0, y: 9 })).toBe(false)
    const arrow = note({ type: 'arrow', points: [{ x: 0, y: 0 }, { x: 100, y: 100 }] })
    expect(hitTestItem(arrow, { x: 50, y: 52 }, 3)).toBe(true)
    expect(hitTestItem(arrow, { x: 50, y: 60 }, 3)).toBe(false)
  })

  it('tests an unfilled room by its outline and a filled one inside too', () => {
    const points = [
      { x: -300, y: -200 },
      { x: 300, y: -200 },
      { x: 300, y: 200 },
      { x: -300, y: 200 },
    ]
    const room = shape({ type: 'room', width: 600, height: 400, points, style: { stroke: '#000', fill: 'none', strokeWidth: 5 } })
    expect(hitTestItem(room, { x: 0, y: 0 })).toBe(false)
    expect(hitTestItem(room, { x: 299, y: 0 })).toBe(true)
    expect(hitTestItem({ ...room, style: { ...room.style, fill: '#eee' } }, { x: 0, y: 0 })).toBe(true)
  })

  it('selects by box only what the box wholly holds', () => {
    const f = fixture()
    expect(boxSelects({ minX: -101, minY: -51, maxX: 101, maxY: 51 }, f)).toBe(true)
    expect(boxSelects({ minX: -99, minY: -51, maxX: 101, maxY: 51 }, f)).toBe(false)
    expect(boxFromCorners({ x: 5, y: -5 }, { x: -5, y: 5 })).toEqual({ minX: -5, minY: -5, maxX: 5, maxY: 5 })
  })
})

describe('segments', () => {
  it('finds where two segments cross', () => {
    const p = segmentIntersection({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 })
    expect(p).not.toBeNull()
    close(p as Point, { x: 5, y: 5 })
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 })).toBe(true)
  })

  it('counts touching at an end and overlapping in line, not parallel or short of each other', () => {
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 })).toBe(true)
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }, { x: 15, y: 0 })).toBe(true)
    expect(segmentIntersection({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }, { x: 15, y: 0 })).toEqual({ x: 5, y: 0 })
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 11, y: 0 }, { x: 15, y: 0 })).toBe(false)
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 1 }, { x: 10, y: 1 })).toBe(false)
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 1 }, { x: 5, y: 8 })).toBe(false)
    expect(segmentIntersection({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 1 }, { x: 5, y: 8 })).toBeNull()
  })

  it('agrees with a brute-force check on random segments', () => {
    const random = rng(11)
    for (let i = 0; i < 500; i++) {
      const p = () => ({ x: Math.round(random() * 20), y: Math.round(random() * 20) })
      const a1 = p()
      const a2 = p()
      const b1 = p()
      const b2 = p()
      const hit = segmentIntersection(a1, a2, b1, b2)
      if (hit) {
        expect(distanceToSegment(hit, a1, a2)).toBeLessThan(1e-6)
        expect(distanceToSegment(hit, b1, b2)).toBeLessThan(1e-6)
      } else {
        // Apart: sample one segment and check none of it lies on the other.
        for (let k = 0; k <= 50; k++) {
          const q = { x: a1.x + ((a2.x - a1.x) * k) / 50, y: a1.y + ((a2.y - a1.y) * k) / 50 }
          expect(distanceToSegment(q, b1, b2)).toBeGreaterThan(1e-9)
        }
      }
    }
  })

  it('measures from a point to a segment, past the ends too', () => {
    expect(distanceToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3)
    expect(distanceToSegment({ x: 13, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5)
    expect(distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5)
    expect(closestPointOnSegment({ x: -4, y: 2 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toEqual({ x: 0, y: 0 })
    expect(distanceToPolyline({ x: 5, y: 5 }, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])).toBe(5)
    expect(distanceToPolyline({ x: 0, y: 5 }, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], true)).toBeCloseTo(5 / Math.SQRT2, 9)
    expect(distanceToPolyline({ x: 0, y: 0 }, [])).toBe(Infinity)
  })

  it('tests points in polygons', () => {
    const tri = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ]
    expect(pointInPolygon({ x: 2, y: 2 }, tri)).toBe(true)
    expect(pointInPolygon({ x: 8, y: 8 }, tri)).toBe(false)
  })
})

describe('boxes', () => {
  const a = { minX: 0, minY: 0, maxX: 10, maxY: 10 }
  it('tests overlap, containment and distance', () => {
    expect(boxesIntersect(a, { minX: 10, minY: 10, maxX: 20, maxY: 20 })).toBe(true)
    expect(boxesIntersect(a, { minX: 11, minY: 0, maxX: 20, maxY: 10 })).toBe(false)
    expect(boxContains(a, { minX: 1, minY: 1, maxX: 9, maxY: 9 })).toBe(true)
    expect(boxContains(a, { minX: 1, minY: 1, maxX: 11, maxY: 9 })).toBe(false)
    expect(boxDistance(a, { minX: 13, minY: 14, maxX: 20, maxY: 20 })).toBe(5)
    expect(boxDistance(a, { minX: 5, minY: 5, maxX: 20, maxY: 20 })).toBe(0)
    expect(unionBoxes([a, null, { minX: -5, minY: 2, maxX: 3, maxY: 30 }])).toEqual({ minX: -5, minY: 0, maxX: 10, maxY: 30 })
    expect(unionBoxes([])).toBeNull()
  })
})

describe('venue boxes (A10)', () => {
  const common = { unsure: false, unsureNote: '' }

  it('boxes each kind of fixed item', () => {
    expect(fixedItemBox({ ...common, id: 'w', type: 'wall', points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }], thickness: 20 })).toEqual({
      minX: -10,
      minY: -10,
      maxX: 1010,
      maxY: 10,
    })
    expect(fixedItemBox({ ...common, id: 'r', type: 'room', points: [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 300 }] })).toEqual({
      minX: 0,
      minY: 0,
      maxX: 500,
      maxY: 300,
    })
    const col = fixedItemBox({ ...common, id: 'c', type: 'column', shape: 'rect', x: 100, y: 100, width: 40, height: 20, rotation: 90 })!
    expect(col.minX).toBeCloseTo(90, 9)
    expect(col.maxY).toBeCloseTo(120, 9)
    const door = fixedItemBox({ ...common, id: 'd', type: 'door', wallId: null, x: 0, y: 0, rotation: 0, width: 90, swing: 'left' })!
    expect(door).toEqual({ minX: -45, minY: -90, maxX: 45, maxY: 90 })
    expect(fixedItemBox({ ...common, id: 'l', type: 'label', x: 7, y: 8, rotation: 0, text: 'Patio', fontSize: 30 })).toEqual({ minX: 7, minY: 8, maxX: 7, maxY: 8 })
  })

  it('boxes a whole venue, or nothing without fixed items', () => {
    const items: FixedItem[] = [
      { ...common, id: 'w', type: 'wall', points: [{ x: -2000, y: 0 }, { x: 3000, y: 0 }], thickness: 20 },
      { ...common, id: 'b', type: 'bar', x: 0, y: 900, width: 400, height: 100, rotation: 0, label: 'Bar' },
    ]
    expect(venueBox(items)).toEqual({ minX: -2010, minY: -10, maxX: 3010, maxY: 950 })
    expect(venueBox([])).toBeNull()
  })
})
