/**
 * React access to the seating tools (controller.ts). Each hook reads one
 * small piece of the seating store, so a drag re-renders only the tables
 * whose tint or target seat changes, and the panels only when a drag, a
 * pick, a card or the picker starts or ends.
 *
 * For the renderer (TableView and friends):
 *  - useDragTint(itemId): 'good' (green: partner or group there), 'bad'
 *    (red: a rule would break), 'none', or null with no drag.
 *  - useDropTargetSeat(itemId): the seat index that grows and gets an
 *    outline, or null.
 *  - useDragOrigin(itemId): the dragged guest's own seat at this table, or null.
 *  - useSeatPulse(itemId): { seatIndex, id } for two seconds after a pan to
 *    a seat (id changes each time, to restart the animation), or null.
 *  - useSeatInitials(seats): each seat's guest's initials (middle level), or
 *    null for an empty seat or a guest not in the list yet.
 *  - useSeatLabels(tableId): the table's names at close level.
 *
 * For the panels:
 *  - useGuestDrag(): the drag (ghost text, source, target) or null; render
 *    the ghost as a fixed element at the window's top left with
 *    ref={editor.seating.bindGhost} and no transform of its own.
 *  - useGuestPick(): tap-then-tap ("Tap a seat for Jane D." · Cancel calls
 *    editor.actions.cancelPick()).
 *  - useSeatCard(): the hover or tap card's guest and anchor.
 *  - useSeatPicker(): the + picker's seat and anchor; list guests with
 *    seatPickerGuests() (people.ts) and pick with actions.chooseForSeat(id).
 *  - useGuestRowProps(guestId): props for a side list row: drag, tap and
 *    keyboard.
 *  - useListZone(): a ref for the element that counts as the side list
 *    when a seated guest is dropped there (unseat).
 */
import { useCallback, useMemo, useRef, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import type { Seat } from '@/domain/canvas-schema'
import { initialsFor, type SeatLabel } from '@/domain/labels'
import type { Tint } from '@/domain/rules'
import { useEditorState } from '../state/react'
import { useStoreSelector } from '../state/store'
import type { GuestDrag, GuestPick, SeatCard, SeatingState, SeatPicker } from './store'

export function useSeating<U>(selector: (state: SeatingState) => U, isEqual: (a: U, b: U) => boolean = Object.is): U {
  return useStoreSelector(useEditorState().seating.store, selector, isEqual)
}

export function useGuestDrag(): GuestDrag | null {
  return useSeating((s) => s.drag)
}

export function useDragTint(itemId: string): Tint | null {
  return useSeating((s) => s.drag?.tints.get(itemId) ?? null)
}

export function useDropTargetSeat(itemId: string): number | null {
  return useSeating((s) => (s.drag?.targetSeat?.itemId === itemId ? s.drag.targetSeat.seatIndex : null))
}

export function useDragOrigin(itemId: string): number | null {
  return useSeating((s) => (s.drag?.from?.itemId === itemId ? s.drag.from.seatIndex : null))
}

export function useSeatPulse(itemId: string): { seatIndex: number; id: number } | null {
  return useSeating(
    (s) => (s.pulse?.itemId === itemId ? { seatIndex: s.pulse.seatIndex, id: s.pulse.id } : null),
    (a, b) => (a === null || b === null ? a === b : a.seatIndex === b.seatIndex && a.id === b.id),
  )
}

const NO_SEAT_LABELS: readonly SeatLabel[] = Object.freeze([])

/** Each seat's guest's initials ("AB"), in seat order: null for an empty seat or a guest the list does not have. */
export function seatInitials(people: SeatingState['people'], seats: readonly Pick<Seat, 'guestId'>[]): (string | null)[] {
  return seats.map((s) => {
    const g = s.guestId === null ? undefined : people.byId.get(s.guestId)
    return g ? initialsFor(g) || null : null
  })
}

function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

export function useSeatInitials(seats: readonly Pick<Seat, 'guestId'>[]): (string | null)[] {
  const selector = useCallback((s: SeatingState) => seatInitials(s.people, seats), [seats])
  return useSeating(selector, sameList)
}

export function useSeatLabels(tableId: string): readonly SeatLabel[] {
  const { labels } = useEditorState()
  const selector = useCallback((s: { byTable: ReadonlyMap<string, readonly SeatLabel[]> }) => s.byTable.get(tableId) ?? NO_SEAT_LABELS, [tableId])
  return useStoreSelector(labels.store, selector)
}

/** The ids of the tables that have names at close level. */
export function useLabelledTables(): readonly string[] {
  const { labels } = useEditorState()
  return useStoreSelector(labels.store, tableIdsOf, sameList)
}

function tableIdsOf(s: { byTable: ReadonlyMap<string, readonly SeatLabel[]> }): string[] {
  const out: string[] = []
  for (const [id, list] of s.byTable) if (list.length > 0) out.push(id)
  return out
}

export function useGuestPick(): GuestPick | null {
  return useSeating((s) => s.pick)
}

export function useSeatCard(): SeatCard | null {
  return useSeating((s) => s.card)
}

export function useSeatPicker(): SeatPicker | null {
  return useSeating((s) => s.picker)
}

/** Rows keep the list scrolling with a finger (pan-y), and a long press neither selects text nor opens the browser's menu. */
export const GUEST_ROW_STYLE: CSSProperties = Object.freeze({
  touchAction: 'pan-y',
  userSelect: 'none',
  WebkitUserSelect: 'none',
  WebkitTouchCallout: 'none',
} as CSSProperties)

export type GuestRowProps = {
  onPointerDown(event: PointerEvent<HTMLElement>): void
  onKeyDown(event: KeyboardEvent<HTMLElement>): void
  onClick(event: MouseEvent<HTMLElement>): void
  style: CSSProperties
  'data-guest-id': string
}

/**
 * Props for one name in the side list. A press becomes a drag (mouse after
 * 4 px, touch after a 450 ms hold) or a tap: a seated name pans to its seat;
 * on a phone an unassigned name waits for a seat tap. Enter or Space (or a
 * click from the keyboard) does the same as a tap. Spread them on the row
 * (put the row's own style after `style` if it has one).
 */
export function useGuestRowProps(guestId: string): GuestRowProps {
  const { seating } = useEditorState()
  return useMemo(
    () => ({
      onPointerDown: (event) => seating.listPointerDown(event.nativeEvent, guestId),
      onKeyDown: (event) => {
        // A native button turns Enter and Space into a click itself (onClick below).
        if ((event.key !== 'Enter' && event.key !== ' ') || event.currentTarget.tagName === 'BUTTON') return
        event.preventDefault()
        seating.rowActivate(guestId)
      },
      // Pointer clicks are taps already; only a click from the keyboard (detail 0) gets here.
      onClick: (event) => {
        if (event.detail === 0) seating.rowActivate(guestId)
      },
      style: GUEST_ROW_STYLE,
      'data-guest-id': guestId,
    }),
    [seating, guestId],
  )
}

/** A ref callback: the element counts as the side list for drops while it is mounted. */
export function useListZone(): (element: HTMLElement | null) => void {
  const { seating } = useEditorState()
  const off = useRef<(() => void) | null>(null)
  return useCallback(
    (element: HTMLElement | null) => {
      off.current?.()
      off.current = element ? seating.registerListZone(element) : null
    },
    [seating],
  )
}
