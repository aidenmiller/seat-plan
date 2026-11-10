/**
 * The menu for guests selected on the canvas (PLAN section 6, "Selection"):
 * right click, a long press or the More button beside selected seats: Keep
 * together and Keep apart (EditorShell, through `extensions`; two or more
 * guests), Add to group and Unseat. Edit mode only: in View mode nothing on the plan
 * changes, so there is no guest menu.
 *
 * Items match ContextMenuItem (src/client/ui/ContextMenu.tsx), so the page
 * can hand them straight to <ContextMenu>.
 */
import type { Canvas } from '@/domain/canvas-schema'
import { isSeatItem } from '@/domain/seating'
import type { EditorMode, SeatRef } from '../state/ui-store'

export type GuestMenuItem = { id: string; label: string; onSelect(): void; disabled?: boolean; danger?: boolean }

/** Adds items for the selected guests; milestone 6's Keep together and Keep apart come in this way. */
export type GuestMenuExtension = (guestIds: readonly string[]) => readonly GuestMenuItem[]

export type GuestMenuInput = {
  /** The selected guests. */
  guestIds: readonly string[]
  mode: EditorMode
  /** Sends them to Unassigned, as one undo step. */
  unseat(guestIds: readonly string[]): void
  /** Opens the page's group picker for these guests; leave out to hide Add to group. */
  onAddToGroup?(guestIds: readonly string[]): void
  /** Items shown before Add to group and Unseat, in order. */
  extensions?: readonly GuestMenuExtension[]
}

export type GuestMenu = { label: string; items: GuestMenuItem[] }

/** "Guest menu", "3 guests menu" */
export function guestMenuLabel(count: number): string {
  return count === 1 ? 'Guest menu' : `${count} guests menu`
}

export function guestMenu(input: GuestMenuInput): GuestMenu | null {
  const ids = [...new Set(input.guestIds)]
  if (input.mode !== 'edit' || ids.length === 0) return null
  const items: GuestMenuItem[] = []
  for (const extend of input.extensions ?? []) items.push(...extend(ids))
  if (input.onAddToGroup) {
    const add = input.onAddToGroup
    items.push({ id: 'addToGroup', label: 'Add to group', onSelect: () => add(ids) })
  }
  items.push({ id: 'unseat', label: 'Unseat', onSelect: () => input.unseat(ids) })
  return { label: guestMenuLabel(ids.length), items }
}

/** The guests in the selected seats, in selection order, each once. Empty seats are skipped. */
export function guestIdsAtSeats(canvas: Pick<Canvas, 'items'>, seats: readonly SeatRef[]): string[] {
  const byId = new Map(canvas.items.map((i) => [i.id, i]))
  const out: string[] = []
  for (const s of seats) {
    const item = byId.get(s.itemId)
    if (!item || !isSeatItem(item)) continue
    const g = item.seats[s.seatIndex]?.guestId ?? null
    if (g !== null && !out.includes(g)) out.push(g)
  }
  return out
}
