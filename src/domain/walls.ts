/**
 * Tables a venue wall runs through (spec section 5: "If a template change
 * puts a wall through a placed table, flag that table in each affected
 * layout"; DECISIONS 15: worked out when a layout opens and after each move,
 * never stored; PLAN change 16: each counts as a problem).
 *
 * A wall piece is its centre line widened by half its thickness on each side
 * (a capsule). It runs through a table when it reaches more than 1 cm into
 * the table's top (tableBodyFootprint: the circle of a round table, the
 * turned rectangle of a square or rect one). Chairs do not count, and a
 * table pushed flush against a wall is not flagged.
 */
import type { Canvas, Table } from './canvas-schema'
import { closestPointOnSegment, distance, tableBodyFootprint, worldToLocal, type Box, type Footprint, type Point } from './geometry'
import { wallSegments, type WallSegment } from './fixed-items'
import type { FixedItem } from './venue-schema'

/** A wall must reach this far into a table top to count. cm. */
export const WALL_TOUCH_TOLERANCE_CM = 1

export type WallCrossing = { tableId: string; wallIds: string[] }

/** The wall pieces with their boxes, built once per template for many tables. */
export type WallIndex = { segments: (WallSegment & { box: Box; radius: number })[] }

export function buildWallIndex(fixedItems: readonly FixedItem[]): WallIndex {
  return {
    segments: wallSegments(fixedItems).map((s) => {
      const radius = s.thickness / 2
      return {
        ...s,
        radius,
        box: {
          minX: Math.min(s.a.x, s.b.x) - radius,
          minY: Math.min(s.a.y, s.b.y) - radius,
          maxX: Math.max(s.a.x, s.b.x) + radius,
          maxY: Math.max(s.a.y, s.b.y) + radius,
        },
      }
    }),
  }
}

function footprintBounds(f: Footprint): Box {
  if (f.kind === 'circle') return { minX: f.x - f.r, minY: f.y - f.r, maxX: f.x + f.r, maxY: f.y + f.r }
  const r = (f.rotation * Math.PI) / 180
  const ex = Math.abs(f.halfW * Math.cos(r)) + Math.abs(f.halfH * Math.sin(r))
  const ey = Math.abs(f.halfW * Math.sin(r)) + Math.abs(f.halfH * Math.cos(r))
  return { minX: f.x - ex, minY: f.y - ey, maxX: f.x + ex, maxY: f.y + ey }
}

/** Distance from point p to the box [-hw, hw] x [-hh, hh]; 0 inside. */
function pointBoxDistance(p: Point, hw: number, hh: number): number {
  const dx = Math.max(0, Math.abs(p.x) - hw)
  const dy = Math.max(0, Math.abs(p.y) - hh)
  return Math.hypot(dx, dy)
}

/** True when segment a-b meets the box [-hw, hw] x [-hh, hh] (Liang-Barsky). */
function segmentHitsBox(a: Point, b: Point, hw: number, hh: number): boolean {
  const dx = b.x - a.x
  const dy = b.y - a.y
  let t0 = 0
  let t1 = 1
  const tests: [number, number][] = [
    [-dx, a.x + hw],
    [dx, hw - a.x],
    [-dy, a.y + hh],
    [dy, hh - a.y],
  ]
  for (const [p, q] of tests) {
    if (p === 0) {
      if (q < 0) return false
      continue
    }
    const r = q / p
    if (p < 0) {
      if (r > t1) return false
      if (r > t0) t0 = r
    } else {
      if (r < t0) return false
      if (r < t1) t1 = r
    }
  }
  return true
}

/** Distance between segment a-b and the box [-hw, hw] x [-hh, hh]; 0 when they meet. */
function segmentBoxDistance(a: Point, b: Point, hw: number, hh: number): number {
  if (segmentHitsBox(a, b, hw, hh)) return 0
  let best = Math.min(pointBoxDistance(a, hw, hh), pointBoxDistance(b, hw, hh))
  for (const c of [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ]) {
    best = Math.min(best, distance(c, closestPointOnSegment(c, a, b)))
  }
  return best
}

/**
 * How deep the wall piece reaches into the table top, in cm: its half
 * thickness plus how far its centre line gets inside the top, or its half
 * thickness minus the centre line's distance from the top when it stays
 * outside. Above 0 means they overlap; exactly 0 is a wall face touching the
 * table's edge.
 */
export function wallPenetration(a: Point, b: Point, halfThickness: number, f: Footprint): number {
  if (f.kind === 'circle') {
    const d = distance(f, closestPointOnSegment(f, a, b))
    return f.r + halfThickness - d
  }
  const pose = { x: f.x, y: f.y, rotation: f.rotation }
  const la = worldToLocal(pose, a)
  const lb = worldToLocal(pose, b)
  if (!segmentHitsBox(la, lb, f.halfW, f.halfH)) return halfThickness - segmentBoxDistance(la, lb, f.halfW, f.halfH)
  return halfThickness + Math.max(0, insideDepth(la, lb, f.halfW, f.halfH))
}

/**
 * The largest distance from the box's edge reached by a point of the segment
 * inside the box. The depth min(hw - |x|, hh - |y|) is concave and piecewise
 * linear along the segment, so its largest value is at an end or where two
 * of its four pieces meet.
 */
function insideDepth(a: Point, b: Point, hw: number, hh: number): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  let best = -Infinity
  const consider = (t: number) => {
    if (!(t >= 0 && t <= 1)) return
    const x = a.x + dx * t
    const y = a.y + dy * t
    const depth = Math.min(hw - Math.abs(x), hh - Math.abs(y))
    if (depth > best) best = depth
  }
  consider(0)
  consider(1)
  if (dx !== 0) consider(-a.x / dx)
  if (dy !== 0) consider(-a.y / dy)
  // hw - sx * x = hh - sy * y for each pair of signs.
  for (const sx of [1, -1]) {
    for (const sy of [1, -1]) {
      const denom = sx * dx - sy * dy
      if (denom !== 0) consider((hw - hh - sx * a.x + sy * a.y) / denom)
    }
  }
  return best
}

/** The walls that run through one table: ids, each once, in template order. */
export function tableWallHits(table: Table, index: WallIndex, tolerance = WALL_TOUCH_TOLERANCE_CM): string[] {
  const f = tableBodyFootprint(table)
  const box = footprintBounds(f)
  const hits: string[] = []
  for (const s of index.segments) {
    if (s.box.maxX < box.minX || s.box.minX > box.maxX || s.box.maxY < box.minY || s.box.minY > box.maxY) continue
    if (hits.includes(s.wallId)) continue
    if (wallPenetration(s.a, s.b, s.radius, f) > tolerance) hits.push(s.wallId)
  }
  return hits
}

/**
 * Every table in the layout that a venue wall runs through, in canvas order,
 * with the walls that do. Tables clear of every wall are left out.
 */
export function wallCrossings(canvas: Pick<Canvas, 'items'>, fixedItems: readonly FixedItem[], tolerance = WALL_TOUCH_TOLERANCE_CM): WallCrossing[] {
  const index = buildWallIndex(fixedItems)
  if (index.segments.length === 0) return []
  const out: WallCrossing[] = []
  for (const item of canvas.items) {
    if (item.kind !== 'table') continue
    const wallIds = tableWallHits(item, index, tolerance)
    if (wallIds.length > 0) out.push({ tableId: item.id, wallIds })
  }
  return out
}

/** The ids of tables a wall runs through. */
export function crossedTableIds(canvas: Pick<Canvas, 'items'>, fixedItems: readonly FixedItem[]): Set<string> {
  return new Set(wallCrossings(canvas, fixedItems).map((c) => c.tableId))
}
