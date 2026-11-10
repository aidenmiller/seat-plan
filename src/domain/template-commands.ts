/**
 * The venue template editor's document and its commands (spec section 5,
 * "Venue templates"; PLAN section 7). Pure: each command takes the document
 * and returns a new one, or the same object when nothing changed, so the
 * editor's undo history (doc-store.ts) can skip no-op edits.
 *
 * The document is the template's fixed items plus where the reference image
 * sits (its opacity is saved with the template). Points of walls, rooms,
 * zones and patio edges are absolute canvas cm; doors, windows, columns,
 * stairs, bars and labels have a center and a rotation (fixed-items.ts).
 *
 * Doors and windows sit on walls: they snap onto the nearest wall when placed
 * or moved (projectOntoWall), they move with their wall, and they follow it
 * when its points change.
 */
import type { Shape } from './canvas-schema'
import { fixedItemBounds, isClosedOutline, polylineSegment, projectOntoWall, segmentCount, setSegmentLength, wallSegments } from './fixed-items'
import { boxContains, boxFromCorners, distance, distanceToSegment, normalizeDegrees, type Box, type Point } from './geometry'
import { resizeByHandle, rotateByHandle, type Handle } from './resize'
import { fixedItemSchema, type FixedItem, type ReferenceMeta } from './venue-schema'

export type TemplateDoc = { items: FixedItem[]; reference: ReferenceMeta | null }

export type PolyItem = Extract<FixedItem, { type: 'wall' | 'room' | 'zone' | 'patioEdge' }>
export type BoxItem = Extract<FixedItem, { type: 'column' | 'stairs' | 'bar' }>
export type OpeningItem = Extract<FixedItem, { type: 'door' | 'window' }>

/** The kinds of fixed item the template editor can draw, with columns split by shape. */
export type DrawKind = 'wall' | 'room' | 'zone' | 'patioEdge' | 'door' | 'window' | 'column' | 'roundColumn' | 'stairs' | 'bar' | 'label'

export const DEFAULT_WALL_THICKNESS_CM = 15
export const DEFAULT_DOOR_WIDTH_CM = 91.44
export const DEFAULT_WINDOW_WIDTH_CM = 121.92
export const DEFAULT_COLUMN_CM = 45.72
export const DEFAULT_STAIRS = { width: 121.92, height: 304.8 }
export const DEFAULT_BAR = { width: 243.84, height: 76.2 }
export const DEFAULT_LABEL_SIZE_CM = 45
/** Doors and windows dropped this close to a wall (cm) go onto it. */
export const OPENING_SNAP_CM = 120
/** The smallest rectangle a drag draws, cm a side. */
export const MIN_DRAWN_CM = 10

export function emptyTemplateDoc(): TemplateDoc {
  return { items: [], reference: null }
}

export function isPolyItem(item: FixedItem): item is PolyItem {
  return item.type === 'wall' || item.type === 'room' || item.type === 'zone' || item.type === 'patioEdge'
}

export function isBoxItem(item: FixedItem): item is BoxItem {
  return item.type === 'column' || item.type === 'stairs' || item.type === 'bar'
}

export function isOpening(item: FixedItem): item is OpeningItem {
  return item.type === 'door' || item.type === 'window'
}

/** Rooms and zones need 3 points, walls and patio edges 2. */
export function minPoints(kind: PolyItem['type']): number {
  return kind === 'room' || kind === 'zone' ? 3 : 2
}

/** Draw tools that drag a rectangle (rooms and zones may also click points). */
export function drawsRectangle(kind: DrawKind): boolean {
  return kind === 'room' || kind === 'zone' || kind === 'column' || kind === 'roundColumn' || kind === 'stairs' || kind === 'bar'
}

/** Draw tools that click points: walls, patio edges, and rooms and zones as an outline. */
export function drawsPoints(kind: DrawKind): kind is 'wall' | 'room' | 'zone' | 'patioEdge' {
  return kind === 'wall' || kind === 'room' || kind === 'zone' || kind === 'patioEdge'
}

/** A plain name for a fixed item, for lists and panels. */
export function fixedItemLabel(item: FixedItem): string {
  const name = item.name?.trim()
  const kind = FIXED_KIND_LABEL[item.type === 'column' && item.shape === 'round' ? 'roundColumn' : item.type]
  if (item.type === 'label') return item.text.trim() ? `Label: ${item.text.trim()}` : kind
  if (item.type === 'bar' && !name && item.label.trim()) return `${kind}: ${item.label.trim()}`
  return name ? `${kind}: ${name}` : kind
}

export const FIXED_KIND_LABEL: Record<DrawKind, string> = {
  wall: 'Wall',
  room: 'Room',
  zone: 'Zone',
  patioEdge: 'Patio edge',
  door: 'Door',
  window: 'Window',
  column: 'Column',
  roundColumn: 'Round column',
  stairs: 'Stairs',
  bar: 'Built-in bar',
  label: 'Label',
}

// ---------------------------------------------------------------- making items

const fresh = { unsure: false, unsureNote: '' } as const

/** The four corners of a drag's rectangle, clockwise from the top left. */
export function rectPoints(a: Point, b: Point): Point[] {
  const box = boxFromCorners(a, b)
  return [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
    { x: box.minX, y: box.maxY },
  ]
}

/** A wall, room, zone or patio edge from clicked points. Null with too few distinct points. */
export function makePolyItem(kind: PolyItem['type'], points: readonly Point[], id: string): PolyItem | null {
  const clean: Point[] = []
  for (const p of points) {
    const last = clean[clean.length - 1]
    if (!last || distance(last, p) > 0.5) clean.push({ x: p.x, y: p.y })
  }
  if (kind === 'room' || kind === 'zone') {
    while (clean.length > 1 && distance(clean[0], clean[clean.length - 1]) <= 0.5) clean.pop()
  }
  if (clean.length < minPoints(kind)) return null
  if (kind === 'wall') return { id, type: 'wall', points: clean, thickness: DEFAULT_WALL_THICKNESS_CM, ...fresh }
  return { id, type: kind, points: clean, ...fresh } as PolyItem
}

/** A column, stairs, bar, room or zone from a dragged rectangle. Null when it is too small. */
export function makeFromRect(kind: DrawKind, a: Point, b: Point, id: string): FixedItem | null {
  const box = boxFromCorners(a, b)
  const width = box.maxX - box.minX
  const height = box.maxY - box.minY
  if (width < MIN_DRAWN_CM || height < MIN_DRAWN_CM) return null
  const x = (box.minX + box.maxX) / 2
  const y = (box.minY + box.maxY) / 2
  switch (kind) {
    case 'room':
    case 'zone':
      return makePolyItem(kind, rectPoints(a, b), id)
    case 'column':
    case 'roundColumn':
      return { id, type: 'column', shape: kind === 'roundColumn' ? 'round' : 'rect', x, y, width, height, rotation: 0, ...fresh }
    case 'stairs':
      return { id, type: 'stairs', x, y, width, height, rotation: 0, ...fresh }
    case 'bar':
      return { id, type: 'bar', x, y, width, height, rotation: 0, label: 'Bar', ...fresh }
    default:
      return null
  }
}

/**
 * The item a click places: a door or window snapped onto the nearest wall
 * (or left where it was dropped, level, when no wall is near), or a column,
 * stairs, bar or label of the usual size centered on the point. Null for
 * tools that need points or a drag.
 */
export function makeAtPoint(kind: DrawKind, at: Point, items: readonly FixedItem[], id: string): FixedItem | null {
  switch (kind) {
    case 'door':
    case 'window': {
      const base: OpeningItem =
        kind === 'door'
          ? { id, type: 'door', wallId: null, x: at.x, y: at.y, rotation: 0, width: DEFAULT_DOOR_WIDTH_CM, swing: 'left', ...fresh }
          : { id, type: 'window', wallId: null, x: at.x, y: at.y, rotation: 0, width: DEFAULT_WINDOW_WIDTH_CM, ...fresh }
      return snapOpening(base, items)
    }
    case 'column':
    case 'roundColumn':
      return { id, type: 'column', shape: kind === 'roundColumn' ? 'round' : 'rect', x: at.x, y: at.y, width: DEFAULT_COLUMN_CM, height: DEFAULT_COLUMN_CM, rotation: 0, ...fresh }
    case 'stairs':
      return { id, type: 'stairs', x: at.x, y: at.y, ...DEFAULT_STAIRS, rotation: 0, ...fresh }
    case 'bar':
      return { id, type: 'bar', x: at.x, y: at.y, ...DEFAULT_BAR, rotation: 0, label: 'Bar', ...fresh }
    case 'label':
      return { id, type: 'label', x: at.x, y: at.y, rotation: 0, text: 'Label', fontSize: DEFAULT_LABEL_SIZE_CM, ...fresh }
    default:
      return null
  }
}

/**
 * A door or window put onto the nearest wall within `maxDistance` cm: its
 * center onto the wall's line, turned along it (keeping the side a door
 * opens to when it is already turned that way), and tied to that wall. One
 * near no wall is left as it is, tied to none.
 */
export function snapOpening<T extends OpeningItem>(item: T, items: readonly FixedItem[], maxDistance = OPENING_SNAP_CM): T {
  const hit = projectOntoWall(item, items, { maxDistance, preferRotation: item.rotation })
  if (!hit) return item.wallId === null ? item : { ...item, wallId: null }
  return { ...item, x: hit.x, y: hit.y, rotation: hit.rotation, wallId: hit.wallId }
}

// ---------------------------------------------------------------- finding

export function findItem(doc: TemplateDoc, id: string): FixedItem | undefined {
  return doc.items.find((i) => i.id === id)
}

/** The segment of a wall, room, zone or patio edge nearest a point. */
export function nearestSegment(item: PolyItem, p: Point): number {
  const closed = isClosedOutline(item)
  let best = 0
  let bestDistance = Infinity
  for (let i = 0; i < segmentCount(item.points, closed); i++) {
    const seg = polylineSegment(item.points, i, closed)
    if (!seg) continue
    const d = distanceToSegment(p, seg[0], seg[1])
    if (d < bestDistance) {
      best = i
      bestDistance = d
    }
  }
  return best
}

/** Items whose whole drawing lies inside a selection box. */
export function fixedItemsInBox(items: readonly FixedItem[], box: Box): string[] {
  const out: string[] = []
  for (const item of items) {
    const b = fixedItemBounds(item)
    if (b && boxContains(box, b)) out.push(item.id)
  }
  return out
}

/** The point of a poly item nearest p, within `tolerance` cm, or null. */
export function vertexAt(item: PolyItem, p: Point, tolerance: number): number | null {
  let best: number | null = null
  let bestDistance = Infinity
  item.points.forEach((q, i) => {
    const d = distance(q, p)
    if (d < bestDistance) {
      best = i
      bestDistance = d
    }
  })
  return best !== null && bestDistance <= tolerance ? best : null
}

// ---------------------------------------------------------------- editing

function mapItems(doc: TemplateDoc, fn: (item: FixedItem) => FixedItem): TemplateDoc {
  let changed = false
  const items = doc.items.map((item) => {
    const next = fn(item)
    if (next !== item) changed = true
    return next
  })
  return changed ? { ...doc, items } : doc
}

function isArea(item: FixedItem): boolean {
  return item.type === 'room' || item.type === 'zone' || item.type === 'patioEdge'
}

/** Adds an item. Rooms, zones and patio edges go under everything else, so their outlines never cover a wall. */
export function addFixedItem(doc: TemplateDoc, item: FixedItem): TemplateDoc {
  if (doc.items.some((i) => i.id === item.id)) return doc
  if (!isArea(item)) return { ...doc, items: [...doc.items, item] }
  let at = 0
  while (at < doc.items.length && isArea(doc.items[at])) at++
  return { ...doc, items: [...doc.items.slice(0, at), item, ...doc.items.slice(at)] }
}

/** Removes items. Doors and windows on a removed wall stay, tied to no wall. */
export function deleteFixedItems(doc: TemplateDoc, ids: readonly string[]): TemplateDoc {
  const gone = new Set(ids)
  if (!doc.items.some((i) => gone.has(i.id))) return doc
  const items = doc.items
    .filter((i) => !gone.has(i.id))
    .map((i) => (isOpening(i) && i.wallId !== null && gone.has(i.wallId) ? { ...i, wallId: null } : i))
  return { ...doc, items }
}

/** One item moved by (dx, dy) cm. */
export function translateFixedItem<T extends FixedItem>(item: T, dx: number, dy: number): T {
  if (dx === 0 && dy === 0) return item
  if (isPolyItem(item)) return { ...item, points: item.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) }
  return { ...item, x: (item as { x: number }).x + dx, y: (item as { y: number }).y + dy }
}

/** Moves items, and the doors and windows on any moved wall with them. Moving every item moves the reference image too. */
export function moveFixedItems(doc: TemplateDoc, ids: readonly string[], dx: number, dy: number): TemplateDoc {
  if (dx === 0 && dy === 0) return doc
  const moving = new Set(ids)
  const moves = (item: FixedItem) => moving.has(item.id) || (isOpening(item) && item.wallId !== null && moving.has(item.wallId))
  const next = mapItems(doc, (item) => (moves(item) ? translateFixedItem(item, dx, dy) : item))
  // Moving the whole plan moves the original image under it too, so the two
  // still line up when the image is turned on to check against.
  if (next !== doc && doc.reference && doc.items.every(moves)) {
    return { ...next, reference: { ...doc.reference, offsetX: doc.reference.offsetX + dx, offsetY: doc.reference.offsetY + dy } }
  }
  return next
}

/** Doors and windows on these walls back onto their wall's line after its points changed. */
export function followWalls(doc: TemplateDoc, wallIds: readonly string[]): TemplateDoc {
  const walls = new Set(wallIds)
  if (walls.size === 0) return doc
  const segs = wallSegments(doc.items)
  return mapItems(doc, (item) => {
    if (!isOpening(item) || item.wallId === null || !walls.has(item.wallId)) return item
    const hit = projectOntoWall(item, segs, { onlyWallId: item.wallId, preferRotation: item.rotation })
    if (!hit) return item
    if (hit.x === item.x && hit.y === item.y && hit.rotation === item.rotation) return item
    return { ...item, x: hit.x, y: hit.y, rotation: hit.rotation }
  })
}

function withPoints(doc: TemplateDoc, id: string, recipe: (item: PolyItem) => Point[] | null): TemplateDoc {
  const item = findItem(doc, id)
  if (!item || !isPolyItem(item)) return doc
  const points = recipe(item)
  if (!points || (points.length === item.points.length && points.every((p, i) => p.x === item.points[i].x && p.y === item.points[i].y))) return doc
  if (points.length < minPoints(item.type)) return doc
  const next = mapItems(doc, (i) => (i.id === id ? ({ ...item, points } as FixedItem) : i))
  return item.type === 'wall' ? followWalls(next, [id]) : next
}

/** Moves one point of a wall, room, zone or patio edge. */
export function setVertex(doc: TemplateDoc, id: string, index: number, p: Point): TemplateDoc {
  return withPoints(doc, id, (item) => {
    if (!Number.isInteger(index) || index < 0 || index >= item.points.length) return null
    return item.points.map((q, i) => (i === index ? { x: p.x, y: p.y } : q))
  })
}

/** Removes one point, when the item keeps enough of them. */
export function removeVertex(doc: TemplateDoc, id: string, index: number): TemplateDoc {
  return withPoints(doc, id, (item) => (index >= 0 && index < item.points.length ? item.points.filter((_, i) => i !== index) : null))
}

/**
 * Sets one side's length by moving its far end along its line (spec: "type
 * exact lengths"). The closing side of a room or zone moves the first point.
 */
export function setSideLength(doc: TemplateDoc, id: string, index: number, cm: number): TemplateDoc {
  return withPoints(doc, id, (item) => setSegmentLength(item.points, index, cm, { closed: isClosedOutline(item) }))
}

/**
 * Changes fields of one item (name, thickness, size, swing, text and the
 * like). Refused, leaving the document as it was, when the result is not a
 * valid fixed item or would change its id or type.
 */
export function patchFixedItem(doc: TemplateDoc, id: string, patch: Partial<Record<string, unknown>>): TemplateDoc {
  const item = findItem(doc, id)
  if (!item) return doc
  if (('id' in patch && patch.id !== item.id) || ('type' in patch && patch.type !== item.type)) return doc
  const merged = { ...item, ...patch } as Record<string, unknown>
  for (const key of Object.keys(patch)) if (merged[key] === undefined) delete merged[key]
  const checked = fixedItemSchema.safeParse(merged)
  if (!checked.success) return doc
  const next = checked.data
  if (JSON.stringify(next) === JSON.stringify(item)) return doc
  const out = mapItems(doc, (i) => (i.id === id ? next : i))
  return next.type === 'wall' ? followWalls(out, [id]) : out
}

/** Copies items with new ids, moved by (dx, dy); copied doors keep to the copied wall. Returns the new ids. */
export function duplicateFixedItems(
  doc: TemplateDoc,
  ids: readonly string[],
  newId: () => string,
  dx: number,
  dy: number,
): { doc: TemplateDoc; ids: string[] } {
  const wanted = new Set(ids)
  const sources = doc.items.filter((i) => wanted.has(i.id))
  if (sources.length === 0) return { doc, ids: [] }
  const map = new Map(sources.map((i) => [i.id, newId()]))
  let next = doc
  const added: string[] = []
  for (const source of sources) {
    const id = map.get(source.id)!
    let copy = translateFixedItem({ ...source, id } as FixedItem, dx, dy)
    if (isOpening(copy) && copy.wallId !== null) copy = { ...copy, wallId: map.get(copy.wallId) ?? null }
    next = addFixedItem(next, copy)
    added.push(id)
  }
  return { doc: next, ids: added }
}

/** Puts items at the end of the list, so they draw on top. */
export function bringFixedToFront(doc: TemplateDoc, ids: readonly string[]): TemplateDoc {
  const set = new Set(ids)
  const front = doc.items.filter((i) => set.has(i.id))
  if (front.length === 0) return doc
  const items = [...doc.items.filter((i) => !set.has(i.id)), ...front]
  return items.every((i, k) => i === doc.items[k]) ? doc : { ...doc, items }
}

// ---------------------------------------------------------------- handles

/** A box item as a plain shape, so the layout editor's handle math (resize.ts) can work on it. */
function asShape(item: BoxItem | Extract<FixedItem, { type: 'label' }>): Shape {
  const size = item.type === 'label' ? { width: Math.max(item.fontSize, 10), height: Math.max(item.fontSize, 10) } : { width: item.width, height: item.height }
  return {
    id: item.id,
    kind: 'shape',
    type: 'rect',
    x: item.x,
    y: item.y,
    rotation: item.rotation,
    locked: false,
    ...size,
    style: { stroke: '#000000', fill: 'none', strokeWidth: 1 },
  }
}

/** A column, stairs or bar resized by a handle dragged to `pointer`; a round column keeps its circle when `keepRatio`. */
export function resizeBoxItem<T extends BoxItem>(item: T, handle: Handle, pointer: Point, options: { keepRatio?: boolean; gridStep?: number } = {}): T {
  const r = resizeByHandle(asShape(item), handle, pointer, { keepRatio: options.keepRatio, gridStep: options.gridStep, minCm: MIN_DRAWN_CM })
  if (r.x === item.x && r.y === item.y && r.width === item.width && r.height === item.height) return item
  return { ...item, x: r.x, y: r.y, width: r.width, height: r.height }
}

/** A column, stairs, bar or label turned so its top faces the pointer, in 15 degree steps unless `snapDegrees` is null. */
export function rotateFixedItem<T extends BoxItem | Extract<FixedItem, { type: 'label' }>>(item: T, pointer: Point, snapDegrees: number | null = 15): T {
  const r = rotateByHandle(asShape(item), pointer, { snapDegrees })
  return r.rotation === item.rotation ? item : { ...item, rotation: normalizeDegrees(r.rotation) }
}

// ---------------------------------------------------------------- reference image

/** The reference image's opacity, 0 to 1. Nothing changes without a reference. */
export function setReferenceOpacity(doc: TemplateDoc, opacity: number): TemplateDoc {
  if (!doc.reference || !Number.isFinite(opacity)) return doc
  const value = Math.min(1, Math.max(0, Math.round(opacity * 100) / 100))
  return value === doc.reference.opacity ? doc : { ...doc, reference: { ...doc.reference, opacity: value } }
}

/** Marks an item checked: the import's "unsure" flag and its note go. */
export function markChecked(doc: TemplateDoc, id: string): TemplateDoc {
  return mapItems(doc, (i) => (i.id === id && (i.unsure || i.unsureNote !== '') ? { ...i, unsure: false, unsureNote: '' } : i))
}

/** The box (cm) the template's items and, when given, its reference image cover. */
export function templateBox(doc: TemplateDoc, image?: { width: number; height: number } | null): Box | null {
  let box: Box | null = null
  const add = (b: Box | null) => {
    if (!b) return
    box = box ? { minX: Math.min(box.minX, b.minX), minY: Math.min(box.minY, b.minY), maxX: Math.max(box.maxX, b.maxX), maxY: Math.max(box.maxY, b.maxY) } : b
  }
  for (const item of doc.items) add(fixedItemBounds(item))
  if (image && doc.reference) {
    const r = doc.reference
    add({ minX: r.offsetX, minY: r.offsetY, maxX: r.offsetX + image.width * r.scaleCmPerPx, maxY: r.offsetY + image.height * r.scaleCmPerPx })
  }
  return box
}
