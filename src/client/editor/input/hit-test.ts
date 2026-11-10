/**
 * What is under a point on the canvas, from the document alone (no DOM), so
 * the pointer controller can be tested without a browser. Handles and the +
 * and − buttons live in the overlay; the DOM adapter finds those by their
 * data attributes first.
 *
 * Items on hidden layers and on locked layers are not there for the pointer.
 * Topmost first: the last item in the canvas wins. A table's seats, and a
 * ceremony row's chairs, come before its body, so a click on a seat circle
 * is a seat.
 */
import type { Canvas, ChairRow, Item } from '@/domain/canvas-schema'
import { boxContainsPoint, boxSelects, expandBox, footprintBox, hitTestItem, type Box, type Point } from '@/domain/geometry'
import type { Handle } from '@/domain/resize'
import { chairRowSeatCenters } from '@/domain/seating'
import { seatIndexAt, SEAT_RADIUS_CM } from '@/domain/seats'
import type { LayerName, Layers } from '../state/device-view'

export type Target =
  | { kind: 'empty' }
  /** itemKind 'fixed': a venue template's fixed item, in the template editor. */
  | { kind: 'item'; itemId: string; itemKind: Item['kind'] | 'fixed'; locked: boolean }
  /**
   * A seat of a table or a ceremony chair row (itemKind 'chairRow'; left out
   * for tables). plus: an empty seat's + (Edit mode, close and middle level):
   * a tap opens its guest picker.
   */
  | { kind: 'seat'; itemId: string; seatIndex: number; guestId: string | null; locked: boolean; plus?: boolean; itemKind?: 'table' | 'chairRow' }
  | { kind: 'handle'; itemId: string; handle: Handle }
  | { kind: 'rotate'; itemId: string }
  /** A point of a wall, room, zone or patio edge (template editor only); dragged like a handle. */
  | { kind: 'vertex'; itemId: string; index: number }

export const EMPTY_TARGET: Target = Object.freeze({ kind: 'empty' })

/** The layer an item draws on. The venue layer holds the template's fixed items, which are not canvas items. */
export function itemLayer(item: Item): LayerName {
  return item.kind === 'note' ? 'notes' : 'furniture'
}

export function isVisible(item: Item, layers?: Layers): boolean {
  return !layers || layers[itemLayer(item)].visible
}

/** Visible and on an unlocked layer: the pointer can reach it. */
export function isReachable(item: Item, layers?: Layers): boolean {
  if (!layers) return true
  const layer = layers[itemLayer(item)]
  return layer.visible && !layer.locked
}

/** True for a target on a table: its body or one of its seats. */
export function isTableTarget(target: Target): boolean {
  if (target.kind === 'seat') return target.itemKind !== 'chairRow'
  return target.kind === 'item' && target.itemKind === 'table'
}

/** The chair of a ceremony row within `tolerance` of its circle, nearest first, or null. */
export function chairIndexAt(row: ChairRow, point: Point, tolerance = 0): number | null {
  const centers = chairRowSeatCenters(row)
  let best: number | null = null
  let bestD = SEAT_RADIUS_CM + tolerance
  for (let i = 0; i < centers.length; i++) {
    const d = Math.hypot(point.x - centers[i].x, point.y - centers[i].y)
    if (d <= bestD) {
      best = i
      bestD = d
    }
  }
  return best
}

/** The item id a target belongs to, if any. */
export function targetItemId(target: Target): string | null {
  return target.kind === 'empty' ? null : target.itemId
}

export type HitOptions = {
  /** Extra reach in cm: a few screen pixels over the zoom. */
  tolerance?: number
  layers?: Layers
}

/** The item or seat under a world point, topmost first. */
export function hitTest(canvas: Pick<Canvas, 'items'>, point: Point, options: HitOptions = {}): Target {
  const tolerance = options.tolerance ?? 0
  const items = canvas.items
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (!isReachable(item, options.layers)) continue
    if (!boxContainsPoint(expandBox(footprintBox(item), tolerance), point)) continue
    if (item.kind === 'table' && item.seatCount > 0) {
      const seatIndex = seatIndexAt(item, point, tolerance)
      if (seatIndex !== null) {
        return { kind: 'seat', itemId: item.id, seatIndex, guestId: item.seats[seatIndex]?.guestId ?? null, locked: item.locked }
      }
    }
    if (item.kind === 'chairRow' && item.chairCount > 0) {
      const seatIndex = chairIndexAt(item, point, tolerance)
      if (seatIndex !== null) {
        return { kind: 'seat', itemId: item.id, seatIndex, guestId: item.seats[seatIndex]?.guestId ?? null, locked: item.locked, itemKind: 'chairRow' }
      }
    }
    if (hitTestItem(item, point, tolerance)) return { kind: 'item', itemId: item.id, itemKind: item.kind, locked: item.locked }
  }
  return EMPTY_TARGET
}

/** Unlocked items a selection box holds whole. Locked items are left out, so a box never grabs a room outline. */
export function itemsInBox(canvas: Pick<Canvas, 'items'>, box: Box, layers?: Layers): string[] {
  return canvas.items.filter((item) => !item.locked && isReachable(item, layers) && boxSelects(box, item)).map((item) => item.id)
}

/** Everything Select all takes: items the pointer can reach. */
export function selectableIds(canvas: Pick<Canvas, 'items'>, layers?: Layers): string[] {
  return canvas.items.filter((item) => isReachable(item, layers)).map((item) => item.id)
}
