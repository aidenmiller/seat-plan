/**
 * Plane geometry for the canvas (DECISIONS 1 and 3). One unit is one
 * centimeter and y points down. An item's x and y are its center; its
 * rotation is in degrees, clockwise on screen, about that center. Shape and
 * note `points` are offsets in cm from the center, in the item's unrotated
 * frame, so they turn with it.
 *
 * Two outlines per item:
 *  - the body: the table top, the fixture, the shape's box. The space check
 *    measures between table bodies (spec: "gaps between table edges"), and
 *    grid snapping lines bodies up, so standard sizes land on the grid;
 *  - the footprint: the body plus a table's chair ring (8 cm gap and a 45 cm
 *    seat on every side that has seats), so hit tests, guides, alignment and
 *    fit to content see what really stands on the floor.
 */
import type { Canvas, Item, Table } from './canvas-schema'
import { CHAIR_DEPTH_CM, SEAT_DIAMETER_CM, sideSeatCounts } from './seats'
import type { FixedItem } from './venue-schema'

export type Point = { x: number; y: number }
/** An axis-aligned box. */
export type Box = { minX: number; minY: number; maxX: number; maxY: number }
/** Where an item sits: its center and its rotation. */
export type Pose = { x: number; y: number; rotation: number }
export type Circle = { kind: 'circle'; x: number; y: number; r: number }
/** A rotated rectangle: center, half sizes in its own frame, rotation in degrees clockwise. */
export type Obb = { kind: 'obb'; x: number; y: number; halfW: number; halfH: number; rotation: number }
export type Footprint = Circle | Obb

export const ORIGIN: Point = Object.freeze({ x: 0, y: 0 })

export function degToRad(degrees: number): number {
  return (degrees * Math.PI) / 180
}

export function radToDeg(radians: number): number {
  return (radians * 180) / Math.PI
}

/** Degrees in [0, 360). */
export function normalizeDegrees(degrees: number): number {
  const d = degrees % 360
  const r = d < 0 ? d + 360 : d
  return Math.abs(r - 360) < 1e-9 || Math.abs(r) < 1e-9 ? 0 : r
}

/** Turns a point about `center` by `degrees`, clockwise on screen (y down). */
export function rotatePoint(p: Point, degrees: number, center: Point = ORIGIN): Point {
  if (degrees === 0) return { x: p.x, y: p.y }
  const r = degToRad(degrees)
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  const dx = p.x - center.x
  const dy = p.y - center.y
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos }
}

/** A point in an item's own frame (offset from its center, before rotation) to the canvas. */
export function localToWorld(pose: Pose, p: Point): Point {
  const r = rotatePoint(p, pose.rotation)
  return { x: pose.x + r.x, y: pose.y + r.y }
}

/** A canvas point to the item's own frame. */
export function worldToLocal(pose: Pose, p: Point): Point {
  return rotatePoint({ x: p.x - pose.x, y: p.y - pose.y }, -pose.rotation)
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

// ---------------------------------------------------------------- boxes

export function boxOfPoints(points: readonly Point[]): Box | null {
  if (points.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY }
}

export function unionBoxes(boxes: readonly (Box | null | undefined)[]): Box | null {
  let out: Box | null = null
  for (const b of boxes) {
    if (!b) continue
    out = out
      ? { minX: Math.min(out.minX, b.minX), minY: Math.min(out.minY, b.minY), maxX: Math.max(out.maxX, b.maxX), maxY: Math.max(out.maxY, b.maxY) }
      : { ...b }
  }
  return out
}

export function boxCenter(b: Box): Point {
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }
}

export function boxWidth(b: Box): number {
  return b.maxX - b.minX
}

export function boxHeight(b: Box): number {
  return b.maxY - b.minY
}

export function translateBox(b: Box, dx: number, dy: number): Box {
  return { minX: b.minX + dx, minY: b.minY + dy, maxX: b.maxX + dx, maxY: b.maxY + dy }
}

export function expandBox(b: Box, by: number): Box {
  return { minX: b.minX - by, minY: b.minY - by, maxX: b.maxX + by, maxY: b.maxY + by }
}

/** True when the boxes share any point, edges included. */
export function boxesIntersect(a: Box, b: Box): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY
}

/** True when `inner` lies wholly inside `outer`, edges included. */
export function boxContains(outer: Box, inner: Box): boolean {
  return inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minY >= outer.minY && inner.maxY <= outer.maxY
}

export function boxContainsPoint(b: Box, p: Point): boolean {
  return p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY
}

/** The gap between two boxes, 0 when they touch or overlap. Never more than the true gap between what they hold. */
export function boxDistance(a: Box, b: Box): number {
  const dx = Math.max(0, a.minX - b.maxX, b.minX - a.maxX)
  const dy = Math.max(0, a.minY - b.maxY, b.minY - a.maxY)
  return Math.hypot(dx, dy)
}

/** A box from two corners in any order, for a selection box dragged in any direction. */
export function boxFromCorners(a: Point, b: Point): Box {
  return { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) }
}

// ---------------------------------------------------------------- rotated rectangles and circles

export function obbCorners(obb: Obb): Point[] {
  const pose = { x: obb.x, y: obb.y, rotation: obb.rotation }
  return [
    localToWorld(pose, { x: -obb.halfW, y: -obb.halfH }),
    localToWorld(pose, { x: obb.halfW, y: -obb.halfH }),
    localToWorld(pose, { x: obb.halfW, y: obb.halfH }),
    localToWorld(pose, { x: -obb.halfW, y: obb.halfH }),
  ]
}

export function obbBox(obb: Obb): Box {
  return boxOfPoints(obbCorners(obb)) as Box
}

export function circleBox(c: Circle): Box {
  return { minX: c.x - c.r, minY: c.y - c.r, maxX: c.x + c.r, maxY: c.y + c.r }
}

export function footprintShapeBox(f: Footprint): Box {
  return f.kind === 'circle' ? circleBox(f) : obbBox(f)
}

/** A rotated rectangle from an item's pose and a box in its own frame. */
function obbFromLocal(pose: Pose, local: Box): Obb {
  const c = localToWorld(pose, boxCenter(local))
  return { kind: 'obb', x: c.x, y: c.y, halfW: boxWidth(local) / 2, halfH: boxHeight(local) / 2, rotation: pose.rotation }
}

// ---------------------------------------------------------------- items

/** A chair row's length: from the first chair's outer edge to the last's. */
export function chairRowLength(item: { chairCount: number; spacing: number }): number {
  return Math.max(0, item.chairCount - 1) * item.spacing + SEAT_DIAMETER_CM
}

/** The item's width and height in its own frame. */
export function itemSize(item: Item): { width: number; height: number } {
  if (item.kind === 'chairRow') return { width: chairRowLength(item), height: SEAT_DIAMETER_CM }
  return { width: item.width, height: item.height }
}

/**
 * The body in the item's own frame. Items with points cover their box and
 * every point, so a point dragged past the box still counts.
 */
export function itemLocalBounds(item: Item): Box {
  const { width, height } = itemSize(item)
  const box: Box = { minX: -width / 2, minY: -height / 2, maxX: width / 2, maxY: height / 2 }
  if ((item.kind === 'shape' || item.kind === 'note') && item.points && item.points.length > 0) {
    return unionBoxes([box, boxOfPoints(item.points)]) as Box
  }
  return box
}

/** The body as a rotated rectangle on the canvas. */
export function itemObb(item: Item): Obb {
  return obbFromLocal(item, itemLocalBounds(item))
}

/** The body's four corners on the canvas: top left, top right, bottom right, bottom left in the item's frame. */
export function itemCorners(item: Item): Point[] {
  return obbCorners(itemObb(item))
}

/** The body's axis-aligned box. Round tables give their circle's box. */
export function itemBox(item: Item): Box {
  if (item.kind === 'table' && item.shape === 'round') return circleBox({ kind: 'circle', x: item.x, y: item.y, r: item.width / 2 })
  if ((item.kind === 'shape' || item.kind === 'note') && item.points && item.points.length > 0 && isOpenPath(item)) {
    return expandBox(boxOfPoints(item.points.map((p) => localToWorld(item, p))) as Box, pathHalfWidth(item))
  }
  return obbBox(itemObb(item))
}

/** Half the drawn thickness of a line, wall or arrow. */
function pathHalfWidth(item: Item): number {
  if (item.kind !== 'shape') return 0
  return Math.max(item.style.strokeWidth, item.type === 'wall' ? item.height : 0) / 2
}

/** Lines, walls and arrows: their points are the item. */
function isOpenPath(item: Item): boolean {
  if (item.kind === 'shape') return item.type === 'line' || item.type === 'wall'
  if (item.kind === 'note') return item.type === 'arrow' || item.type === 'line'
  return false
}

/** A table's outline with its chairs: the chair ring on every side that has seats. */
function tableFootprint(table: Table): Footprint {
  if (table.shape === 'round') {
    return { kind: 'circle', x: table.x, y: table.y, r: table.width / 2 + (table.seatCount > 0 ? CHAIR_DEPTH_CM : 0) }
  }
  const c = sideSeatCounts(table)
  const local: Box = {
    minX: -table.width / 2 - (c.left > 0 ? CHAIR_DEPTH_CM : 0),
    minY: -table.height / 2 - (c.top > 0 ? CHAIR_DEPTH_CM : 0),
    maxX: table.width / 2 + (c.right > 0 ? CHAIR_DEPTH_CM : 0),
    maxY: table.height / 2 + (c.bottom > 0 ? CHAIR_DEPTH_CM : 0),
  }
  return obbFromLocal(table, local)
}

/** What the item takes up on the floor: tables with their chairs, everything else its body. */
export function itemFootprint(item: Item): Footprint {
  if (item.kind === 'table') return tableFootprint(item)
  return itemObb(item)
}

/** A table's top alone, no chairs: a circle for round tables, the turned rectangle for square and rect ones. */
export function tableBodyFootprint(table: Table): Footprint {
  if (table.shape === 'round') return { kind: 'circle', x: table.x, y: table.y, r: table.width / 2 }
  return itemObb(table)
}

/** The item's body as a footprint shape: a table's top (no chairs), everything else its turned rectangle. */
export function itemBodyFootprint(item: Item): Footprint {
  if (item.kind === 'table') return tableBodyFootprint(item)
  return itemObb(item)
}

/** The footprint's axis-aligned box. Lines and walls give the box of their points. */
export function footprintBox(item: Item): Box {
  if (item.kind === 'table') return footprintShapeBox(tableFootprint(item))
  return itemBox(item)
}

/** The box around every item's footprint, or null for an empty canvas. */
export function contentBox(canvas: Pick<Canvas, 'items'>): Box | null {
  return unionBoxes(canvas.items.map(footprintBox))
}

export function itemsBox(items: readonly Item[], boxOf: (item: Item) => Box = footprintBox): Box | null {
  return unionBoxes(items.map(boxOf))
}

/**
 * A venue template's fixed item's box: walls with their thickness, outlines
 * by their points, doors and windows along their width, boxes turned with
 * them, and a label's point. Null for an item with nothing to show.
 */
export function fixedItemBox(f: FixedItem): Box | null {
  switch (f.type) {
    case 'wall': {
      const b = boxOfPoints(f.points)
      return b ? expandBox(b, f.thickness / 2) : null
    }
    case 'room':
    case 'zone':
    case 'patioEdge':
      return boxOfPoints(f.points)
    case 'door':
    case 'window': {
      const half = f.width / 2
      // A door's swing reaches its width into the room on either side.
      const depth = f.type === 'door' && f.swing !== 'none' ? f.width : 0
      return boxOfPoints(
        [
          { x: -half, y: -depth },
          { x: half, y: -depth },
          { x: half, y: depth },
          { x: -half, y: depth },
        ].map((p) => localToWorld(f, p)),
      )
    }
    case 'column':
    case 'stairs':
    case 'bar':
      return obbBox({ kind: 'obb', x: f.x, y: f.y, halfW: f.width / 2, halfH: f.height / 2, rotation: f.rotation })
    case 'label':
      return { minX: f.x, minY: f.y, maxX: f.x, maxY: f.y }
  }
}

/** The box around a venue template's fixed items, or null when there are none. */
export function venueBox(fixedItems: readonly FixedItem[]): Box | null {
  return unionBoxes(fixedItems.map(fixedItemBox))
}

// ---------------------------------------------------------------- segments and polygons

export function closestPointOnSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return { x: a.x, y: a.y }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return { x: a.x + t * dx, y: a.y + t * dy }
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  return distance(p, closestPointOnSegment(p, a, b))
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
}

function onSegment(p: Point, a: Point, b: Point, eps: number): boolean {
  return (
    p.x >= Math.min(a.x, b.x) - eps && p.x <= Math.max(a.x, b.x) + eps && p.y >= Math.min(a.y, b.y) - eps && p.y <= Math.max(a.y, b.y) + eps
  )
}

/** True when segments a1-a2 and b1-b2 share a point, touching and overlapping included. */
export function segmentsIntersect(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const scale = Math.max(1, Math.abs(a1.x), Math.abs(a1.y), Math.abs(a2.x), Math.abs(a2.y), Math.abs(b1.x), Math.abs(b1.y), Math.abs(b2.x), Math.abs(b2.y))
  const eps = 1e-9 * scale * scale
  const d1 = cross(b1, b2, a1)
  const d2 = cross(b1, b2, a2)
  const d3 = cross(a1, a2, b1)
  const d4 = cross(a1, a2, b2)
  if (((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))) return true
  const lin = 1e-9 * scale
  if (Math.abs(d1) <= eps && onSegment(a1, b1, b2, lin)) return true
  if (Math.abs(d2) <= eps && onSegment(a2, b1, b2, lin)) return true
  if (Math.abs(d3) <= eps && onSegment(b1, a1, a2, lin)) return true
  if (Math.abs(d4) <= eps && onSegment(b2, a1, a2, lin)) return true
  return false
}

/**
 * Where segments a1-a2 and b1-b2 cross, or null when they do not meet.
 * Overlapping collinear segments give the first shared point along a1-a2.
 */
export function segmentIntersection(a1: Point, a2: Point, b1: Point, b2: Point): Point | null {
  if (!segmentsIntersect(a1, a2, b1, b2)) return null
  const rx = a2.x - a1.x
  const ry = a2.y - a1.y
  const sx = b2.x - b1.x
  const sy = b2.y - b1.y
  const denom = rx * sy - ry * sx
  if (Math.abs(denom) > 1e-12 * Math.max(1, Math.hypot(rx, ry) * Math.hypot(sx, sy))) {
    const t = ((b1.x - a1.x) * sy - (b1.y - a1.y) * sx) / denom
    const tc = Math.max(0, Math.min(1, t))
    return { x: a1.x + tc * rx, y: a1.y + tc * ry }
  }
  // Parallel and touching: the shared point nearest a1.
  const candidates = [a1, a2, b1, b2].filter((p) => onSegment(p, a1, a2, 1e-9) && onSegment(p, b1, b2, 1e-9))
  candidates.sort((p, q) => distance(p, a1) - distance(q, a1))
  return candidates[0] ? { x: candidates[0].x, y: candidates[0].y } : null
}

/** Even-odd test; points on the outline may go either way. */
export function pointInPolygon(p: Point, polygon: readonly Point[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** Distance from a point to a polyline (closed adds the last-to-first segment). Infinity with no points. */
export function distanceToPolyline(p: Point, points: readonly Point[], closed = false): number {
  if (points.length === 0) return Infinity
  if (points.length === 1) return distance(p, points[0])
  let best = Infinity
  const n = points.length
  const segments = closed ? n : n - 1
  for (let i = 0; i < segments; i++) best = Math.min(best, distanceToSegment(p, points[i], points[(i + 1) % n]))
  return best
}

// ---------------------------------------------------------------- hit testing

function noFill(fill: string): boolean {
  const f = fill.trim().toLowerCase()
  return f === '' || f === 'none' || f === 'transparent'
}

function insideLocalBox(p: Point, b: Box, tolerance: number): boolean {
  return p.x >= b.minX - tolerance && p.x <= b.maxX + tolerance && p.y >= b.minY - tolerance && p.y <= b.maxY + tolerance
}

function insideEllipse(p: Point, b: Box, tolerance: number): boolean {
  const c = boxCenter(b)
  const a = boxWidth(b) / 2 + tolerance
  const bb = boxHeight(b) / 2 + tolerance
  if (a <= 0 || bb <= 0) return false
  const dx = (p.x - c.x) / a
  const dy = (p.y - c.y) / bb
  return dx * dx + dy * dy <= 1
}

/** Local points of an open path: its points, or a line across the middle of its box. */
function pathPoints(item: Item): Point[] {
  if ((item.kind === 'shape' || item.kind === 'note') && item.points && item.points.length > 0) return item.points
  const { width } = itemSize(item)
  return [
    { x: -width / 2, y: 0 },
    { x: width / 2, y: 0 },
  ]
}

/**
 * True when a canvas point falls on the item's body, `tolerance` cm included
 * (pass a few screen pixels divided by the zoom). Round tables test their
 * circle, ellipses and circle notes their ellipse, lines, walls and arrows
 * their path (as thick as the wall or stroke), rooms their outline (and
 * inside, when filled), and everything else its rotated rectangle. Seats are
 * not part of a table's body; see seatIndexAt in seats.ts.
 */
export function hitTestItem(item: Item, point: Point, tolerance = 0): boolean {
  if (item.kind === 'table' && item.shape === 'round') {
    return distance(point, item) <= item.width / 2 + tolerance
  }
  const local = worldToLocal(item, point)
  const bounds = itemLocalBounds(item)
  if (item.kind === 'shape') {
    switch (item.type) {
      case 'ellipse':
        return insideEllipse(local, bounds, tolerance)
      case 'line':
      case 'wall':
        return distanceToPolyline(local, pathPoints(item)) <= pathHalfWidth(item) + tolerance
      case 'room': {
        const outline =
          item.points && item.points.length >= 3
            ? item.points
            : [
                { x: bounds.minX, y: bounds.minY },
                { x: bounds.maxX, y: bounds.minY },
                { x: bounds.maxX, y: bounds.maxY },
                { x: bounds.minX, y: bounds.maxY },
              ]
        if (!noFill(item.style.fill) && pointInPolygon(local, outline)) return true
        return distanceToPolyline(local, outline, true) <= item.style.strokeWidth / 2 + tolerance
      }
      default:
        return insideLocalBox(local, bounds, tolerance)
    }
  }
  if (item.kind === 'note') {
    if (item.type === 'circle') return insideEllipse(local, bounds, tolerance)
    if (item.type === 'arrow' || item.type === 'line') return distanceToPolyline(local, pathPoints(item)) <= tolerance
  }
  return insideLocalBox(local, bounds, tolerance)
}

/** True when the selection box holds the item's whole body. */
export function boxSelects(selection: Box, item: Item): boolean {
  return boxContains(selection, itemBox(item))
}
