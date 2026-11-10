/**
 * Arrow and line notes (spec section 9; PLAN section 7, "Annotations").
 *
 * An arrow or line note has two ends, `start` and `end`. Each end is either a
 * free point or attached to a table or fixture (`attachedTo.start` and
 * `attachedTo.end` hold the item's id). The stored geometry keeps both ends
 * as `points[0]` and `points[last]`, offsets from the note's center in its
 * own frame (DECISIONS 3), like every other shape with points.
 *
 * An attached end is worked out when the plan is drawn, never stored: it sits
 * where the line towards the other end leaves the item's outline (the chair
 * ring for tables, the turned rectangle for fixtures). So a table that
 * moves, resizes or turns needs no arrow edit, and its arrows follow it. The
 * stored point of an attached end is only a fallback for when the item is
 * missing; when the item is deleted, the end becomes a free point where it
 * was last drawn (detachDeleted, used by delete).
 *
 * Arrows drawn or changed here keep rotation 0, their center halfway between
 * the ends, and a width and height that box the two ends (at least 1 cm, as
 * the schema wants a positive length).
 */
import type { Fixture, Item, Note, Table } from './canvas-schema'
import { boxOfPoints, itemFootprint, localToWorld, worldToLocal, type Box, type Circle, type Footprint, type Obb, type Point } from './geometry'

export type ArrowEnd = 'start' | 'end'
export const ARROW_ENDS: readonly ArrowEnd[] = ['start', 'end']
export const ARROW_NOTE_TYPES = ['arrow', 'line'] as const
export type ArrowNote = Note & { type: (typeof ARROW_NOTE_TYPES)[number] }
/** What an arrow end can attach to. */
export type AttachTarget = Table | Fixture
export type ArrowPoints = { start: Point; end: Point }
/** The smallest width or height an arrow's box gets (a vertical arrow has no width). */
export const ARROW_MIN_BOX_CM = 1

type Items = { readonly items: readonly Item[] }

/** Clears float noise (3 * 30.48 is 91.44000000000001). */
function clean(value: number): number {
  const v = Math.round(value * 1e6) / 1e6
  return v === 0 ? 0 : v
}

function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y
}

export function otherEnd(end: ArrowEnd): ArrowEnd {
  return end === 'start' ? 'end' : 'start'
}

export function isArrowNote(item: Item | null | undefined): item is ArrowNote {
  return item?.kind === 'note' && (item.type === 'arrow' || item.type === 'line')
}

/** Tables and fixtures: what an arrow end can attach to. */
export function isAttachable(item: Item | null | undefined): item is AttachTarget {
  return item?.kind === 'table' || item?.kind === 'fixture'
}

const indexes = new WeakMap<readonly Item[], Map<string, Item>>()

/** Items by id, built once per document version. */
function indexOf(canvas: Items): Map<string, Item> {
  let index = indexes.get(canvas.items)
  if (!index) {
    index = new Map(canvas.items.map((i) => [i.id, i]))
    indexes.set(canvas.items, index)
  }
  return index
}

// ---------------------------------------------------------------- anchors

/** The outline an arrow touches: a table with its chair ring, a fixture's turned rectangle. */
export function anchorOutline(item: Item): Footprint {
  return itemFootprint(item)
}

/** Where a ray from `origin` (inside the circle) along `d` leaves it. */
function exitCircle(c: Circle, origin: Point, d: Point): Point {
  const fx = origin.x - c.x
  const fy = origin.y - c.y
  const a = d.x * d.x + d.y * d.y
  const b = 2 * (fx * d.x + fy * d.y)
  const cc = fx * fx + fy * fy - c.r * c.r
  const disc = b * b - 4 * a * cc
  const s = disc <= 0 ? 0 : Math.max(0, (-b + Math.sqrt(disc)) / (2 * a))
  return { x: origin.x + d.x * s, y: origin.y + d.y * s }
}

/** Where a ray from `origin` (inside the rectangle) towards `towards` leaves it. */
function exitObb(obb: Obb, origin: Point, towards: Point): Point {
  const pose = { x: obb.x, y: obb.y, rotation: obb.rotation }
  const o = worldToLocal(pose, origin)
  const t = worldToLocal(pose, towards)
  const dx = t.x - o.x
  const dy = t.y - o.y
  let s = Infinity
  if (dx > 0) s = Math.min(s, (obb.halfW - o.x) / dx)
  else if (dx < 0) s = Math.min(s, (-obb.halfW - o.x) / dx)
  if (dy > 0) s = Math.min(s, (obb.halfH - o.y) / dy)
  else if (dy < 0) s = Math.min(s, (-obb.halfH - o.y) / dy)
  if (!Number.isFinite(s)) return { x: origin.x, y: origin.y }
  s = Math.max(0, s)
  return localToWorld(pose, { x: o.x + dx * s, y: o.y + dy * s })
}

/**
 * The point on the item's outline where the line from its center towards
 * `towards` leaves it: a circle for round tables, a turned rectangle
 * otherwise, chairs included for tables so the arrow touches the chair ring
 * (only on the sides that have seats). The item's center when `towards` is
 * the center itself.
 */
export function anchorPoint(item: Item, towards: Point): Point {
  const center = { x: item.x, y: item.y }
  const dx = towards.x - center.x
  const dy = towards.y - center.y
  if (Math.hypot(dx, dy) < 1e-9) return center
  const outline = anchorOutline(item)
  return outline.kind === 'circle' ? exitCircle(outline, center, { x: dx, y: dy }) : exitObb(outline, center, towards)
}

/** True when the point is on or inside the outline, `tolerance` cm included. */
export function outlineContains(outline: Footprint, p: Point, tolerance = 0): boolean {
  if (outline.kind === 'circle') return Math.hypot(p.x - outline.x, p.y - outline.y) <= outline.r + tolerance
  const local = worldToLocal({ x: outline.x, y: outline.y, rotation: outline.rotation }, p)
  return Math.abs(local.x) <= outline.halfW + tolerance && Math.abs(local.y) <= outline.halfH + tolerance
}

// ---------------------------------------------------------------- ends

/** The two ends in the note's own frame: the first and last point, or a line across its width. */
function localEnds(note: Note): [Point, Point] {
  const pts = note.points
  if (pts && pts.length >= 2) return [pts[0], pts[pts.length - 1]]
  return [
    { x: -note.width / 2, y: 0 },
    { x: note.width / 2, y: 0 },
  ]
}

/** The ends as stored, on the canvas: where they are drawn when free. */
export function storedEnds(note: Note): ArrowPoints {
  const [a, b] = localEnds(note)
  return { start: localToWorld(note, a), end: localToWorld(note, b) }
}

/** The table or fixture an end is attached to, or null when it is free or the item is gone. */
export function attachedItem(note: Note, end: ArrowEnd, canvas: Items): AttachTarget | null {
  const id = note.attachedTo[end]
  if (id === null || id === note.id) return null
  const item = indexOf(canvas).get(id)
  return isAttachable(item) ? item : null
}

/** The ids an arrow's ends are attached to (present or not). */
export function attachedIds(note: Note): string[] {
  const ids: string[] = []
  if (note.attachedTo.start !== null) ids.push(note.attachedTo.start)
  if (note.attachedTo.end !== null && note.attachedTo.end !== note.attachedTo.start) ids.push(note.attachedTo.end)
  return ids
}

/**
 * The two ends on the canvas, as drawn. A free end is its stored point. An
 * attached end aims at the other end (its free point, or the center of the
 * item it is attached to) and sits where that line leaves its own item.
 * An end attached to an item that is not on the canvas falls back to its
 * stored point.
 */
export function resolveArrow(note: Note, canvas: Items): ArrowPoints {
  const stored = storedEnds(note)
  const a = attachedItem(note, 'start', canvas)
  const b = attachedItem(note, 'end', canvas)
  if (!a && !b) return stored
  const startAim = b ? { x: b.x, y: b.y } : stored.end
  const endAim = a ? { x: a.x, y: a.y } : stored.start
  return {
    start: a ? anchorPoint(a, startAim) : stored.start,
    end: b ? anchorPoint(b, endAim) : stored.end,
  }
}

/** The resolved ends in the note's own frame, for drawing inside its transform. */
export function resolveArrowLocal(note: Note, canvas: Items): ArrowPoints {
  const r = resolveArrow(note, canvas)
  return { start: worldToLocal(note, r.start), end: worldToLocal(note, r.end) }
}

/**
 * The note with its ends at these canvas points: center halfway between
 * them, rotation 0, points as offsets from the center, and a box around
 * them. The same note when nothing changes.
 */
export function withEnds<T extends Note>(note: T, start: Point, end: Point): T {
  const mid = { x: clean((start.x + end.x) / 2), y: clean((start.y + end.y) / 2) }
  const s = { x: clean(start.x - mid.x), y: clean(start.y - mid.y) }
  const e = { x: clean(end.x - mid.x), y: clean(end.y - mid.y) }
  const width = Math.max(ARROW_MIN_BOX_CM, clean(Math.abs(e.x - s.x)))
  const height = Math.max(ARROW_MIN_BOX_CM, clean(Math.abs(e.y - s.y)))
  const pts = note.points
  const same =
    note.x === mid.x &&
    note.y === mid.y &&
    note.rotation === 0 &&
    note.width === width &&
    note.height === height &&
    pts !== undefined &&
    pts.length === 2 &&
    samePoint(pts[0], s) &&
    samePoint(pts[1], e)
  if (same) return note
  return { ...note, x: mid.x, y: mid.y, rotation: 0, width, height, points: [s, e] }
}

const resolvedNotes = new WeakMap<Note, { ends: ArrowPoints; out: Note }>()

/**
 * The arrow with its stored geometry at the ends as drawn (attachments
 * kept), so hit tests, boxes and the selection outline see what is on
 * screen. Any other item, and an arrow with no attached end, comes back
 * as it is. The same object while the drawn ends stay put.
 */
export function withResolvedEnds<T extends Item>(item: T, canvas: Items): T {
  if (!isArrowNote(item) || (item.attachedTo.start === null && item.attachedTo.end === null)) return item
  if (!attachedItem(item, 'start', canvas) && !attachedItem(item, 'end', canvas)) return item
  const ends = resolveArrow(item, canvas)
  const cached = resolvedNotes.get(item)
  if (cached && samePoint(cached.ends.start, ends.start) && samePoint(cached.ends.end, ends.end)) return cached.out as T
  const out = withEnds(item, ends.start, ends.end)
  resolvedNotes.set(item, { ends, out })
  return out as T
}

const resolvedLists = new WeakMap<readonly Item[], readonly Item[]>()

/** Every item, with attached arrows at their drawn ends. Built once per document version. */
export function resolvedItems(canvas: Items): readonly Item[] {
  let list = resolvedLists.get(canvas.items)
  if (!list) {
    let changed = false
    const mapped = canvas.items.map((item) => {
      const r = withResolvedEnds(item, canvas)
      if (r !== item) changed = true
      return r
    })
    list = changed ? mapped : canvas.items
    resolvedLists.set(canvas.items, list)
  }
  return list
}

/** The box around the arrow's ends as drawn. */
export function arrowBox(note: Note, canvas: Items): Box {
  const r = resolveArrow(note, canvas)
  return boxOfPoints([r.start, r.end]) as Box
}

// ---------------------------------------------------------------- attaching and letting go

/**
 * The note with the ends attached to items that `release` picks set free,
 * each where it is drawn now on `canvas`. The same note when no end lets go.
 */
export function releaseEnds(note: Note, canvas: Items, release: (id: string) => boolean): Note {
  const { start, end } = note.attachedTo
  const freeStart = start !== null && release(start)
  const freeEnd = end !== null && release(end)
  if (!freeStart && !freeEnd) return note
  const attachedTo = { start: freeStart ? null : start, end: freeEnd ? null : end }
  if (!isArrowNote(note)) return { ...note, attachedTo }
  const r = resolveArrow(note, canvas)
  return withEnds({ ...note, attachedTo }, r.start, r.end)
}

/**
 * Delete's cleanup: arrows attached to an item in `removed` let go of it,
 * the end staying as a free point where it was last drawn. Run it on the
 * canvas before the items are taken out. The same canvas when no arrow
 * pointed at them.
 */
export function detachDeleted<T extends Items>(canvas: T, removed: ReadonlySet<string>): T {
  if (removed.size === 0) return canvas
  let changed = false
  const items = canvas.items.map((item) => {
    if (item.kind !== 'note' || removed.has(item.id)) return item
    const next = releaseEnds(item, canvas, (id) => removed.has(id))
    if (next !== item) changed = true
    return next
  })
  return changed ? { ...canvas, items } : canvas
}

/**
 * For copies: arrows among `items` let go of every item not copied with
 * them, each end staying where it is drawn now on `canvas`. Arrows whose
 * items come along stay attached (the copy then follows the copied item).
 */
export function detachOutside(items: readonly Item[], canvas: Items): Item[] {
  const keep = new Set(items.map((i) => i.id))
  return items.map((item) => (item.kind === 'note' ? releaseEnds(item, canvas, (id) => !keep.has(id)) : item))
}

/**
 * The arrow with one end moved: attached to `attachTo` when that is a table
 * or fixture on the canvas (and not what the other end holds), otherwise a
 * free point at `at`. Its geometry then follows the ends as drawn.
 */
export function placeArrowEnd<T extends Note>(note: T, end: ArrowEnd, at: Point, attachTo: string | null, canvas: Items): T {
  const target = attachTo === null ? undefined : indexOf(canvas).get(attachTo)
  const other = note.attachedTo[otherEnd(end)]
  const ok = isAttachable(target) && target.id !== note.id && target.id !== other
  const attachedTo = { ...note.attachedTo, [end]: ok ? target.id : null }
  // The free point first, so the other end (if attached) aims at it.
  const stored = storedEnds(note)
  const placed = { ...stored, [end]: { x: at.x, y: at.y } }
  const moved = withEnds({ ...note, attachedTo }, placed.start, placed.end)
  const r = resolveArrow(moved, canvas)
  return withEnds(moved, r.start, r.end)
}

/**
 * The topmost table or fixture whose outline (chairs included) holds the
 * point, `tolerance` cm included, among the items `accept` lets through.
 */
export function attachTargetAt(
  canvas: Items,
  point: Point,
  tolerance = 0,
  accept: (item: AttachTarget) => boolean = () => true,
): AttachTarget | null {
  const items = canvas.items
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (!isAttachable(item) || !accept(item)) continue
    if (outlineContains(anchorOutline(item), point, tolerance)) return item
  }
  return null
}

/** Arrows with an end on any of these items. */
export function arrowsAttachedTo(canvas: Items, ids: ReadonlySet<string>): ArrowNote[] {
  return canvas.items.filter(
    (i): i is ArrowNote =>
      isArrowNote(i) && ((i.attachedTo.start !== null && ids.has(i.attachedTo.start)) || (i.attachedTo.end !== null && ids.has(i.attachedTo.end))),
  )
}
