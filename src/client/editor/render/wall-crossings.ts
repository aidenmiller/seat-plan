/**
 * Which tables a venue wall runs through, for the layout editor's red
 * outlines and the Problems tab (spec section 5; DECISIONS 15: worked out
 * when the layout opens and after each move, never stored). The wall index
 * is built once per template, and the answer once per canvas version, so
 * every table's component reads the same set during a drag.
 */
import type { Item } from '@/domain/canvas-schema'
import type { FixedItem } from '@/domain/venue-schema'
import { buildWallIndex, tableWallHits, type WallIndex } from '@/domain/walls'

const NONE: ReadonlySet<string> = new Set()

const cache = new WeakMap<readonly FixedItem[], { index: WallIndex; byItems: WeakMap<readonly Item[], ReadonlySet<string>> }>()

/** The ids of the tables a wall of `venue` runs through. */
export function crossedTables(items: readonly Item[], venue: readonly FixedItem[]): ReadonlySet<string> {
  if (venue.length === 0) return NONE
  let entry = cache.get(venue)
  if (!entry) {
    entry = { index: buildWallIndex(venue), byItems: new WeakMap() }
    cache.set(venue, entry)
  }
  if (entry.index.segments.length === 0) return NONE
  let set = entry.byItems.get(items)
  if (!set) {
    const ids = new Set<string>()
    for (const item of items) if (item.kind === 'table' && tableWallHits(item, entry.index).length > 0) ids.add(item.id)
    set = ids.size === 0 ? NONE : ids
    entry.byItems.set(items, set)
  }
  return set
}
