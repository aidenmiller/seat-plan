/**
 * Where a dragged guest lands and what the drop does (spec section 4,
 * "Seating guests"; PLAN section 6). Pure: the seating controller feeds it
 * client points, the camera and the page's drop zones.
 *
 *  - Over the side list (any of its zones, which win over the canvas they
 *    may cover, like a phone's bottom sheet): 'list'. A seated guest dropped
 *    there is unseated; a guest from the list stays as they were.
 *  - Over the canvas: domain dropTarget at that world point. A seat (swap
 *    when taken), a table's first free seat, 'full' ("Table 4 is full"),
 *    or nothing.
 *  - Anywhere else: nothing.
 */
import type { Canvas, Item } from '@/domain/canvas-schema'
import { screenToWorld, type Camera } from '@/domain/camera'
import type { Point } from '@/domain/geometry'
import { dropTarget, fullMessage, seatGuest, unseatGuest, type DropTarget, type SeatMove, type SeatRef } from '@/domain/seating'

/** A box on the page, in client px. */
export type ClientRect = { left: number; top: number; width: number; height: number }

export type DragTarget = DropTarget | { kind: 'list' }

export const NO_TARGET: DragTarget = Object.freeze({ kind: 'none' })
export const LIST_TARGET: DragTarget = Object.freeze({ kind: 'list' })

export function rectContains(r: ClientRect, p: Point): boolean {
  return p.x >= r.left && p.x <= r.left + r.width && p.y >= r.top && p.y <= r.top + r.height
}

export type ResolveInput = {
  canvas: Pick<Canvas, 'items'>
  camera: Camera
  /** The canvas viewport on the page. Screen points are client points less its top left. */
  viewport: ClientRect
  /** The side list's drop zones (the panel, the phone's sheet). */
  listZones: readonly ClientRect[]
  /** The pointer, client px. */
  client: Point
  guestId: string
  /** Items a drop may reach (visible, on an unlocked layer). */
  reachable?: (item: Item) => boolean
}

/** The world point under a client point, through the viewport's top left. */
export function clientToWorld(camera: Camera, viewport: Pick<ClientRect, 'left' | 'top'>, client: Point): Point {
  return screenToWorld(camera, { x: client.x - viewport.left, y: client.y - viewport.top })
}

export function resolveDragTarget(input: ResolveInput): DragTarget {
  if (input.listZones.some((z) => rectContains(z, input.client))) return LIST_TARGET
  if (!rectContains(input.viewport, input.client)) return NO_TARGET
  const world = clientToWorld(input.camera, input.viewport, input.client)
  return dropTarget(input.canvas, world, input.camera.zoom, { guestId: input.guestId, reachable: input.reachable })
}

/** The seat that grows while dragging: the seat under the pointer, or the table's first free seat. */
export function targetSeat(target: DragTarget): SeatRef | null {
  return target.kind === 'seat' || target.kind === 'table' ? { itemId: target.itemId, seatIndex: target.seatIndex } : null
}

/** True when two targets are the same place, so the store need not change. */
export function sameTarget(a: DragTarget, b: DragTarget): boolean {
  if (a.kind !== b.kind) return false
  switch (a.kind) {
    case 'none':
    case 'list':
      return true
    case 'full':
      return a.itemId === (b as typeof a).itemId
    case 'seat': {
      const o = b as typeof a
      return a.itemId === o.itemId && a.seatIndex === o.seatIndex && a.occupant === o.occupant
    }
    case 'table': {
      const o = b as typeof a
      return a.itemId === o.itemId && a.seatIndex === o.seatIndex
    }
  }
}

export type DropPlan =
  /** A change to make, as one undo step with this label. */
  | { kind: 'change'; label: string; move: SeatMove }
  /** Nothing to do: the guest is already there, or dropped nowhere. */
  | { kind: 'none' }
  /** A full table: show this message ("Table 4 is full"). */
  | { kind: 'full'; message: string }

/** The undo label for a seat change. */
export function seatLabel(move: SeatMove): string {
  if (move.seat === null) return 'Unseat guest'
  if (move.displaced && move.displaced.to !== null) return 'Swap guests'
  return move.from ? 'Move guest' : 'Seat guest'
}

/** What dropping `guestId` (seated at `from`, or from the list) on `target` does to `canvas`. */
export function planDrop(canvas: Canvas, guestId: string, target: DragTarget): DropPlan {
  switch (target.kind) {
    case 'none':
      return { kind: 'none' }
    case 'full':
      return { kind: 'full', message: fullMessage(target.label) }
    case 'list': {
      const move = unseatGuest(canvas, guestId)
      return move.changed ? { kind: 'change', label: 'Unseat guest', move } : { kind: 'none' }
    }
    case 'seat':
    case 'table': {
      const move = seatGuest(canvas, guestId, target.itemId, target.seatIndex)
      return move.changed ? { kind: 'change', label: seatLabel(move), move } : { kind: 'none' }
    }
  }
}
