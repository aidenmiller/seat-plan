/**
 * What is under a point on the canvas, from the document alone (no DOM), so
 * the pointer controller can be tested without a browser. Handles and the +
 * and − buttons live in the overlay; the DOM adapter finds those by their
 * data attributes first.
 *
 * Items on hidden and locked layers are not there for the pointer: a click
 * on a locked note lands on what is under it (DECISIONS 90). The editor
 * passes the layers with their locks off in View mode, where nothing
 * changes, so a tap there still reads a note. Topmost first: notes before
 * furniture, then the last item in the canvas wins. A table's seats, and a
 * ceremony row's chairs, come before its body, so a click on a seat circle
 * is a seat. Arrows are tested where they are drawn, their attached ends on
 * their items (src/domain/arrows.ts).
 */
import type { Canvas, ChairRow, Item } from '@/domain/canvas-schema'
import { isArrowNote, resolvedItems } from '@/domain/arrows'
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

/** On a locked layer: it draws, but the pointer goes through it and nothing on it changes. */
export function isLayerLocked(item: Item, layers?: Layers): boolean {
  return !!layers && layers[itemLayer(item)].locked
}

/** Visible and on an unlocked layer: the pointer can reach it. */
export function isReachable(item: Item, layers?: Layers): boolean {
  if (!layers) return true
  const layer = layers[itemLayer(item)]
  return layer.visible && !layer.locked
}

/** The same layers with every lock off (View mode, where nothing changes, reads locked notes too). */
export function unlockedLayers(layers: Layers): Layers {
  return {
    venue: { ...layers.venue, locked: false },
    furniture: { ...layers.furniture, locked: false },
    notes: { ...layers.notes, locked: false },
  }
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
  /** Reach for arrows and lines in cm, when more than `tolerance`: a finger is wider than their line. */
  lineTolerance?: number
  layers?: Layers
}

/**
 * The item or seat under a world point, topmost first: notes before
 * furniture, since the notes layer draws above it whatever the item order.
 * Items on hidden or locked layers are passed over.
 */
export function hitTest(canvas: Pick<Canvas, 'items'>, point: Point, options: HitOptions = {}): Target {
  const items = resolvedItems(canvas)
  return hitLayer(items, point, options, 'notes') ?? hitLayer(items, point, options, 'furniture') ?? EMPTY_TARGET
}

function hitLayer(items: readonly Item[], point: Point, options: HitOptions, layer: LayerName): Target | null {
  const base = options.tolerance ?? 0
  const lineReach = Math.max(base, options.lineTolerance ?? 0)
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (itemLayer(item) !== layer || !isReachable(item, options.layers)) continue
    const tolerance = isArrowNote(item) ? lineReach : base
    if (!boxContainsPoint(expandBox(footprintBox(item), tolerance), point)) continue
    const locked = item.locked
    if (item.kind === 'table' && item.seatCount > 0) {
      const seatIndex = seatIndexAt(item, point, tolerance)
      if (seatIndex !== null) {
        return { kind: 'seat', itemId: item.id, seatIndex, guestId: item.seats[seatIndex]?.guestId ?? null, locked }
      }
    }
    if (item.kind === 'chairRow' && item.chairCount > 0) {
      const seatIndex = chairIndexAt(item, point, tolerance)
      if (seatIndex !== null) {
        return { kind: 'seat', itemId: item.id, seatIndex, guestId: item.seats[seatIndex]?.guestId ?? null, locked, itemKind: 'chairRow' }
      }
    }
    if (hitTestItem(item, point, tolerance)) return { kind: 'item', itemId: item.id, itemKind: item.kind, locked }
  }
  return null
}

/**
 * Unlocked items a selection box holds whole, arrows by their ends as drawn.
 * Locked items and locked layers are left out, so a box never grabs a room
 * outline.
 */
export function itemsInBox(canvas: Pick<Canvas, 'items'>, box: Box, layers?: Layers): string[] {
  return resolvedItems(canvas)
    .filter((item) => !item.locked && isReachable(item, layers) && boxSelects(box, item))
    .map((item) => item.id)
}

/** Everything Select all takes: items the pointer can reach. */
export function selectableIds(canvas: Pick<Canvas, 'items'>, layers?: Layers): string[] {
  return canvas.items.filter((item) => isReachable(item, layers)).map((item) => item.id)
}
