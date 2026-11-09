/**
 * Empties seats a layout must not keep (PLAN section 5, "Saving layouts"):
 *  - a seat held by a guest who was removed from the wedding ('removed-guest'),
 *  - a seat held by an id this wedding does not know ('unknown-guest'),
 *  - every seat after the first that a guest holds ('second-seat'). The first
 *    seat is the first by item order (drawing order), then by seat order.
 *
 * Pure: never changes its input. Items without a dropped seat are returned
 * as the same objects, so callers can compare by reference.
 */
import type { Canvas, Item, Seat } from './canvas-schema'
import type { DroppedSeat } from '@/shared/api'

export type { DroppedSeat }

export type SeatCleanup = { canvas: Canvas; dropped: DroppedSeat[] }

/**
 * @param liveGuestIds guests of this wedding who are not deleted
 * @param deletedGuestIds guests of this wedding who were removed; a seated id in
 *   neither set is unknown (a typo, another wedding's guest, a guest never saved)
 */
export function cleanSeats(
  canvas: Canvas,
  liveGuestIds: ReadonlySet<string>,
  deletedGuestIds: ReadonlySet<string> = new Set(),
): SeatCleanup {
  const seen = new Set<string>()
  const dropped: DroppedSeat[] = []
  let changed = false

  const items = canvas.items.map((item): Item => {
    if (item.kind !== 'table' && item.kind !== 'chairRow') return item
    let seats: Seat[] | null = null
    item.seats.forEach((seat, i) => {
      const guestId = seat.guestId
      if (guestId === null) return
      let reason: DroppedSeat['reason'] | null = null
      if (!liveGuestIds.has(guestId)) reason = deletedGuestIds.has(guestId) ? 'removed-guest' : 'unknown-guest'
      else if (seen.has(guestId)) reason = 'second-seat'
      else seen.add(guestId)
      if (reason === null) return
      dropped.push({ itemId: item.id, seatIndex: seat.index, guestId, reason })
      seats ??= item.seats.slice()
      seats[i] = { ...seat, guestId: null }
    })
    if (seats === null) return item
    changed = true
    return { ...item, seats }
  })

  return { canvas: changed ? { ...canvas, items } : canvas, dropped }
}

/** Every guest id that sits somewhere in the canvas, once each. */
export function seatedGuestIds(canvas: Canvas): string[] {
  const ids = new Set<string>()
  for (const item of canvas.items) {
    if (item.kind !== 'table' && item.kind !== 'chairRow') continue
    for (const seat of item.seats) if (seat.guestId !== null) ids.add(seat.guestId)
  }
  return [...ids]
}
