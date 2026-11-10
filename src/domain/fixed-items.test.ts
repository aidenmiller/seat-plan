import { describe, expect, it } from 'vitest'
import {
  fixedItemAt,
  fixedItemBounds,
  hitTestFixedItem,
  polylineLength,
  polylineSegment,
  polylineSegmentLength,
  projectOntoWall,
  segmentCount,
  setSegmentLength,
  wallGapAt,
  wallSegments,
} from './fixed-items'
import type { FixedItem } from './venue-schema'

const flags = { unsure: false, unsureNote: '' }
const p = (x: number, y: number) => ({ x, y })
const wall = (id: string, points: { x: number; y: number }[], thickness = 20): FixedItem => ({ id, type: 'wall', points, thickness, ...flags })

describe('polyline lengths', () => {
  const square = [p(0, 0), p(300, 0), p(300, 400), p(0, 400)]

  it('measures segments of open and closed outlines', () => {
    expect(segmentCount(square, false)).toBe(3)
    expect(segmentCount(square, true)).toBe(4)
    expect(polylineSegmentLength(square, 0)).toBe(300)
    expect(polylineSegmentLength(square, 3)).toBe(0)
    expect(polylineSegmentLength(square, 3, true)).toBe(400)
    expect(polylineSegment(square, 3, true)).toEqual([p(0, 400), p(0, 0)])
    expect(polylineLength(square)).toBe(1000)
    expect(polylineLength(square, true)).toBe(1400)
    expect(polylineLength([p(0, 0), p(30, 40)])).toBe(50)
  })

  it('sets a length by moving the far end along its line', () => {
    const out = setSegmentLength([p(0, 0), p(30, 40), p(100, 40)], 0, 100)
    expect(out[0]).toEqual(p(0, 0))
    expect(out[1].x).toBeCloseTo(60)
    expect(out[1].y).toBeCloseTo(80)
    // Only the far end moves.
    expect(out[2]).toEqual(p(100, 40))
    expect(polylineSegmentLength(out, 0)).toBeCloseTo(100)
  })

  it('can carry the rest of an open wall along, keeping its shape', () => {
    const out = setSegmentLength([p(0, 0), p(100, 0), p(100, 100), p(200, 100)], 0, 250, { carry: 'rest' })
    expect(out).toEqual([p(0, 0), p(250, 0), p(250, 100), p(350, 100)])
  })

  it('sets the closing side of a room by moving its first corner', () => {
    const out = setSegmentLength([p(0, 0), p(300, 0), p(300, 400), p(0, 400)], 3, 500, { closed: true })
    expect(out[0].x).toBeCloseTo(0)
    expect(out[0].y).toBeCloseTo(-100)
    expect(out.slice(1)).toEqual([p(300, 0), p(300, 400), p(0, 400)])
  })

  it('leaves the points alone for a bad index, a bad length or a zero-length segment', () => {
    const pts = [p(0, 0), p(0, 0), p(10, 0)]
    expect(setSegmentLength(pts, 0, 50)).toEqual(pts)
    expect(setSegmentLength(pts, 5, 50)).toEqual(pts)
    expect(setSegmentLength(pts, 1, -3)).toEqual(pts)
    expect(setSegmentLength(pts, 1, Number.NaN)).toEqual(pts)
  })
})

describe('snapping onto walls', () => {
  const items: FixedItem[] = [
    wall('a', [p(0, 0), p(400, 0), p(400, 300)]),
    wall('b', [p(500, 0), p(1000, 0)]),
    { id: 'r', type: 'room', points: [p(0, 0), p(1000, 0), p(1000, 300)], ...flags },
  ]

  it('lists wall pieces only', () => {
    expect(wallSegments(items).map((s) => [s.wallId, s.index])).toEqual([
      ['a', 0],
      ['a', 1],
      ['b', 0],
    ])
  })

  it('projects onto the nearest wall, with its direction and the distance along it', () => {
    const hit = projectOntoWall(p(395, 150), items)!
    expect(hit).toMatchObject({ wallId: 'a', segmentIndex: 1, x: 400, y: 150, rotation: 90, distance: 5 })
    expect(hit.along).toBe(550)
  })

  it('turns round to the side the item already faced', () => {
    expect(projectOntoWall(p(200, 10), items, { preferRotation: 170 })!.rotation).toBe(180)
    expect(projectOntoWall(p(200, 10), items, { preferRotation: 20 })!.rotation).toBe(0)
  })

  it('lands in a gap on the wall line, and gives up when no wall is near', () => {
    // Between a's first piece and b: nearest is a's corner, projected on the line y = 0.
    const hit = projectOntoWall(p(440, 6), items)!
    expect([hit.x, hit.y]).toEqual([440, 0])
    expect(projectOntoWall(p(200, 200), items, { maxDistance: 50 })).toBeNull()
    expect(projectOntoWall(p(200, 10), [])).toBeNull()
  })

  it('can be held to one wall', () => {
    expect(projectOntoWall(p(450, 1), items, { onlyWallId: 'b' })).toMatchObject({ wallId: 'b', x: 450, y: 0 })
  })

  it('finds the opening between two pieces on one line', () => {
    const gap = wallGapAt(p(450, 0), items)!
    expect(gap).toMatchObject({ from: p(400, 0), to: p(500, 0), middle: p(450, 0), width: 100, rotation: 0 })
    // Not in a gap: on a wall, or the gap is too wide.
    expect(wallGapAt(p(200, 0), items)).toBeNull()
    expect(wallGapAt(p(450, 0), items, { maxGap: 80 })).toBeNull()
  })
})

describe('bounds and hit testing', () => {
  const door: FixedItem = { id: 'd', type: 'door', wallId: null, x: 100, y: 0, rotation: 0, width: 90, swing: 'left', ...flags }
  const win: FixedItem = { id: 'w', type: 'window', wallId: null, x: 0, y: 0, rotation: 90, width: 120, ...flags }
  const label: FixedItem = { id: 'l', type: 'label', x: 0, y: 0, rotation: 0, text: 'KITCHEN', fontSize: 30, ...flags }
  const column: FixedItem = { id: 'c', type: 'column', shape: 'round', x: 0, y: 0, width: 40, height: 40, rotation: 0, ...flags }
  const room: FixedItem = { id: 'r', type: 'room', points: [p(-500, -500), p(500, -500), p(500, 500), p(-500, 500)], name: 'Hall', ...flags }

  it('sizes labels by their text and windows by a depth', () => {
    const b = fixedItemBounds(label)!
    expect(b.maxX - b.minX).toBeCloseTo(7 * 30 * 0.6)
    expect(b.maxY - b.minY).toBeCloseTo(36)
    const w = fixedItemBounds(win)!
    expect(w.maxY - w.minY).toBeCloseTo(120)
    expect(w.maxX - w.minX).toBeCloseTo(20)
    expect(fixedItemBounds(room)).toEqual({ minX: -501.5, minY: -501.5, maxX: 501.5, maxY: 501.5 })
  })

  it('hits each kind where it is drawn', () => {
    expect(hitTestFixedItem(wall('a', [p(0, 0), p(100, 0)]), p(50, 9))).toBe(true)
    expect(hitTestFixedItem(wall('a', [p(0, 0), p(100, 0)]), p(50, 12))).toBe(false)
    expect(hitTestFixedItem(wall('a', [p(0, 0), p(100, 0)]), p(50, 12), 3)).toBe(true)
    // The door's swing opens toward its +y.
    expect(hitTestFixedItem(door, p(100, 60))).toBe(true)
    expect(hitTestFixedItem(door, p(100, -60))).toBe(false)
    expect(hitTestFixedItem(win, p(0, 55))).toBe(true)
    expect(hitTestFixedItem(win, p(15, 0))).toBe(false)
    expect(hitTestFixedItem(column, p(14, 14))).toBe(true)
    expect(hitTestFixedItem(column, p(19, 19))).toBe(false)
    expect(hitTestFixedItem(label, p(60, 10))).toBe(true)
    expect(hitTestFixedItem(label, p(0, 30))).toBe(false)
    expect(hitTestFixedItem(room, p(0, 0))).toBe(true)
    expect(hitTestFixedItem(room, p(600, 0))).toBe(false)
    const turned: FixedItem = { id: 's', type: 'stairs', x: 0, y: 0, width: 200, height: 40, rotation: 90, ...flags }
    expect(hitTestFixedItem(turned, p(0, 90))).toBe(true)
    expect(hitTestFixedItem(turned, p(90, 0))).toBe(false)
  })

  it('picks what is on top, and a room only when nothing else is there', () => {
    const items = [room, column, label]
    expect(fixedItemAt(items, p(0, 0))?.id).toBe('l')
    expect(fixedItemAt([room, column], p(0, 0))?.id).toBe('c')
    expect(fixedItemAt([column, room], p(0, 0))?.id).toBe('c')
    expect(fixedItemAt(items, p(300, 300))?.id).toBe('r')
    expect(fixedItemAt(items, p(900, 900))).toBeNull()
  })
})
