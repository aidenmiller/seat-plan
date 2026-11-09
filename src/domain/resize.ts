/**
 * Resizing and turning items by their handles (spec section 4, "Adding and
 * editing shapes"; DECISIONS 11).
 *
 * Every function takes the item as it was when the drag started and the
 * pointer now, and returns the item as it should look now, so a drag never
 * drifts from rounding. Handles work in the item's own (rotated) frame.
 *
 * Tables keep their seat count. When a resize changes how seats are shared
 * between sides, each seated guest moves to the nearest new seat (DECISIONS 9).
 */
import { MIN_TABLE_CM, type Item, type Table } from './canvas-schema'
import { distance, localToWorld, normalizeDegrees, radToDeg, worldToLocal, type Point } from './geometry'
import { remapSeats } from './seats'

export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'
export const HANDLES: readonly Handle[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']
/** Items other than tables stay at least this big on each side. */
export const MIN_ITEM_CM = 10
/**
 * The longest a table side gets from a drag: 120 ft, what the seat cap
 * (60 seats at 24 in) needs along one side. Well inside the schema's limit.
 */
export const MAX_TABLE_CM = 3657.6
/** Anything else stops at the schema's limit on a length. */
export const MAX_ITEM_CM = 1_000_000
export const ROTATION_SNAP_DEGREES = 15
/** How far above the item's top edge the rotate handle sits, in screen pixels. */
export const ROTATE_HANDLE_OFFSET_PX = 28

export type ResizeOptions = {
  /** Shift on a handle, or the Keep proportions switch. Round tables always keep theirs. */
  keepRatio?: boolean
  /** Resize about the center instead of keeping the opposite edge or corner still. */
  fromCenter?: boolean
  /** The smallest side, in cm. Defaults to 24 in for tables and 10 cm for everything else. */
  minCm?: number
  /**
   * Snapping on: the width and height the handle changes are rounded to whole
   * grid steps (in the item's own frame, the anchor edge kept), so 36, 48
   * and 72 in tables are reachable on a 1 ft grid. 0 or missing: the raw size (Alt).
   */
  gridStep?: number
}

/** Items that handles can resize: everything with a width and height. */
export type Resizable = Exclude<Item, { kind: 'chairRow' }>

export function isResizable(item: Item): item is Resizable {
  return item.kind !== 'chairRow'
}

function minSide(item: Item, minCm?: number): number {
  const floor = item.kind === 'table' ? MIN_TABLE_CM : MIN_ITEM_CM
  return minCm === undefined ? floor : Math.max(minCm, item.kind === 'table' ? MIN_TABLE_CM : 0)
}

function maxSide(item: Item): number {
  return item.kind === 'table' ? MAX_TABLE_CM : MAX_ITEM_CM
}

/** Clears float noise (3 * 30.48 is 91.44000000000001). */
function clean(value: number): number {
  return Math.round(value * 1e6) / 1e6
}

/** The nearest whole number of grid steps, never none. */
function toGrid(value: number, step: number): number {
  return clean(Math.max(1, Math.round(value / step)) * step)
}

function handleSigns(handle: Handle): { hx: -1 | 0 | 1; hy: -1 | 0 | 1 } {
  return {
    hx: handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0,
    hy: handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0,
  }
}

/** The handle's place on the item's body, on the canvas. */
export function handlePoint(item: Item, handle: Handle): Point {
  if (!isResizable(item)) return { x: item.x, y: item.y }
  const { hx, hy } = handleSigns(handle)
  return localToWorld(item, { x: (hx * item.width) / 2, y: (hy * item.height) / 2 })
}

/** Where the rotate handle sits: above the item's top edge, turned with it. */
export function rotateHandlePoint(item: Item, zoom: number): Point {
  const height = isResizable(item) ? item.height : 45
  return localToWorld(item, { x: 0, y: -height / 2 - ROTATE_HANDLE_OFFSET_PX / Math.max(zoom, 1e-6) })
}

/**
 * The item with its size changed by dragging `handle` to `pointer` (canvas cm).
 * The opposite edge or corner stays put, or the center with `fromCenter`.
 * The size never goes below the minimum or past the maximum, and a handle
 * dragged past the far side stops there rather than flipping the item. With
 * a grid step, the raw size is rounded to whole steps: each side the handle
 * moves, or with proportions kept the side it drags (the wider one from a
 * corner), the other following.
 */
export function resizeByHandle<T extends Item>(item: T, handle: Handle, pointer: Point, options: ResizeOptions = {}): T {
  if (!isResizable(item)) return item
  const w0 = item.width
  const h0 = item.height
  const { hx, hy } = handleSigns(handle)
  const p = worldToLocal(item, pointer)
  const fromCenter = options.fromCenter === true
  const round = item.kind === 'table' && item.shape === 'round'
  const keepRatio = options.keepRatio === true || round
  const min = minSide(item, options.minCm)
  const max = Math.max(maxSide(item), min)
  const step = options.gridStep !== undefined && options.gridStep > 0 ? options.gridStep : 0

  // The fixed edge on each moving axis, in the item's frame.
  const anchorX = fromCenter ? 0 : -hx * (w0 / 2)
  const anchorY = fromCenter ? 0 : -hy * (h0 / 2)
  const reach = (value: number, anchor: number, sign: number) => (fromCenter ? 2 * sign * value : sign * (value - anchor))
  let w = hx === 0 ? w0 : reach(p.x, anchorX, hx)
  let h = hy === 0 ? h0 : reach(p.y, anchorY, hy)

  if (keepRatio) {
    let scale: number
    if (hx !== 0 && hy !== 0) scale = Math.max(w / w0, h / h0)
    else if (hx !== 0) scale = w / w0
    else scale = h / h0
    if (step > 0) {
      const byWidth = hx !== 0 && (hy === 0 || w0 >= h0)
      scale = byWidth ? toGrid(w0 * scale, step) / w0 : toGrid(h0 * scale, step) / h0
    }
    scale = Math.min(Math.max(scale, min / w0, min / h0), max / w0, max / h0)
    w = step > 0 ? clean(w0 * scale) : w0 * scale
    h = step > 0 ? clean(h0 * scale) : h0 * scale
  } else if (step > 0) {
    if (hx !== 0) w = toGrid(w, step)
    if (hy !== 0) h = toGrid(h, step)
  }
  // Also clears float noise from a scale clamped to the minimum (60.959999...).
  w = Math.min(Math.max(w, min), max)
  h = round ? w : Math.min(Math.max(h, min), max)

  // The new center in the item's frame: the anchor plus half the new size,
  // on each axis the handle moves; the old center on the others.
  const cx = fromCenter || hx === 0 ? 0 : anchorX + (hx * w) / 2
  const cy = fromCenter || hy === 0 ? 0 : anchorY + (hy * h) / 2
  return withSize(item, w, h, localToWorld(item, { x: cx, y: cy })) as T
}

/** How far a body resize measures its scale against: a round table's radius, else half the diagonal. */
function bodyReach(item: Resizable): number {
  if (item.kind === 'table' && item.shape === 'round') return item.width / 2
  return Math.hypot(item.width, item.height) / 2
}

/**
 * Shift+drag on a body: resizes about the center, keeping proportions. The
 * pointer's outward movement (its distance from the center now, less at the
 * start) is measured against the larger of its distance at the start and
 * the table's reach (radius, or half its diagonal), so a press near the
 * center does not make the size jump, and the edge or corner follows the
 * pointer. Sizes stay between the minimum and the maximum.
 */
export function resizeFromCenterByDrag<T extends Item>(item: T, startPointer: Point, pointer: Point, options: Pick<ResizeOptions, 'minCm'> = {}): T {
  if (!isResizable(item)) return item
  const start = distance(startPointer, item)
  const reachCm = Math.max(start, bodyReach(item))
  if (reachCm < 1e-6) return item
  const min = minSide(item, options.minCm)
  const max = Math.max(maxSide(item), min)
  const grown = 1 + (distance(pointer, item) - start) / reachCm
  const scale = Math.min(Math.max(grown, min / item.width, min / item.height), max / item.width, max / item.height)
  const w = Math.min(Math.max(clean(item.width * scale), min), max)
  const h = item.kind === 'table' && item.shape === 'round' ? w : Math.min(Math.max(clean(item.height * scale), min), max)
  if (w === item.width && h === item.height) return item
  return withSize(item, w, h, { x: item.x, y: item.y }) as T
}

/** The item at a new size and center; points scale with it, and table guests keep their places. */
function withSize(item: Resizable, width: number, height: number, center: Point): Resizable {
  const sx = width / item.width
  const sy = height / item.height
  switch (item.kind) {
    case 'table': {
      const next: Table = { ...item, x: center.x, y: center.y, width, height }
      return { ...next, seats: remapSeats(item, next).canvasSeats }
    }
    case 'shape':
    case 'note': {
      const moved = { ...item, x: center.x, y: center.y, width, height }
      return item.points ? { ...moved, points: item.points.map((p) => ({ x: p.x * sx, y: p.y * sy })) } : moved
    }
    default:
      return { ...item, x: center.x, y: center.y, width, height }
  }
}

/** An angle snapped to `step` degrees, in [0, 360). */
export function snapAngle(degrees: number, step: number = ROTATION_SNAP_DEGREES): number {
  if (!(step > 0)) return normalizeDegrees(degrees)
  return normalizeDegrees(Math.round(degrees / step) * step)
}

/**
 * The item turned so its top faces the pointer: the rotate handle sits above
 * the item, so a pointer straight above means no turn. Snaps to 15° steps
 * unless `snapDegrees` is null (Alt held).
 */
export function rotateByHandle<T extends Item>(item: T, pointer: Point, options: { snapDegrees?: number | null } = {}): T {
  const dx = pointer.x - item.x
  const dy = pointer.y - item.y
  if (Math.hypot(dx, dy) < 1e-6) return item
  const raw = radToDeg(Math.atan2(dy, dx)) + 90
  const snap = options.snapDegrees === undefined ? ROTATION_SNAP_DEGREES : options.snapDegrees
  const rotation = snap === null ? normalizeDegrees(raw) : snapAngle(raw, snap)
  return { ...item, rotation }
}
