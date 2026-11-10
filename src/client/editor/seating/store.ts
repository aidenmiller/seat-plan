/**
 * What the seating tools show (spec section 4, "Seating guests"; PLAN
 * section 6), for the renderer and the panels. Never saved, never undone.
 *
 *  - drag: a guest being dragged: the ghost's text, where it came from, the
 *    target under the pointer (the seat that grows and gets an outline) and
 *    each table's tint ('good' green: partner or group there; 'bad' red: a
 *    rule would break), worked out once when the drag starts. The ghost's
 *    position is not here: it changes every frame, so the controller writes
 *    it straight onto the ghost element (bindGhost).
 *  - pick: the phone's tap-then-tap: a name was tapped and the next tap on a
 *    seat seats them ("Tap a seat for Jane D. · Cancel").
 *  - card: the hover card (desktop, after 150 ms) or a seat tapped in View
 *    mode: which guest, and where on screen.
 *  - picker: the + on an empty seat opened its guest list, anchored there.
 *  - pulse: pan to a seat makes it pulse for two seconds; `id` changes each
 *    time so the animation starts again.
 *  - people: the wedding's guests, groups and rules as the page last handed
 *    them over (setPeople): names for the seats' initials and labels.
 */
import type { Point } from '@/domain/geometry'
import type { Tint } from '@/domain/rules'
import type { SeatRef } from '@/domain/seating'
import type { PointerKind } from '../input/pointer-machine'
import { createStore, type Store } from '../state/store'
import type { DragTarget } from './drop'
import { NO_PEOPLE, type PeopleDirectory } from './people'

export type GuestDrag = {
  /** Changes with every new drag. */
  id: number
  guestId: string
  /** The ghost's text: the guest's full name. */
  text: string
  /** From the side list, or from a seat on the canvas. */
  source: 'list' | 'seat'
  /** The guest's seat when the drag began, or null. */
  from: SeatRef | null
  pointer: PointerKind
  target: DragTarget
  /** The seat that grows and gets an outline: the seat under the pointer, or the table's first free seat. */
  targetSeat: SeatRef | null
  /** Every table's and row's tint for this guest, by item id. */
  tints: ReadonlyMap<string, Tint>
}

export type GuestPick = {
  guestId: string
  /** "Jane D." */
  name: string
  /** "Tap a seat for Jane D." */
  prompt: string
}

/** Where something sits on screen: `screen` from the canvas viewport's top left, `client` from the window's. */
export type ScreenAnchor = { screen: Point; client: Point }

export type SeatCard = ScreenAnchor & {
  guestId: string
  itemId: string
  seatIndex: number
  /** hover: a mouse resting on the seat; tap: a seat tapped in View mode. */
  source: 'hover' | 'tap'
}

export type SeatPicker = ScreenAnchor & {
  itemId: string
  seatIndex: number
  /** "Table 3, seat 4" */
  label: string
}

export type SeatPulse = { itemId: string; seatIndex: number; id: number }

export type SeatingState = {
  drag: GuestDrag | null
  pick: GuestPick | null
  card: SeatCard | null
  picker: SeatPicker | null
  pulse: SeatPulse | null
  people: PeopleDirectory
}

export function initialSeatingState(): SeatingState {
  return { drag: null, pick: null, card: null, picker: null, pulse: null, people: NO_PEOPLE }
}

export type SeatingStore = Store<SeatingState>

export function createSeatingStore(initial: Partial<SeatingState> = {}): SeatingStore {
  return createStore<SeatingState>({ ...initialSeatingState(), ...initial })
}
