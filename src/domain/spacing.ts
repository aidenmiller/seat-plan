/**
 * The space check (spec section 4, "Space check"; PLAN section 6, "Snapping
 * and guides"; DECISIONS 14).
 *
 * Gaps are the true distance between table edges (spec: "Flag gaps under
 * 5 ft between table edges"): circles and rotated rectangles for the table
 * tops, chairs not counted, so two 60 in rounds 5 ft apart edge to edge read
 * 5′ 0″ and do not warn. Only tables count as neighbors; a dragged fixture
 * measures from its body. A gap of 0 or less means the tops touch or
 * overlap; below 0 it is how far they overlap.
 */
import type { Canvas, Item, Table } from './canvas-schema'
import {
  boxDistance,
  closestPointOnSegment,
  distance,
  footprintShapeBox,
  itemBodyFootprint,
  localToWorld,
  obbCorners,
  worldToLocal,
  type Circle,
  type Footprint,
  type Obb,
  type Point,
} from './geometry'
import { formatLength, type LengthUnit } from './units'

/** The default narrowest gap between table edges, 5 ft (spec; weddings.min_gap_cm). */
export const DEFAULT_MIN_GAP_CM = 152.4
/** Float noise allowed before a gap counts as under the minimum (304.8 - 76.2 - 76.2 is not quite 152.4). */
export const GAP_EPSILON_CM = 1e-6

/** True when a gap is under the minimum: a warning in the readout and a row in the Problems tab. */
export function isNarrowGap(gapCm: number, minGapCm: number): boolean {
  return gapCm < minGapCm - GAP_EPSILON_CM
}

export type Gap = {
  gapCm: number
  /** The closest points, on the first footprint and on the second. Overlapping footprints give their centers. */
  from: Point
  to: Point
}

function circleCircle(a: Circle, b: Circle): Gap {
  const d = distance(a, b)
  const ux = d > 0 ? (b.x - a.x) / d : 1
  const uy = d > 0 ? (b.y - a.y) / d : 0
  const gapCm = d - a.r - b.r
  if (gapCm <= 0) return { gapCm, from: { x: a.x, y: a.y }, to: { x: b.x, y: b.y } }
  return { gapCm, from: { x: a.x + ux * a.r, y: a.y + uy * a.r }, to: { x: b.x - ux * b.r, y: b.y - uy * b.r } }
}

function circleObb(c: Circle, o: Obb): Gap {
  const pose = { x: o.x, y: o.y, rotation: o.rotation }
  const local = worldToLocal(pose, c)
  const q = { x: Math.max(-o.halfW, Math.min(o.halfW, local.x)), y: Math.max(-o.halfH, Math.min(o.halfH, local.y)) }
  const d = distance(local, q)
  if (d > 0) {
    const gapCm = d - c.r
    if (gapCm <= 0) return { gapCm, from: { x: c.x, y: c.y }, to: { x: o.x, y: o.y } }
    const to = localToWorld(pose, q)
    return { gapCm, from: { x: c.x + ((to.x - c.x) / d) * c.r, y: c.y + ((to.y - c.y) / d) * c.r }, to }
  }
  // The circle's center is inside the rectangle.
  const depth = Math.min(o.halfW - Math.abs(local.x), o.halfH - Math.abs(local.y))
  return { gapCm: -(depth + c.r), from: { x: c.x, y: c.y }, to: { x: o.x, y: o.y } }
}

function axesOf(o: Obb): Point[] {
  const r = (o.rotation * Math.PI) / 180
  return [
    { x: Math.cos(r), y: Math.sin(r) },
    { x: -Math.sin(r), y: Math.cos(r) },
  ]
}

function project(points: readonly Point[], axis: Point): [number, number] {
  let min = Infinity
  let max = -Infinity
  for (const p of points) {
    const v = p.x * axis.x + p.y * axis.y
    if (v < min) min = v
    if (v > max) max = v
  }
  return [min, max]
}

function obbObb(a: Obb, b: Obb): Gap {
  const ca = obbCorners(a)
  const cb = obbCorners(b)
  // Separating axes: if the shadows overlap on all four, the boxes overlap,
  // by the smallest of those overlaps.
  let overlap = Infinity
  for (const axis of [...axesOf(a), ...axesOf(b)]) {
    const [minA, maxA] = project(ca, axis)
    const [minB, maxB] = project(cb, axis)
    overlap = Math.min(overlap, Math.min(maxA, maxB) - Math.max(minA, minB))
  }
  if (overlap >= 0) return { gapCm: -overlap, from: { x: a.x, y: a.y }, to: { x: b.x, y: b.y } }

  // Apart: the closest pair is a corner of one and a point on an edge of the other.
  let best: Gap = { gapCm: Infinity, from: ca[0], to: cb[0] }
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const qb = closestPointOnSegment(ca[i], cb[j], cb[(j + 1) % 4])
      const db = distance(ca[i], qb)
      if (db < best.gapCm) best = { gapCm: db, from: ca[i], to: qb }
      const qa = closestPointOnSegment(cb[i], ca[j], ca[(j + 1) % 4])
      const da = distance(cb[i], qa)
      if (da < best.gapCm) best = { gapCm: da, from: qa, to: cb[i] }
    }
  }
  return best
}

/** The gap between two footprints, with the closest points for drawing the readout. */
export function footprintGap(a: Footprint, b: Footprint): Gap {
  if (a.kind === 'circle' && b.kind === 'circle') return circleCircle(a, b)
  if (a.kind === 'circle' && b.kind === 'obb') return circleObb(a, b)
  if (a.kind === 'obb' && b.kind === 'circle') {
    const g = circleObb(b, a)
    return { gapCm: g.gapCm, from: g.to, to: g.from }
  }
  return obbObb(a as Obb, b as Obb)
}

/** The gap between two items' edges (table tops, chairs not counted) with the closest points. */
export function gapDetails(a: Item, b: Item): Gap {
  return footprintGap(itemBodyFootprint(a), itemBodyFootprint(b))
}

/** The true distance between two items' edges (table tops, chairs not counted), in cm. 0 or less means they touch or overlap. */
export function gapBetween(a: Item, b: Item): number {
  return gapDetails(a, b).gapCm
}

export type NearestGap = Gap & { otherId: string }

/**
 * The nearest of `tables` to `item` (itself left out) and the gap between
 * their edges, for the readout while dragging. Null when there is no other table.
 */
export function nearestGapAmong(item: Item, tables: readonly Table[]): NearestGap | null {
  const mine = itemBodyFootprint(item)
  const myBox = footprintShapeBox(mine)
  let best: NearestGap | null = null
  for (const other of tables) {
    if (other.id === item.id) continue
    const theirs = itemBodyFootprint(other)
    // A box gap is never more than the true gap, so a box farther than the best cannot win.
    if (best && boxDistance(myBox, footprintShapeBox(theirs)) >= best.gapCm) continue
    const g = footprintGap(mine, theirs)
    if (!best || g.gapCm < best.gapCm) best = { ...g, otherId: other.id }
  }
  return best
}

/**
 * The nearest table to an item and the gap to it, for the readout while
 * dragging. Null when the item is missing or there is no other table.
 */
export function nearestTableGap(canvas: Pick<Canvas, 'items'>, itemId: string): NearestGap | null {
  const item = canvas.items.find((i) => i.id === itemId)
  if (!item) return null
  return nearestGapAmong(
    item,
    canvas.items.filter((i): i is Table => i.kind === 'table'),
  )
}

export type NarrowGap = Gap & { aId: string; bId: string; overlapping: boolean }

/** Every pair of tables closer than `minGapCm` edge to edge (overlapping ones included), narrowest first, for the Problems tab. */
export function narrowGaps(canvas: Pick<Canvas, 'items'>, minGapCm: number = DEFAULT_MIN_GAP_CM): NarrowGap[] {
  const tables = canvas.items.filter((i): i is Table => i.kind === 'table')
  const shapes = tables.map(itemBodyFootprint)
  const boxes = shapes.map(footprintShapeBox)
  const out: NarrowGap[] = []
  for (let i = 0; i < tables.length; i++) {
    for (let j = i + 1; j < tables.length; j++) {
      if (boxDistance(boxes[i], boxes[j]) >= minGapCm) continue
      const g = footprintGap(shapes[i], shapes[j])
      if (isNarrowGap(g.gapCm, minGapCm)) out.push({ ...g, aId: tables[i].id, bId: tables[j].id, overlapping: g.gapCm <= 0 })
    }
  }
  return out.sort((a, b) => a.gapCm - b.gapCm || a.aId.localeCompare(b.aId) || a.bId.localeCompare(b.bId))
}

/** The readout text: the gap in the wedding's unit, or "Overlapping". */
export function gapText(gapCm: number, unit: LengthUnit): string {
  return gapCm <= 0 ? 'Overlapping' : formatLength(gapCm, unit)
}
