/**
 * Seating guests (spec section 4, "Seating guests"; PLAN section 6,
 * "Seating guests"). Pure canvas edits: each returns a new canvas, or the
 * same canvas object when nothing changes, so one call is one undo step and
 * one save through the editor document.
 *
 *  - seatGuest puts a guest in a seat. A guest already seated elsewhere in
 *    the layout moves. A taken seat swaps: the other guest goes to the
 *    dragged guest's old seat, or to Unassigned when the dragged guest had
 *    no seat. A seat's pinned flag travels with its guest.
 *  - seatAtTableFirstFree takes the lowest-numbered free seat, or says 'full'.
 *  - unseatGuest sends a guest back to Unassigned.
 *  - dropTarget says where a drag would land: a seat (within its circle),
 *    else a table's first free seat (on its top or chair ring), else an
 *    empty seat just outside the ring (within 22 px on screen), else 'full',
 *    else nothing. Only a drop inside a taken seat's circle swaps.
 *  - reorderWithinTable is the Properties seat list: move or swap, as on the canvas.
 *
 * Seats belong to tables and ceremony chair rows. Locked items still take
 * guests (DECISIONS 56). A guest the canvas wrongly holds in two seats ends
 * up in one after any of these edits.
 */
import type { Canvas, ChairRow, Item, Seat, Table } from './canvas-schema'
import { pxToCm } from './detail-level'
import { chairRowLength, itemFootprint, tableBodyFootprint, type Footprint, type Point } from './geometry'
import { itemLabel } from './item-labels'
import { seatLayout, SEAT_RADIUS_CM } from './seats'

/** Math.hypot, without its slow paths for huge numbers (none here). */
function len(dx: number, dy: number): number {
  return Math.sqrt(dx * dx + dy * dy)
}

export type SeatRef = { itemId: string; seatIndex: number }
export type SeatItem = Table | ChairRow

/** The smallest drop circle round an empty seat, in screen pixels: 44 px across, a tap target. */
export const SEAT_TOUCH_RADIUS_PX = 22
/** A drop this far past a seat circle's edge, in screen pixels, still counts as inside it... */
export const SEAT_EDGE_TOLERANCE_PX = 4
/** ...but never more than this many cm, so zoomed out a drop between two taken seats is not on either. */
export const SEAT_EDGE_TOLERANCE_MAX_CM = SEAT_RADIUS_CM / 4

export function isSeatItem(item: Item): item is SeatItem {
  return item.kind === 'table' || item.kind === 'chairRow'
}

export type SeatMove = {
  /** The canvas after the change; the same object when nothing changed. */
  canvas: Canvas
  changed: boolean
  /** Where the guest sits after the change, or null. */
  seat: SeatRef | null
  /** Where the guest sat before, or null. */
  from: SeatRef | null
  /** The guest who held the target seat: moved to `from` (a swap), or to Unassigned (to: null). */
  displaced: { guestId: string; to: SeatRef | null } | null
}

function unchanged(canvas: Canvas, seat: SeatRef | null): SeatMove {
  return { canvas, changed: false, seat, from: seat, displaced: null }
}

/** Where a guest sits in this canvas: the first seat by item order, then seat order. Null when unseated. */
export function guestSeat(canvas: Pick<Canvas, 'items'>, guestId: string): SeatRef | null {
  for (const item of canvas.items) {
    if (!isSeatItem(item)) continue
    for (let i = 0; i < item.seats.length; i++) {
      if (item.seats[i].guestId === guestId) return { itemId: item.id, seatIndex: i }
    }
  }
  return null
}

/** Every seated guest's seat (first seat only, as guestSeat), for lookups in bulk. */
export function seatsByGuest(canvas: Pick<Canvas, 'items'>): Map<string, SeatRef> {
  const out = new Map<string, SeatRef>()
  for (const item of canvas.items) {
    if (!isSeatItem(item)) continue
    item.seats.forEach((seat, i) => {
      if (seat.guestId !== null && !out.has(seat.guestId)) out.set(seat.guestId, { itemId: item.id, seatIndex: i })
    })
  }
  return out
}

function findSeatItem(canvas: Pick<Canvas, 'items'>, itemId: string): SeatItem | null {
  const item = canvas.items.find((i) => i.id === itemId)
  return item && isSeatItem(item) ? item : null
}

/** What a seat holds apart from its number: the guest and their pinned flag. */
type SeatContent = { guestId: string | null; pinned?: boolean }

function contentOf(seat: Seat): SeatContent {
  return seat.pinned === undefined ? { guestId: seat.guestId } : { guestId: seat.guestId, pinned: seat.pinned }
}

function withContent(index: number, content: SeatContent): Seat {
  if (content.guestId === null) return { index, guestId: null }
  return content.pinned === undefined ? { index, guestId: content.guestId } : { index, guestId: content.guestId, pinned: content.pinned }
}

/**
 * Applies seat writes: `writes` maps item id to seat index to new content.
 * Every other seat the given guests hold is emptied, so nobody is left in two seats.
 */
function applySeats(canvas: Canvas, writes: Map<string, Map<number, SeatContent>>, clearGuests: ReadonlySet<string>): Canvas {
  let changed = false
  const items = canvas.items.map((item) => {
    if (!isSeatItem(item)) return item
    const own = writes.get(item.id)
    let seats: Seat[] | null = null
    for (let i = 0; i < item.seats.length; i++) {
      const seat = item.seats[i]
      const write = own?.get(i)
      let next: Seat | null = null
      if (write !== undefined) {
        if (write.guestId !== seat.guestId || write.pinned !== seat.pinned) next = withContent(i, write)
      } else if (seat.guestId !== null && clearGuests.has(seat.guestId)) {
        next = { index: i, guestId: null }
      }
      if (next) {
        seats ??= item.seats.slice()
        seats[i] = next
      }
    }
    if (!seats) return item
    changed = true
    return { ...item, seats }
  })
  return changed ? { ...canvas, items } : canvas
}

/**
 * Seats a guest at `seatIndex` of a table or chair row. A guest seated
 * elsewhere moves. A taken seat swaps: its guest takes the dragged guest's
 * old seat, or goes to Unassigned when the dragged guest had none. The same
 * canvas comes back when the guest already sits there, or the seat does not
 * exist.
 */
export function seatGuest(canvas: Canvas, guestId: string, itemId: string, seatIndex: number): SeatMove {
  const from = guestSeat(canvas, guestId)
  const item = findSeatItem(canvas, itemId)
  if (!item || !Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= item.seats.length) return unchanged(canvas, from)
  const target: SeatRef = { itemId, seatIndex }
  const targetSeat = item.seats[seatIndex]
  if (targetSeat.guestId === guestId) {
    // Already there; still tidy away any second seat the canvas holds for them.
    const next = applySeats(canvas, new Map([[itemId, new Map([[seatIndex, contentOf(targetSeat)]])]]), new Set([guestId]))
    return { canvas: next, changed: next !== canvas, seat: target, from: target, displaced: null }
  }

  const occupant = targetSeat.guestId
  const writes = new Map<string, Map<number, SeatContent>>()
  const write = (ref: SeatRef, content: SeatContent) => {
    let m = writes.get(ref.itemId)
    if (!m) writes.set(ref.itemId, (m = new Map()))
    m.set(ref.seatIndex, content)
  }
  const fromItem = from ? findSeatItem(canvas, from.itemId) : null
  const moving: SeatContent = from && fromItem ? contentOf(fromItem.seats[from.seatIndex]) : { guestId }
  write(target, moving)
  let displaced: SeatMove['displaced'] = null
  const clear = new Set([guestId])
  if (occupant !== null) {
    if (from) {
      write(from, contentOf(targetSeat))
      displaced = { guestId: occupant, to: from }
    } else {
      displaced = { guestId: occupant, to: null }
    }
    // The other guest keeps no second seat either.
    clear.add(occupant)
  } else if (from) {
    write(from, { guestId: null })
  }
  const next = applySeats(canvas, writes, clear)
  return { canvas: next, changed: next !== canvas, seat: target, from, displaced }
}

/** The lowest-numbered free seat of a table or row, or null when it is full. */
export function firstFreeSeatOf(item: SeatItem): number | null {
  const i = item.seats.findIndex((s) => s.guestId === null)
  return i === -1 ? null : i
}

/**
 * Seats a guest in the lowest-numbered free seat of a table or row (a drop
 * on the table rather than a seat). 'full' when no seat is free. A guest
 * already at this table stays in their seat.
 */
export function seatAtTableFirstFree(canvas: Canvas, guestId: string, itemId: string): SeatMove | 'full' {
  const item = findSeatItem(canvas, itemId)
  const from = guestSeat(canvas, guestId)
  if (!item) return unchanged(canvas, from)
  if (from && from.itemId === itemId) return seatGuest(canvas, guestId, itemId, from.seatIndex)
  const free = firstFreeSeatOf(item)
  if (free === null) return 'full'
  return seatGuest(canvas, guestId, itemId, free)
}

/** Sends a guest back to Unassigned: every seat they hold in this canvas is emptied. */
export function unseatGuest(canvas: Canvas, guestId: string): SeatMove {
  const from = guestSeat(canvas, guestId)
  if (!from) return unchanged(canvas, null)
  const next = applySeats(canvas, new Map(), new Set([guestId]))
  return { canvas: next, changed: next !== canvas, seat: null, from, displaced: null }
}

/**
 * The Properties seat list: the guest in seat `fromIndex` goes to seat
 * `toIndex` of the same table, swapping with whoever sits there, as a drop
 * on the canvas does. Nothing changes when the first seat is empty.
 */
export function reorderWithinTable(canvas: Canvas, itemId: string, fromIndex: number, toIndex: number): SeatMove {
  const item = findSeatItem(canvas, itemId)
  const guestId = item?.seats[fromIndex]?.guestId ?? null
  if (!item || guestId === null) return unchanged(canvas, null)
  return seatGuest(canvas, guestId, itemId, toIndex)
}

// ---------------------------------------------------------------- where a drop lands

/** Chair centers of a ceremony row on the canvas, in seat order (as ChairRowView draws them). */
export function chairRowSeatCenters(row: Pick<ChairRow, 'x' | 'y' | 'rotation' | 'chairCount' | 'spacing'>): Point[] {
  const first = -chairRowLength(row) / 2 + SEAT_RADIUS_CM
  const r = (row.rotation * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  return Array.from({ length: row.chairCount }, (_, i) => {
    const lx = first + i * row.spacing
    return { x: row.x + lx * cos, y: row.y + lx * sin }
  })
}

/** Seat centers of a table or row on the canvas, in seat order. */
export function seatCenters(item: SeatItem): Point[] {
  if (item.kind === 'chairRow') return chairRowSeatCenters(item)
  return seatLayout(item).map((p) => ({ x: p.x, y: p.y }))
}

function insideFootprint(f: Footprint, p: Point): boolean {
  if (f.kind === 'circle') return len(p.x - f.x, p.y - f.y) <= f.r
  const r = (-f.rotation * Math.PI) / 180
  const dx = p.x - f.x
  const dy = p.y - f.y
  const lx = dx * Math.cos(r) - dy * Math.sin(r)
  const ly = dx * Math.sin(r) + dy * Math.cos(r)
  return Math.abs(lx) <= f.halfW && Math.abs(ly) <= f.halfH
}

function footprintReach(f: Footprint): number {
  return f.kind === 'circle' ? f.r : len(f.halfW, f.halfH)
}

export type DropTarget =
  /** A seat: empty, or taken by `occupant` (a swap). */
  | { kind: 'seat'; itemId: string; seatIndex: number; occupant: string | null }
  /** A table or row's first free seat (or the dragged guest's own seat at it). */
  | { kind: 'table'; itemId: string; seatIndex: number }
  /** A table or row with no free seat: the drop changes nothing ("Table 4 is full"). */
  | { kind: 'full'; itemId: string; label: string }
  | { kind: 'none' }

export type DropOptions = {
  /** The guest being dragged: a drop on their own table keeps their seat. */
  guestId?: string
  /** Items a drop may reach (visible, on an unlocked layer); all seat items when left out. */
  reachable?: (item: Item) => boolean
}

/**
 * Where a guest dropped at `point` (canvas cm) would land, at this zoom
 * (PLAN section 6, "Seating guests"):
 *
 *  1. Inside a seat circle (with a few pixels to spare at its edge): that
 *     seat, taken or empty. A taken seat swaps, so it is never reached from
 *     further away.
 *  2. On a table's top, or anywhere on its chair ring or a row: its first
 *     free seat (or the dragged guest's own seat there). A table or row with
 *     no free seat gives 'full'.
 *  3. Just outside the ring, near an empty seat (within 22 px on screen, so
 *     small seats are still easy to hit when zoomed out): that seat.
 *  4. Otherwise nothing.
 *
 * The topmost item wins where items overlap; the nearest seat where seats do.
 */
export function dropTarget(canvas: Pick<Canvas, 'items'>, point: Point, zoom: number, options: DropOptions = {}): DropTarget {
  const touch = Math.max(SEAT_RADIUS_CM, pxToCm(SEAT_TOUCH_RADIUS_PX, zoom))
  const inside = SEAT_RADIUS_CM + Math.min(pxToCm(SEAT_EDGE_TOLERANCE_PX, zoom), SEAT_EDGE_TOLERANCE_MAX_CM)
  let inCircle: { item: SeatItem; index: number; d: number } | null = null
  let nearEmpty: { item: SeatItem; index: number; d: number } | null = null
  let onTop: SeatItem | null = null
  let onRing: SeatItem | null = null
  const items = canvas.items
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (!isSeatItem(item) || (options.reachable && !options.reachable(item))) continue
    const ring = itemFootprint(item)
    const far = len(point.x - ring.x, point.y - ring.y) - footprintReach(ring)
    if (far > touch) continue
    if (item.seats.length > 0) {
      const centers = seatCenters(item)
      for (let s = 0; s < centers.length; s++) {
        const d = len(point.x - centers[s].x, point.y - centers[s].y)
        // Ties go to the topmost item, which comes first.
        if (d <= inside && (!inCircle || d < inCircle.d)) inCircle = { item, index: s, d }
        if (d <= touch && (item.seats[s]?.guestId ?? null) === null && (!nearEmpty || d < nearEmpty.d)) nearEmpty = { item, index: s, d }
      }
    }
    if (!onTop && item.kind === 'table' && insideFootprint(tableBodyFootprint(item), point)) onTop = item
    if (!onRing && insideFootprint(ring, point)) onRing = item
  }
  const seatTarget = (n: { item: SeatItem; index: number }): DropTarget => ({
    kind: 'seat',
    itemId: n.item.id,
    seatIndex: n.index,
    occupant: n.item.seats[n.index]?.guestId ?? null,
  })
  if (inCircle) return seatTarget(inCircle)
  if (onTop) return tableTarget(onTop, options.guestId)
  if (onRing) return tableTarget(onRing, options.guestId)
  if (nearEmpty) return seatTarget(nearEmpty)
  return { kind: 'none' }
}

function tableTarget(item: SeatItem, guestId: string | undefined): DropTarget {
  if (guestId !== undefined) {
    const own = item.seats.findIndex((s) => s.guestId === guestId)
    if (own !== -1) return { kind: 'table', itemId: item.id, seatIndex: own }
  }
  const free = firstFreeSeatOf(item)
  if (free === null) return { kind: 'full', itemId: item.id, label: itemLabel(item) }
  return { kind: 'table', itemId: item.id, seatIndex: free }
}

/** "Table 4 is full" */
export function fullMessage(label: string): string {
  return `${label} is full`
}

/**
 * Applies a drop: a seat seats (or swaps), a table takes its first free
 * seat, 'full' and 'none' change nothing.
 */
export function applyDrop(canvas: Canvas, guestId: string, target: DropTarget): SeatMove | 'full' {
  switch (target.kind) {
    case 'seat':
    case 'table':
      return seatGuest(canvas, guestId, target.itemId, target.seatIndex)
    case 'full':
      return 'full'
    case 'none':
      return unchanged(canvas, guestSeat(canvas, guestId))
  }
}
