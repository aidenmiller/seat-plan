/**
 * The + on empty seats (spec section 4, "Seating guests"): at the close and
 * middle detail levels, in Edit mode, each empty seat circle shows a small
 * + that opens a short list of unassigned guests to seat there. Pure.
 *
 * Every empty seat gets one. The + is drawn in the world SVG inside the seat
 * circle (TableView, ChairRowView) and shown by CSS for the level and mode,
 * so 400 empty seats cost nothing per camera frame. Presses find it here,
 * from the seat geometry: within 22 px of an empty seat's center on screen
 * (a 44 px target), except where a taken seat is under the pointer (the
 * editor controller checks that first), so its guest can still be picked
 * up or selected.
 */
import type { Canvas, Item } from '@/domain/canvas-schema'
import { screenToWorld, type Camera } from '@/domain/camera'
import type { DetailLevel } from '@/domain/detail-level'
import { boxContainsPoint, expandBox, footprintBox, type Point } from '@/domain/geometry'
import { isSeatItem, seatCenters } from '@/domain/seating'
import type { EditorMode } from '../state/ui-store'

/** The + takes presses this far from the seat's center (a 44 px target). */
export const PLUS_HIT_RADIUS_PX = 22

export type PlusSeat = { itemId: string; seatIndex: number; world: Point }

export type PlusInput = {
  canvas: Pick<Canvas, 'items'>
  camera: Camera
  level: DetailLevel
  mode: EditorMode
  /** Items the pointer can reach (visible, on an unlocked layer). */
  reachable?: (item: Item) => boolean
}

/** True when the + shows at this level and mode: Edit mode, close or middle level. */
export function plusShows(mode: EditorMode, level: DetailLevel): boolean {
  return mode === 'edit' && level !== 'far'
}

/** The empty seat whose + is under a screen point (the nearest within 22 px), or null. Topmost item first on a tie. */
export function plusSeatAt(input: PlusInput, screen: Point): PlusSeat | null {
  if (!plusShows(input.mode, input.level)) return null
  const zoom = input.camera.zoom
  if (!(zoom > 0)) return null
  const reach = PLUS_HIT_RADIUS_PX / zoom
  const world = screenToWorld(input.camera, screen)
  let best: PlusSeat | null = null
  let bestD = reach
  const items = input.canvas.items
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (!isSeatItem(item) || (input.reachable && !input.reachable(item))) continue
    if (!item.seats.some((s) => s.guestId === null)) continue
    if (!boxContainsPoint(expandBox(footprintBox(item), reach), world)) continue
    const centers = seatCenters(item)
    for (let s = 0; s < centers.length; s++) {
      if ((item.seats[s]?.guestId ?? null) !== null) continue
      const d = Math.hypot(centers[s].x - world.x, centers[s].y - world.y)
      if (d < bestD || (best === null && d <= bestD)) {
        best = { itemId: item.id, seatIndex: s, world: centers[s] }
        bestD = d
      }
    }
  }
  return best
}
