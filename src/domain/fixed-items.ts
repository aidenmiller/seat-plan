/**
 * Helpers the venue template editor needs for fixed items (spec section 5,
 * PLAN section 7 "Venue templates"): segment lengths and the typed length
 * field, door and window snapping onto walls, bounds and hit testing.
 *
 * Fixed item geometry is in canvas centimeters, y down. Wall, room, zone and
 * patio edge points are absolute canvas points (not offsets from a center).
 * Doors, windows, columns, stairs, bars and labels have a center (x, y) and
 * a rotation in degrees clockwise; a door or window's own x axis runs along
 * its wall and its swing opens toward its own +y (see VenueLayer.tsx).
 */
import {
  boxOfPoints,
  closestPointOnSegment,
  distance,
  distanceToPolyline,
  expandBox,
  fixedItemBox,
  normalizeDegrees,
  pointInPolygon,
  radToDeg,
  worldToLocal,
  type Box,
  type Point,
} from './geometry'
import type { FixedItem } from './venue-schema'

export type WallItem = Extract<FixedItem, { type: 'wall' }>
export type OutlineItem = Extract<FixedItem, { type: 'room' | 'zone' }>
export type OpeningItem = Extract<FixedItem, { type: 'door' | 'window' }>

/** True for items whose points close back on the first (rooms and zones). */
export function isClosedOutline(item: FixedItem): boolean {
  return item.type === 'room' || item.type === 'zone'
}

/** How many segments a polyline has: n - 1 open, n closed. */
export function segmentCount(points: readonly Point[], closed: boolean): number {
  if (points.length < 2) return 0
  return closed ? points.length : points.length - 1
}

/** The two ends of segment `index`, or null when there is none. */
export function polylineSegment(points: readonly Point[], index: number, closed: boolean): [Point, Point] | null {
  if (!Number.isInteger(index) || index < 0 || index >= segmentCount(points, closed)) return null
  return [points[index], points[(index + 1) % points.length]]
}

/** Length of segment `index` (the closing one is index n - 1 on a closed outline), or 0 when there is none. */
export function polylineSegmentLength(points: readonly Point[], index: number, closed = false): number {
  const seg = polylineSegment(points, index, closed)
  return seg ? distance(seg[0], seg[1]) : 0
}

/** Total length of a polyline. */
export function polylineLength(points: readonly Point[], closed = false): number {
  let total = 0
  for (let i = 0; i < segmentCount(points, closed); i++) total += polylineSegmentLength(points, i, closed)
  return total
}

/**
 * Sets segment `index` to `length` cm by moving its far end along the
 * segment's line (spec: "type exact lengths"). The near end stays put.
 * `carry: 'rest'` also moves every later point on an open polyline by the
 * same amount, so the rest of the wall keeps its shape. A zero-length segment
 * has no line to move along and is left alone. Returns new points.
 */
export function setSegmentLength(
  points: readonly Point[],
  index: number,
  length: number,
  options: { closed?: boolean; carry?: 'point' | 'rest' } = {},
): Point[] {
  const closed = options.closed ?? false
  const out = points.map((p) => ({ x: p.x, y: p.y }))
  const seg = polylineSegment(points, index, closed)
  if (!seg || !(length > 0) || !Number.isFinite(length)) return out
  const [a, b] = seg
  const current = distance(a, b)
  if (current === 0) return out
  const nx = a.x + ((b.x - a.x) / current) * length
  const ny = a.y + ((b.y - a.y) / current) * length
  const dx = nx - b.x
  const dy = ny - b.y
  const far = (index + 1) % points.length
  if (options.carry === 'rest' && !closed) {
    for (let i = far; i < out.length; i++) out[i] = { x: out[i].x + dx, y: out[i].y + dy }
  } else {
    out[far] = { x: nx, y: ny }
  }
  return out
}

// ---------------------------------------------------------------- walls

/** One straight piece of a wall. */
export type WallSegment = { wallId: string; index: number; a: Point; b: Point; thickness: number }

/** Every straight piece of every wall, in item order. */
export function wallSegments(items: readonly FixedItem[]): WallSegment[] {
  const out: WallSegment[] = []
  for (const item of items) {
    if (item.type !== 'wall') continue
    for (let i = 0; i + 1 < item.points.length; i++) {
      const a = item.points[i]
      const b = item.points[i + 1]
      if (a.x === b.x && a.y === b.y) continue
      out.push({ wallId: item.id, index: i, a, b, thickness: item.thickness })
    }
  }
  return out
}

export type WallProjection = {
  wallId: string
  /** Which segment of the wall. */
  segmentIndex: number
  /** The point on the wall's line, cm. */
  x: number
  y: number
  /** The wall's direction at that point, degrees clockwise, 0 to 360. */
  rotation: number
  /** Distance from the wall's first point along the wall to (x, y), cm. Past an end it runs on along the line. */
  along: number
  /** How far the point was from the wall piece. */
  distance: number
}

/**
 * Snaps a point onto a wall (doors and windows; spec: "door and window
 * symbols that sit on walls"). The point goes onto the line of the best wall
 * piece, so a door in a gap between two pieces of one line lands in the gap,
 * on the line. A piece scores its distance from the point across its line,
 * plus half of how far past its ends the point lies, so in a doorway the line
 * the door sits on beats a wall at right angles a little closer to it. Pieces
 * scoring more than `maxDistance` cm are not used. When `preferRotation` is
 * given, the answer turns by 180 degrees if that is closer to it (a door
 * keeps the side it opens to). `onlyWallId` limits the search to one wall.
 * Null when no wall is near.
 */
export function projectOntoWall(
  point: Point,
  items: readonly FixedItem[] | readonly WallSegment[],
  options: { maxDistance?: number; preferRotation?: number; onlyWallId?: string } = {},
): WallProjection | null {
  const segs = isSegmentList(items) ? items : wallSegments(items)
  const maxDistance = options.maxDistance ?? Infinity
  let best: WallSegment | null = null
  let bestScore = Infinity
  for (const s of segs) {
    if (options.onlyWallId !== undefined && s.wallId !== options.onlyWallId) continue
    const len = distance(s.a, s.b)
    const ux = (s.b.x - s.a.x) / len
    const uy = (s.b.y - s.a.y) / len
    const t = (point.x - s.a.x) * ux + (point.y - s.a.y) * uy
    const across = Math.abs(-(point.x - s.a.x) * uy + (point.y - s.a.y) * ux)
    const beyond = t < 0 ? -t : t > len ? t - len : 0
    const score = across + beyond / 2
    if (score < bestScore - 1e-9) {
      best = s
      bestScore = score
    }
  }
  if (!best || bestScore > maxDistance) return null
  const { a, b } = best
  const len = distance(a, b)
  const ux = (b.x - a.x) / len
  const uy = (b.y - a.y) / len
  const t = (point.x - a.x) * ux + (point.y - a.y) * uy
  let rotation = normalizeDegrees(radToDeg(Math.atan2(uy, ux)))
  if (options.preferRotation !== undefined && Number.isFinite(options.preferRotation)) {
    const diff = Math.abs(normalizeDegrees(options.preferRotation - rotation + 180) - 180)
    if (diff > 90) rotation = normalizeDegrees(rotation + 180)
  }
  // Along the whole wall: the pieces before this one, then t.
  let along = t
  for (const s of segs) if (s.wallId === best.wallId && s.index < best.index) along += distance(s.a, s.b)
  return {
    wallId: best.wallId,
    segmentIndex: best.index,
    x: a.x + ux * t,
    y: a.y + uy * t,
    rotation,
    along,
    distance: distance(point, closestPointOnSegment(point, a, b)),
  }
}

function isSegmentList(items: readonly FixedItem[] | readonly WallSegment[]): items is readonly WallSegment[] {
  return items.length > 0 && 'wallId' in items[0]
}

/**
 * The opening in a wall line around a point: when the point sits between the
 * ends of two wall pieces on one straight line (a door drawn as a gap), the
 * gap's two ends, its middle and its width. `lineTol` is how far off the line
 * a piece may be; `maxGap` the widest gap to accept. Null when there is no
 * such gap.
 */
export function wallGapAt(
  point: Point,
  items: readonly FixedItem[] | readonly WallSegment[],
  options: { lineTol?: number; maxGap?: number; minGap?: number } = {},
): { from: Point; to: Point; middle: Point; width: number; rotation: number } | null {
  const segs = isSegmentList(items) ? items : wallSegments(items)
  const lineTol = options.lineTol ?? 5
  const maxGap = options.maxGap ?? 400
  const minGap = options.minGap ?? 30
  let best: { from: Point; to: Point; middle: Point; width: number; rotation: number; off: number } | null = null
  for (const s of segs) {
    // Only pieces that end within a gap's width of the point can bound its gap.
    if (distance(point, closestPointOnSegment(point, s.a, s.b)) > maxGap) continue
    const len = distance(s.a, s.b)
    const ux = (s.b.x - s.a.x) / len
    const uy = (s.b.y - s.a.y) / len
    const off = Math.abs(-(point.x - s.a.x) * uy + (point.y - s.a.y) * ux)
    if (off > lineTol + s.thickness / 2) continue
    const tp = (point.x - s.a.x) * ux + (point.y - s.a.y) * uy
    // The point must lie past one end of this piece, and another piece on the line must start beyond it.
    let leftEnd = -Infinity
    let rightStart = Infinity
    for (const o of segs) {
      const t1 = (o.a.x - s.a.x) * ux + (o.a.y - s.a.y) * uy
      const t2 = (o.b.x - s.a.x) * ux + (o.b.y - s.a.y) * uy
      const n1 = -(o.a.x - s.a.x) * uy + (o.a.y - s.a.y) * ux
      const n2 = -(o.b.x - s.a.x) * uy + (o.b.y - s.a.y) * ux
      if (Math.abs(n1) > lineTol || Math.abs(n2) > lineTol) continue
      const lo = Math.min(t1, t2)
      const hi = Math.max(t1, t2)
      if (lo <= tp && hi >= tp) {
        // A piece runs through the point: no gap here.
        leftEnd = Infinity
        break
      }
      if (hi < tp && hi > leftEnd) leftEnd = hi
      if (lo > tp && lo < rightStart) rightStart = lo
    }
    if (!Number.isFinite(leftEnd) || !Number.isFinite(rightStart)) continue
    const width = rightStart - leftEnd
    if (width < minGap || width > maxGap) continue
    const from = { x: s.a.x + ux * leftEnd, y: s.a.y + uy * leftEnd }
    const to = { x: s.a.x + ux * rightStart, y: s.a.y + uy * rightStart }
    if (!best || off < best.off) {
      best = {
        from,
        to,
        middle: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
        width,
        rotation: normalizeDegrees(radToDeg(Math.atan2(uy, ux))),
        off,
      }
    }
  }
  if (!best) return null
  const { off: _off, ...gap } = best
  void _off
  return gap
}

// ---------------------------------------------------------------- bounds and hit testing

/** Roughly how wide text is: 0.6 em per character, the longest line. */
function textBox(text: string, fontSize: number): { width: number; height: number } {
  const lines = text.split('\n')
  const longest = Math.max(1, ...lines.map((l) => l.length))
  return { width: longest * fontSize * 0.6, height: lines.length * fontSize * 1.2 }
}

/** Half the depth of a window symbol, cm: windows draw thinner than walls. */
const WINDOW_HALF_DEPTH_CM = 10
/** Rooms and zones draw their outline 3 cm wide (VenueLayer). */
const OUTLINE_HALF_CM = 1.5

/**
 * A fixed item's axis-aligned box in cm: fixedItemBox from geometry.ts, plus
 * the text's extent for labels and a depth for windows. Null for an item
 * with nothing to show.
 */
export function fixedItemBounds(item: FixedItem): Box | null {
  if (item.type === 'label') {
    const size = textBox(item.text, item.fontSize)
    const corners = [
      { x: -size.width / 2, y: -size.height / 2 },
      { x: size.width / 2, y: -size.height / 2 },
      { x: size.width / 2, y: size.height / 2 },
      { x: -size.width / 2, y: size.height / 2 },
    ].map((p) => localToCanvas(item, p))
    return boxOfPoints(corners)
  }
  if (item.type === 'window') {
    const half = item.width / 2
    return boxOfPoints(
      [
        { x: -half, y: -WINDOW_HALF_DEPTH_CM },
        { x: half, y: -WINDOW_HALF_DEPTH_CM },
        { x: half, y: WINDOW_HALF_DEPTH_CM },
        { x: -half, y: WINDOW_HALF_DEPTH_CM },
      ].map((p) => localToCanvas(item, p)),
    )
  }
  if (item.type === 'room' || item.type === 'zone' || item.type === 'patioEdge') {
    const b = fixedItemBox(item)
    return b ? expandBox(b, OUTLINE_HALF_CM) : null
  }
  return fixedItemBox(item)
}

function localToCanvas(pose: { x: number; y: number; rotation: number }, p: Point): Point {
  const r = (pose.rotation * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  return { x: pose.x + p.x * cos - p.y * sin, y: pose.y + p.x * sin + p.y * cos }
}

/**
 * True when a canvas point falls on a fixed item, `tolerance` cm included
 * (a few screen pixels divided by the zoom). Walls test their thick line,
 * patio edges their line, rooms and zones their outline or inside, doors the
 * opening and the swing, windows their symbol, round columns their ellipse,
 * other boxes their turned rectangle, labels their text.
 */
export function hitTestFixedItem(item: FixedItem, point: Point, tolerance = 0): boolean {
  switch (item.type) {
    case 'wall':
      return distanceToPolyline(point, item.points) <= item.thickness / 2 + tolerance
    case 'patioEdge':
      return distanceToPolyline(point, item.points) <= OUTLINE_HALF_CM + tolerance
    case 'room':
    case 'zone':
      return pointInPolygon(point, item.points) || distanceToPolyline(point, item.points, true) <= OUTLINE_HALF_CM + tolerance
    case 'door': {
      const local = worldToLocal(item, point)
      const half = item.width / 2
      if (Math.abs(local.x) > half + tolerance) return false
      const depth = item.swing === 'none' ? WINDOW_HALF_DEPTH_CM : item.width
      // The swing opens toward +y; a double door's leaves both do too, half each.
      return local.y >= -WINDOW_HALF_DEPTH_CM - tolerance && local.y <= depth + tolerance
    }
    case 'window': {
      const local = worldToLocal(item, point)
      return Math.abs(local.x) <= item.width / 2 + tolerance && Math.abs(local.y) <= WINDOW_HALF_DEPTH_CM + tolerance
    }
    case 'column': {
      const local = worldToLocal(item, point)
      if (item.shape === 'round') {
        const a = item.width / 2 + tolerance
        const b = item.height / 2 + tolerance
        return (local.x * local.x) / (a * a) + (local.y * local.y) / (b * b) <= 1
      }
      return Math.abs(local.x) <= item.width / 2 + tolerance && Math.abs(local.y) <= item.height / 2 + tolerance
    }
    case 'stairs':
    case 'bar': {
      const local = worldToLocal(item, point)
      return Math.abs(local.x) <= item.width / 2 + tolerance && Math.abs(local.y) <= item.height / 2 + tolerance
    }
    case 'label': {
      const local = worldToLocal(item, point)
      const size = textBox(item.text, item.fontSize)
      return Math.abs(local.x) <= size.width / 2 + tolerance && Math.abs(local.y) <= size.height / 2 + tolerance
    }
  }
}

/**
 * The top fixed item under a point, or null. Later items draw on top and win,
 * but the inside of a room or zone only counts when nothing else is hit, so
 * a column or door inside a room can still be picked.
 */
export function fixedItemAt(items: readonly FixedItem[], point: Point, tolerance = 0): FixedItem | null {
  let areaHit: FixedItem | null = null
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (!hitTestFixedItem(item, point, tolerance)) continue
    if (item.type === 'room' || item.type === 'zone') {
      const onOutline = distanceToPolyline(point, item.points, true) <= OUTLINE_HALF_CM + tolerance
      if (onOutline) return item
      areaHit ??= item
      continue
    }
    return item
  }
  return areaHit
}
