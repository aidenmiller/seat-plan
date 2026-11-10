/**
 * Editor commands: plain Canvas -> Canvas functions (PLAN section 6). No
 * React, no DOM, no store. The editor runs each one through the document
 * guard (state/editor-doc.ts), which records it as one undo step and refuses
 * it in View mode.
 *
 * Shared rules:
 *  - A command that changes nothing returns the same canvas object, so the
 *    document store records no step.
 *  - Locked items never move, resize, turn or get deleted. Unlock them first.
 *    Seats, names and labels on a locked item can still change.
 *  - Every change to a table's seat count, size or sides goes through
 *    remapSeats (src/domain/seats.ts), so guests keep their places and never
 *    jump across the table (DECISIONS 9).
 *  - A seat change that would unseat anyone is refused unless the caller
 *    passes allowUnseat, and the reply names those guests, highest seat
 *    numbers first, so the editor can ask before moving them to Unassigned
 *    (DECISIONS 10).
 *  - Copies (duplicate, paste) get new ids, empty seats and the next table
 *    numbers (PLAN changes 3 and 9).
 *  - Seating a guest (seat, move, swap, unseat) is src/domain/seating.ts;
 *    the two seating commands here build on it for the guest menu and the
 *    swap action. Seats on locked items still change (DECISIONS 56).
 */
import {
  MIN_TABLE_CM,
  wellFormedText,
  type Canvas,
  type Item,
  type Shape,
  type Table,
} from '@/domain/canvas-schema'
import { alignItems as alignDomain, distributeItems as distributeDomain, type AlignMode, type DistributeAxis } from '@/domain/align'
import { boxCenter, itemBox, itemsBox, normalizeDegrees, type Point } from '@/domain/geometry'
import { copyItems, defaultTableName, makeItem, type PresetId } from '@/domain/presets'
import {
  isResizable,
  MIN_ITEM_CM,
  resizeByHandle,
  resizeFromCenterByDrag,
  rotateByHandle,
  type Handle,
  type ResizeOptions,
} from '@/domain/resize'
import { guestSeat, seatGuest, unseatGuest, type SeatMove, type SeatRef } from '@/domain/seating'
import {
  addSeat as addSeatDomain,
  fitSeatCount,
  maxSeats,
  remapSeats,
  removeSeatPlan,
  setSeatCount as setSeatCountDomain,
  type TableSeatPlan,
} from '@/domain/seats'

export type { AlignMode, DistributeAxis }
export type IdList = Iterable<string>

/** Rounds away float noise (3 * 30.48 is 91.44000000000001). */
function clean(value: number): number {
  const v = Math.round(value * 1e6) / 1e6
  return v === 0 ? 0 : v
}

function idSet(ids: IdList): Set<string> {
  return ids instanceof Set ? (ids as Set<string>) : new Set(ids)
}

/** The canvas with `fn` applied to each item; the same canvas when no item changed. */
function mapItems(canvas: Canvas, fn: (item: Item) => Item): Canvas {
  let changed = false
  const items = canvas.items.map((item) => {
    const next = fn(item)
    if (next !== item) changed = true
    return next
  })
  return changed ? { ...canvas, items } : canvas
}

function updateItem(canvas: Canvas, id: string, fn: (item: Item) => Item): Canvas {
  return mapItems(canvas, (item) => (item.id === id ? fn(item) : item))
}

function findItem(canvas: Canvas, id: string): Item | undefined {
  return canvas.items.find((item) => item.id === id)
}

function findTable(canvas: Canvas, id: string): Table | undefined {
  const item = findItem(canvas, id)
  return item?.kind === 'table' ? item : undefined
}

/** The point snapped to the grid, or the same point with a step of 0 (snapping off). */
export function snapPoint(p: Point, gridStep: number): Point {
  if (!(gridStep > 0)) return { x: p.x, y: p.y }
  return { x: clean(Math.round(p.x / gridStep) * gridStep), y: clean(Math.round(p.y / gridStep) * gridStep) }
}

/** The items with these ids, in drawing order. */
export function itemsByIds(canvas: Canvas, ids: IdList): Item[] {
  const set = idSet(ids)
  return canvas.items.filter((item) => set.has(item.id))
}

// ---------------------------------------------------------------- adding

/** A new item from a shape panel preset, centered at `at`, on top of everything. Tables take the next number. */
export function addItem(canvas: Canvas, presetId: PresetId, at: Point, id: string): Canvas {
  return { ...canvas, items: [...canvas.items, makeItem(presetId, at, id, canvas)] }
}

// ---------------------------------------------------------------- moving

/** Moves the items by dx, dy cm. Locked items stay. */
export function moveItems(canvas: Canvas, ids: IdList, dx: number, dy: number): Canvas {
  if ((dx === 0 && dy === 0) || !Number.isFinite(dx) || !Number.isFinite(dy)) return canvas
  const set = idSet(ids)
  return mapItems(canvas, (item) =>
    set.has(item.id) && !item.locked ? { ...item, x: clean(item.x + dx), y: clean(item.y + dy) } : item,
  )
}

export type NudgeDirection = 'left' | 'right' | 'up' | 'down'

/** An arrow key: one grid step, or five with Shift. */
export function nudgeItems(canvas: Canvas, ids: IdList, direction: NudgeDirection, gridStep: number, big = false): Canvas {
  const step = gridStep * (big ? 5 : 1)
  const dx = direction === 'left' ? -step : direction === 'right' ? step : 0
  const dy = direction === 'up' ? -step : direction === 'down' ? step : 0
  return moveItems(canvas, ids, dx, dy)
}

// ---------------------------------------------------------------- size and turn

export type BoxPatch = Partial<{ x: number; y: number; width: number; height: number; rotation: number }>

/** The item at a new width and height about its center: points scale with it, guests keep their places. */
function withSize(item: Item, width: number, height: number): Item {
  if (!isResizable(item)) return item
  if (width === item.width && height === item.height) return item
  const sx = width / item.width
  const sy = height / item.height
  switch (item.kind) {
    case 'table': {
      const next: Table = { ...item, width, height }
      return { ...next, seats: remapSeats(item, next).canvasSeats }
    }
    case 'shape':
    case 'note': {
      const sized = { ...item, width, height }
      return item.points ? { ...sized, points: item.points.map((p) => ({ x: clean(p.x * sx), y: clean(p.y * sy) })) } : sized
    }
    default:
      return { ...item, width, height }
  }
}

/**
 * The properties panel's fields: center, size and rotation. Tables stay at
 * least 24 in on every side and round tables stay round (a new width or
 * height sets both); other items stay at least 10 cm. Locked items stay.
 */
export function setItemBox(canvas: Canvas, id: string, patch: BoxPatch): Canvas {
  return updateItem(canvas, id, (item) => {
    if (item.locked) return item
    let next: Item = item
    if (patch.x !== undefined && Number.isFinite(patch.x) && patch.x !== item.x) next = { ...next, x: clean(patch.x) }
    if (patch.y !== undefined && Number.isFinite(patch.y) && patch.y !== item.y) next = { ...next, y: clean(patch.y) }
    if (patch.rotation !== undefined && Number.isFinite(patch.rotation)) {
      const rotation = normalizeDegrees(patch.rotation)
      if (rotation !== item.rotation) next = { ...next, rotation }
    }
    if (isResizable(next) && (patch.width !== undefined || patch.height !== undefined)) {
      const min = next.kind === 'table' ? MIN_TABLE_CM : MIN_ITEM_CM
      const ok = (v: number | undefined): v is number => v !== undefined && Number.isFinite(v) && v > 0
      let w = ok(patch.width) ? Math.max(min, clean(patch.width)) : next.width
      let h = ok(patch.height) ? Math.max(min, clean(patch.height)) : next.height
      if (next.kind === 'table' && next.shape === 'round') {
        const size = ok(patch.width) ? w : h
        w = size
        h = size
      }
      next = withSize(next, w, h)
    }
    return next
  })
}

/** A handle drag: `from` is the item when the drag started (defaults to the item now). Locked items stay. */
export function resizeItem(canvas: Canvas, id: string, handle: Handle, pointer: Point, options: ResizeOptions = {}, from?: Item): Canvas {
  return updateItem(canvas, id, (item) => {
    const start = from ?? item
    if (start.locked || item.locked) return item
    return resizeByHandle(start, handle, pointer, options)
  })
}

/** Shift+drag on a table's body: resizes about the center, keeping proportions. Locked items stay. */
export function resizeItemFromCenter(canvas: Canvas, id: string, startPointer: Point, pointer: Point, from?: Item): Canvas {
  return updateItem(canvas, id, (item) => {
    const start = from ?? item
    if (start.locked || item.locked) return item
    return resizeFromCenterByDrag(start, startPointer, pointer)
  })
}

/**
 * The rotate handle: turns the item so its top faces the pointer, in
 * `snapDegrees` steps (15 by default), or freely with null (Alt). Locked items stay.
 */
export function rotateItem(canvas: Canvas, id: string, pointer: Point, snapDegrees: number | null = 15, from?: Item): Canvas {
  return updateItem(canvas, id, (item) => {
    const start = from ?? item
    if (start.locked || item.locked) return item
    const turned = rotateByHandle(start, pointer, { snapDegrees })
    return turned.rotation === item.rotation && turned.x === item.x && turned.y === item.y ? item : turned
  })
}

// ---------------------------------------------------------------- delete, copy, order

/** Deletes the items. Locked items stay. Notes attached to a deleted item let go of it. */
export function deleteItems(canvas: Canvas, ids: IdList): Canvas {
  const set = idSet(ids)
  const removed = new Set<string>()
  for (const item of canvas.items) if (set.has(item.id) && !item.locked) removed.add(item.id)
  if (removed.size === 0) return canvas
  const items = canvas.items
    .filter((item) => !removed.has(item.id))
    .map((item) => {
      if (item.kind !== 'note') return item
      const { start, end } = item.attachedTo
      const s = start !== null && removed.has(start) ? null : start
      const e = end !== null && removed.has(end) ? null : end
      return s === start && e === end ? item : { ...item, attachedTo: { start: s, end: e } }
    })
  return { ...canvas, items }
}

export type AddedItems = { canvas: Canvas; ids: string[] }

/**
 * Copies of the items, one grid step down and to the right, on top of
 * everything: new ids, every seat empty, the next table numbers, unlocked.
 * Returns the new ids so the editor can select them.
 */
export function duplicateItems(canvas: Canvas, ids: IdList, newId: () => string, gridStep: number): AddedItems {
  const items = itemsByIds(canvas, ids)
  if (items.length === 0) return { canvas, ids: [] }
  const step = gridStep > 0 ? gridStep : 0
  const copies = copyItems(items, canvas, newId, { x: step, y: step }).map((item) => (item.locked ? { ...item, locked: false } : item))
  return { canvas: { ...canvas, items: [...canvas.items, ...copies] }, ids: copies.map((c) => c.id) }
}

export type PastePlacement = {
  /** Center the pasted group (its bodies, chairs left out) here: a pointer or the viewport's center, the move snapped to the grid. */
  at?: Point
  /** Or move the copies by this much from where they were copied. */
  offset?: Point
  /** Snaps the move from `at`, so items copied on the grid land on it. 0 or less: no snapping. */
  gridStep?: number
}

/**
 * Pastes clipboard items (from this layout or another): new ids, every seat
 * empty, the next table numbers, unlocked, on top of everything.
 */
export function pasteItems(canvas: Canvas, items: readonly Item[], newId: () => string, placement: PastePlacement = {}): AddedItems {
  if (items.length === 0) return { canvas, ids: [] }
  let offset = placement.offset ?? { x: 0, y: 0 }
  if (placement.at) {
    // Bodies, so a one-sided table's chairs do not pull its center off the point.
    const box = itemsBox(items, itemBox)
    const c = box ? boxCenter(box) : { x: 0, y: 0 }
    offset = snapPoint({ x: placement.at.x - c.x, y: placement.at.y - c.y }, placement.gridStep ?? 0)
  }
  const copies = copyItems(items, canvas, newId, offset).map((item) =>
    item.locked ? { ...item, locked: false, x: clean(item.x), y: clean(item.y) } : { ...item, x: clean(item.x), y: clean(item.y) },
  )
  return { canvas: { ...canvas, items: [...canvas.items, ...copies] }, ids: copies.map((c) => c.id) }
}

export function setLocked(canvas: Canvas, ids: IdList, locked: boolean): Canvas {
  const set = idSet(ids)
  return mapItems(canvas, (item) => (set.has(item.id) && item.locked !== locked ? { ...item, locked } : item))
}

/** Moves the items to the top of the drawing order, keeping their order among themselves. */
export function bringToFront(canvas: Canvas, ids: IdList): Canvas {
  const set = idSet(ids)
  const moving = canvas.items.filter((i) => set.has(i.id))
  const rest = canvas.items.filter((i) => !set.has(i.id))
  const items = [...rest, ...moving]
  return items.every((item, i) => item === canvas.items[i]) ? canvas : { ...canvas, items }
}

/** Moves the items to the bottom of the drawing order, keeping their order among themselves. */
export function sendToBack(canvas: Canvas, ids: IdList): Canvas {
  const set = idSet(ids)
  const moving = canvas.items.filter((i) => set.has(i.id))
  const rest = canvas.items.filter((i) => !set.has(i.id))
  const items = [...moving, ...rest]
  return items.every((item, i) => item === canvas.items[i]) ? canvas : { ...canvas, items }
}

// ---------------------------------------------------------------- align and distribute

function replaceByIds(canvas: Canvas, changed: readonly Item[]): Canvas {
  const byId = new Map(changed.map((i) => [i.id, i]))
  return mapItems(canvas, (item) => byId.get(item.id) ?? item)
}

/** Lines up the items by their footprints. Locked items stay but still count. */
export function alignItems(canvas: Canvas, ids: IdList, mode: AlignMode): Canvas {
  const items = itemsByIds(canvas, ids)
  if (items.length < 2) return canvas
  const moved = alignDomain(items, mode).map((item) => ({ ...item, x: clean(item.x), y: clean(item.y) }))
  return replaceByIds(canvas, moved.filter((item, i) => item.x !== items[i].x || item.y !== items[i].y))
}

/** Spreads the items with equal gaps. Locked items stay but still count. */
export function distributeItems(canvas: Canvas, ids: IdList, axis: DistributeAxis): Canvas {
  const items = itemsByIds(canvas, ids)
  if (items.length < 3) return canvas
  const moved = distributeDomain(items, axis).map((item) => ({ ...item, x: clean(item.x), y: clean(item.y) }))
  return replaceByIds(canvas, moved.filter((item, i) => item.x !== items[i].x || item.y !== items[i].y))
}

// ---------------------------------------------------------------- tables

function cleanName(text: string, max: number): string {
  return wellFormedText(text).trim().slice(0, max)
}

/** Renames a table. A blank name goes back to "Table N", which then follows the number again. */
export function renameTable(canvas: Canvas, id: string, name: string): Canvas {
  return updateItem(canvas, id, (item) => {
    if (item.kind !== 'table') return item
    const next = cleanName(name, 100) || defaultTableName(item.number)
    return next === item.name ? item : { ...item, name: next }
  })
}

/** Gives a table a new number (1 to 9999). A table still called "Table N" takes its new number's name. */
export function setTableNumber(canvas: Canvas, id: string, number: number): Canvas {
  if (!Number.isFinite(number)) return canvas
  const n = Math.max(1, Math.min(9999, Math.round(number)))
  return updateItem(canvas, id, (item) => {
    if (item.kind !== 'table' || item.number === n) return item
    const plain = item.name.trim() === '' || item.name.trim() === defaultTableName(item.number)
    return { ...item, number: n, name: plain ? defaultTableName(n) : item.name }
  })
}

export type SeatChange = {
  /** The canvas after the change, or the same canvas when it was refused or changed nothing. */
  canvas: Canvas
  /** Guests the change unseats (or would unseat, when refused), highest seat numbers first. */
  unseated: string[]
  /** True when the change would unseat someone and allowUnseat was not given. Ask, then call again with it. */
  refused: boolean
}

export type SeatChangeOptions = {
  /** The person agreed to move these guests to Unassigned. */
  allowUnseat?: boolean
}

/** A new seat count: a lower one takes empty seats out first, from the side that holds them (removeSeatPlan). */
function seatPlan(table: Table, count: number): TableSeatPlan<Table> {
  return count < table.seatCount ? removeSeatPlan(table, count) : setSeatCountDomain(table, count)
}

function seatChange(canvas: Canvas, table: Table, count: number, options: SeatChangeOptions): SeatChange {
  const plan = seatPlan(table, count)
  if (plan.table.seatCount === table.seatCount) return { canvas, unseated: [], refused: false }
  if (plan.unseated.length > 0 && !options.allowUnseat) return { canvas, unseated: plan.unseated, refused: true }
  return { canvas: updateItem(canvas, table.id, () => plan.table), unseated: plan.unseated, refused: false }
}

/**
 * The seat count field: from 0 to the table's cap (30 round and square, 60
 * rect). Guests keep their seat order and move as little as they can; a
 * lower count than the number of guests is refused unless allowUnseat.
 */
export function setSeatCount(canvas: Canvas, id: string, count: number, options: SeatChangeOptions = {}): SeatChange {
  const table = findTable(canvas, id)
  if (!table || !Number.isFinite(count)) return { canvas, unseated: [], refused: false }
  return seatChange(canvas, table, count, options)
}

/** The + button: one more seat, on the side with the most spare edge. The same canvas at the seat cap. */
export function addSeat(canvas: Canvas, id: string): Canvas {
  const table = findTable(canvas, id)
  if (!table || table.seatCount >= maxSeats(table.shape)) return canvas
  return updateItem(canvas, id, () => addSeatDomain(table))
}

/**
 * The − button: one seat fewer, an empty one first (from the most crowded
 * side, and on a square or rect table from the side that holds it), the
 * other guests keeping their order. When every seat is taken it is refused,
 * naming the guest who would move, unless allowUnseat.
 */
export function removeSeat(canvas: Canvas, id: string, options: SeatChangeOptions = {}): SeatChange {
  const table = findTable(canvas, id)
  if (!table || table.seatCount <= 0) return { canvas, unseated: [], refused: false }
  return seatChange(canvas, table, table.seatCount - 1, options)
}

/** Fit seats: the count the table's size holds (22 in each on round tables, 24 in on straight edges). */
export function fitSeats(canvas: Canvas, id: string, options: SeatChangeOptions = {}): SeatChange {
  const table = findTable(canvas, id)
  if (!table) return { canvas, unseated: [], refused: false }
  return seatChange(canvas, table, fitSeatCount(table), options)
}

/** All sides, no ends, or one side. Guests keep their seat order and move as little as they can; nobody is unseated. */
export function setSeatSides(canvas: Canvas, id: string, seatSides: Table['seatSides']): Canvas {
  return updateItem(canvas, id, (item) => {
    if (item.kind !== 'table' || item.seatSides === seatSides) return item
    const next: Table = { ...item, seatSides }
    return { ...next, seats: remapSeats(item, next).canvasSeats }
  })
}

// ---------------------------------------------------------------- fixtures and shapes

/** A fixture's label or a shape's text. */
export function setLabel(canvas: Canvas, id: string, label: string): Canvas {
  return updateItem(canvas, id, (item) => {
    if (item.kind === 'fixture') {
      const next = cleanName(label, 200)
      return next === item.label ? item : { ...item, label: next }
    }
    if (item.kind === 'shape') {
      const next = wellFormedText(label).slice(0, 2000)
      return next === item.text ? item : { ...item, text: next }
    }
    return item
  })
}

export type StylePatch = Partial<Shape['style']>

/** A shape's stroke, fill, stroke width and font size. Fixtures draw with their own icon style and have none. */
export function setStyle(canvas: Canvas, id: string, patch: StylePatch): Canvas {
  return updateItem(canvas, id, (item) => {
    if (item.kind !== 'shape') return item
    const style = { ...item.style }
    if (patch.stroke !== undefined) style.stroke = wellFormedText(patch.stroke).slice(0, 32)
    if (patch.fill !== undefined) style.fill = wellFormedText(patch.fill).slice(0, 32)
    if (patch.strokeWidth !== undefined && Number.isFinite(patch.strokeWidth)) style.strokeWidth = Math.max(0, Math.min(1000, patch.strokeWidth))
    if (patch.fontSize !== undefined && Number.isFinite(patch.fontSize) && patch.fontSize > 0) style.fontSize = Math.min(10_000, patch.fontSize)
    const same =
      style.stroke === item.style.stroke &&
      style.fill === item.style.fill &&
      style.strokeWidth === item.style.strokeWidth &&
      style.fontSize === item.style.fontSize
    return same ? item : { ...item, style }
  })
}

// ---------------------------------------------------------------- seating

/**
 * Sends several guests to Unassigned as one change (the guest menu's
 * Unseat). `from` is the first seat emptied. The same canvas when none of
 * them was seated.
 */
export function unseatGuests(canvas: Canvas, guestIds: IdList): SeatMove {
  let next = canvas
  let from: SeatRef | null = null
  for (const id of idSet(guestIds)) {
    const r = unseatGuest(next, id)
    if (!r.changed) continue
    from ??= r.from
    next = r.canvas
  }
  return { canvas: next, changed: next !== canvas, seat: null, from, displaced: null }
}

/** Two seated guests trade seats. The same canvas unless both are seated, apart. */
export function swapGuests(canvas: Canvas, a: string, b: string): SeatMove {
  const from = guestSeat(canvas, a)
  const to = guestSeat(canvas, b)
  if (!from || !to || a === b) return { canvas, changed: false, seat: from, from, displaced: null }
  return seatGuest(canvas, a, to.itemId, to.seatIndex)
}
