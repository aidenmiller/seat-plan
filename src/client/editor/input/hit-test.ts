/**
 * What is under a point on the canvas, from the document alone (no DOM), so
 * the pointer controller can be tested without a browser. Handles and the +
 * and − buttons live in the overlay; the DOM adapter finds those by their
 * data attributes first.
 *
 * Items on hidden layers and on locked layers are not there for the pointer.
 * Topmost first: the last item in the canvas wins. A table's seats come
 * before its body, so a click on a seat circle is a seat.
 */
import type { Canvas, Item } from '@/domain/canvas-schema'
import { boxContainsPoint, boxSelects, expandBox, footprintBox, hitTestItem, type Box, type Point } from '@/domain/geometry'
import type { Handle } from '@/domain/resize'
import { seatIndexAt } from '@/domain/seats'
import type { LayerName, Layers } from '../state/device-view'

export type Target =
  | { kind: 'empty' }
  /** itemKind 'fixed': a venue template's fixed item, in the template editor. */
  | { kind: 'item'; itemId: string; itemKind: Item['kind'] | 'fixed'; locked: boolean }
  | { kind: 'seat'; itemId: string; seatIndex: number; guestId: string | null; locked: boolean }
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
  return target.kind === 'seat' || (target.kind === 'item' && target.itemKind === 'table')
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
