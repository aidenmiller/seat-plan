import { describe, expect, it } from 'vitest'
import type { Box } from './geometry'
import { FOOT_GRID_CM, gridStepCm, METER_GRID_CM, snapMove, snapToGrid, visibleGridStepCm, type SnapOptions } from './snapping'

const box = (minX: number, minY: number, w: number, h: number): Box => ({ minX, minY, maxX: minX + w, maxY: minY + h })
const both: SnapOptions = { gridStep: FOOT_GRID_CM, tolerancePx: 6, zoom: 1, snapGrid: true, snapGuides: true }

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

describe('the grid', () => {
  it('is 1 ft or 0.5 m by the wedding unit', () => {
    expect(gridStepCm('ft')).toBe(30.48)
    expect(gridStepCm('m')).toBe(METER_GRID_CM)
  })

  it('snaps to the nearest line without float noise', () => {
    expect(snapToGrid(95, 30.48)).toBe(91.44)
    expect(snapToGrid(-20, 30.48)).toBe(-30.48)
    expect(snapToGrid(-10, 30.48)).toBe(0)
    expect(Object.is(snapToGrid(-10, 30.48), -0)).toBe(false)
    expect(snapToGrid(12.3, 0)).toBe(12.3)
  })

  it('thins out lines closer than 8 px (DECISIONS 35)', () => {
    expect(visibleGridStepCm('ft', 1)).toBe(30.48)
    expect(visibleGridStepCm('ft', 0.2)).toBeCloseTo(152.4, 9)
    expect(visibleGridStepCm('m', 0.5)).toBe(50)
    expect(visibleGridStepCm('m', 0.1)).toBe(100)
    for (const zoom of [0.1, 0.13, 0.25, 0.5, 1, 4, 8]) {
      expect(visibleGridStepCm('ft', zoom) * zoom).toBeGreaterThanOrEqual(8)
      expect(visibleGridStepCm('m', zoom) * zoom).toBeGreaterThanOrEqual(8)
    }
  })
})

describe('snapMove', () => {
  it('puts the nearest edge or center on the grid', () => {
    // Left edge at 33, 2.52 past a line; the center at 83 is 8.44 off one.
    const r = snapMove(box(33, 0, 100, 61), [], { ...both, snapGuides: false })
    expect(r.dx).toBeCloseTo(30.48 - 33, 9)
    expect(r.snappedX).toBe('grid')
    // Top at 0 is on a line already.
    expect(r.dy).toBe(0)
    // A 152.4 cm table has its center, not its edges, on a 1 ft grid.
    const t = snapMove(box(-70, -70, 152.4, 152.4), [], { ...both, snapGuides: false })
    expect(-70 + t.dx + 76.2).toBeCloseTo(0, 9)
  })

  it('snaps the bodies to the grid when given them, and the footprint to guides', () => {
    // A 60 in round with its chair ring: footprint 258.4 across, body 152.4.
    const body = box(-70, -70, 152.4, 152.4)
    const ring = box(-70 - 53, -70 - 53, 258.4, 258.4)
    const r = snapMove(ring, [], { ...both, snapGuides: false, gridBox: body })
    // The body's center lands on a line, as it would with no chairs; snapped by the ring it would not.
    expect(-70 + r.dx + 76.2).toBeCloseTo(0, 9)
    const byRing = snapMove(ring, [], { ...both, snapGuides: false })
    expect(-70 + byRing.dx + 76.2).not.toBeCloseTo(0, 3)
    // Guides still line up footprints.
    const other = box(200, 400, 100, 100)
    const g = snapMove(box(203, 0, 50, 50), [other], { ...both, gridBox: box(213, 10, 30, 30) })
    expect(g.dx).toBeCloseTo(-3, 9)
    expect(g.snappedX).toBe('guide')
  })

  it('snaps to another shape within the tolerance and draws the guide', () => {
    const other = box(200, 400, 100, 100)
    const r = snapMove(box(203, 0, 50, 50), [other], both)
    expect(r.dx).toBe(-3)
    expect(r.snappedX).toBe('guide')
    expect(r.guides).toContainEqual({ axis: 'x', at: 200, from: 0, to: 500 })
  })

  it('lets a guide win over the grid', () => {
    // The grid would move the left edge to 182.88; the other shape's edge is at 190.
    const r = snapMove(box(186, 0, 50, 50), [box(190, 300, 50, 50)], both)
    expect(r.dx).toBe(4)
    expect(r.snappedX).toBe('guide')
  })

  it('lines up centers too', () => {
    const r = snapMove(box(0, 98, 40, 40), [box(500, 100, 100, 40)], both)
    // Tops line up at 100 (2 away), centers at 120 (also 2 away): either way dy is 2.
    expect(r.dy).toBe(2)
    expect(r.guides.filter((g) => g.axis === 'y').map((g) => g.at)).toEqual([100, 120, 140])
  })

  it('reaches further in cm when zoomed out', () => {
    const others = [box(200, 400, 100, 100)]
    expect(snapMove(box(210, 0, 50, 50), others, { ...both, snapGrid: false }).snappedX).toBeNull()
    expect(snapMove(box(210, 0, 50, 50), others, { ...both, snapGrid: false, zoom: 0.5 }).dx).toBe(-10)
  })

  it('does nothing with Alt held', () => {
    const r = snapMove(box(203, 7, 50, 50), [box(200, 400, 100, 100)], { ...both, snapGrid: false, snapGuides: false })
    expect(r).toEqual({ dx: 0, dy: 0, snappedX: null, snappedY: null, guides: [] })
  })

  it('merges guides at one line into one, spanning every shape on it', () => {
    const r = snapMove(box(100, 200, 50, 50), [box(100, 0, 50, 50), box(100, 600, 80, 50)], { ...both, snapGrid: false })
    const left = r.guides.find((g) => g.axis === 'x' && g.at === 100)
    expect(left).toEqual({ axis: 'x', at: 100, from: 0, to: 650 })
  })

  it('scans 640 shapes in under 2 ms', () => {
    const random = rng(30)
    const others = Array.from({ length: 640 }, () => box(random() * 5000, random() * 5000, 50 + random() * 300, 50 + random() * 300))
    const moving = box(2500, 2500, 258.4, 258.4)
    for (let i = 0; i < 50; i++) snapMove(moving, others, both)
    const times: number[] = []
    for (let i = 0; i < 50; i++) {
      const start = performance.now()
      snapMove({ ...moving, minX: moving.minX + i, maxX: moving.maxX + i }, others, both)
      times.push(performance.now() - start)
    }
    times.sort((a, b) => a - b)
    expect(times[Math.floor(times.length / 2)]).toBeLessThan(2)
  })
})
