/**
 * Group highlighting in the editor (spec section 7, "Groups": "pick one to
 * three groups to show. Their seated members get a ring in the group color
 * and everyone else fades"; PLAN section 7, "Groups and closeness").
 *
 *  - Up to three groups, in the order chosen. Ids of deleted groups drop out.
 *  - Each seat held by a member of a chosen group gets a ring in that
 *    group's color. A guest in several chosen groups gets the color of the
 *    first one chosen.
 *  - While any group is chosen, everything else fades, even when none of the
 *    chosen groups has anyone seated yet.
 *
 * Works for tables and ceremony chair rows alike. Pure.
 */
import type { Canvas } from './canvas-schema'
import { seatKey } from './rules'
import { isSeatItem } from './seating'

export const MAX_HIGHLIGHT_GROUPS = 3

/** What highlighting reads from a group. */
export type HighlightGroup = { id: string; color: string; memberIds: readonly string[] }

export type SeatRing = { itemId: string; seatIndex: number; guestId: string; groupId: string; color: string }

export type GroupHighlight = {
  /** The chosen groups that exist, at most three, in the order chosen. */
  groupIds: string[]
  /** True while any group is chosen: every seat without a ring fades. */
  fade: boolean
  /** Rings by seatKey(itemId, seatIndex). */
  rings: Map<string, SeatRing>
  /** Tables and rows with at least one ring. */
  itemIds: Set<string>
  /** Seated members of each chosen group (whatever color their ring took), for "none seated" notes. */
  seatedCount: Map<string, number>
}

/** The chosen ids that name a group, each once, at most three, in the order chosen. */
export function cleanHighlight(chosen: readonly string[], groups: readonly Pick<HighlightGroup, 'id'>[]): string[] {
  const exists = new Set(groups.map((g) => g.id))
  const out: string[] = []
  for (const id of chosen) {
    if (out.length >= MAX_HIGHLIGHT_GROUPS) break
    if (exists.has(id) && !out.includes(id)) out.push(id)
  }
  return out
}

/** True when another group can be chosen. */
export function canAddHighlight(chosen: readonly string[]): boolean {
  return chosen.length < MAX_HIGHLIGHT_GROUPS
}

/**
 * Picks or unpicks a group. A chosen group comes off; another goes on the
 * end while fewer than three are chosen, and is refused (the same list comes
 * back) when three already are.
 */
export function toggleHighlight(chosen: readonly string[], groupId: string): readonly string[] {
  if (chosen.includes(groupId)) return chosen.filter((id) => id !== groupId)
  if (!canAddHighlight(chosen)) return chosen
  return [...chosen, groupId]
}

/** The rings and fading for the chosen groups on this canvas. */
export function groupHighlight(canvas: Pick<Canvas, 'items'>, groups: readonly HighlightGroup[], chosen: readonly string[]): GroupHighlight {
  const groupIds = cleanHighlight(chosen, groups)
  const byId = new Map(groups.map((g) => [g.id, g]))
  // Each guest's ring: the first chosen group that holds them.
  const ringOf = new Map<string, HighlightGroup>()
  for (const id of groupIds) {
    const group = byId.get(id)!
    for (const guestId of group.memberIds) if (!ringOf.has(guestId)) ringOf.set(guestId, group)
  }
  const rings = new Map<string, SeatRing>()
  const itemIds = new Set<string>()
  const seated = new Set<string>()
  if (ringOf.size > 0) {
    for (const item of canvas.items) {
      if (!isSeatItem(item)) continue
      item.seats.forEach((seat, seatIndex) => {
        const guestId = seat.guestId
        if (guestId === null) return
        const group = ringOf.get(guestId)
        if (!group) return
        rings.set(seatKey(item.id, seatIndex), { itemId: item.id, seatIndex, guestId, groupId: group.id, color: group.color })
        itemIds.add(item.id)
        seated.add(guestId)
      })
    }
  }
  const seatedCount = new Map<string, number>()
  for (const id of groupIds) {
    let n = 0
    for (const guestId of new Set(byId.get(id)!.memberIds)) if (seated.has(guestId)) n++
    seatedCount.set(id, n)
  }
  return { groupIds, fade: groupIds.length > 0, rings, itemIds, seatedCount }
}

/** The ring for one seat, if any. */
export function seatRing(highlight: GroupHighlight, itemId: string, seatIndex: number): SeatRing | null {
  return highlight.rings.get(seatKey(itemId, seatIndex)) ?? null
}

/** True when this seat fades: a group is chosen and the seat has no ring. */
export function seatFaded(highlight: GroupHighlight, itemId: string, seatIndex: number): boolean {
  return highlight.fade && !highlight.rings.has(seatKey(itemId, seatIndex))
}
