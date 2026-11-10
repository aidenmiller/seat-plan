/**
 * Who the editor seats: the wedding's guests, groups and rules, as the page
 * last loaded them (EditorShell hands them over with editor.setPeople). The
 * editor reads names from here for the drag ghost, the "Tap a seat for
 * Jane D." strip, the + picker and the guests a seat count change would
 * unseat, and the partner, group and rule links for the green and red table
 * tint while dragging. Pure.
 */
import type { Canvas } from '@/domain/canvas-schema'
import { compareByName, matchesSearch, searchTerms } from '@/domain/guest-list'
import { fullLabel, shortLabel } from '@/domain/labels'
import type { Rsvp, Rule, RuleGroup, RuleGuest } from '@/domain/rules'
import { seatsByGuest } from '@/domain/seating'

/** What the seating tools read from a guest (the API's Guest has all of it). */
export type PeopleGuest = RuleGuest & {
  firstName: string
  lastName: string
  nickname: string | null
  rsvp: Rsvp
  groupIds?: readonly string[]
}

export type People = {
  guests: readonly PeopleGuest[]
  groups: readonly RuleGroup[]
  /** The wedding's stored rules (milestone 6); couple rules come from partner links. */
  rules: readonly Rule[]
}

export type PeopleDirectory = People & {
  byId: ReadonlyMap<string, PeopleGuest>
}

export const NO_PEOPLE: PeopleDirectory = Object.freeze({ guests: [], groups: [], rules: [], byId: new Map() })

export function directory(people: Partial<People>): PeopleDirectory {
  const guests = people.guests ?? []
  return { guests, groups: people.groups ?? [], rules: people.rules ?? [], byId: new Map(guests.map((g) => [g.id, g])) }
}

/** Shown for a seat whose guest is not in the list (removed, or the list is still loading). */
export const UNKNOWN_GUEST = 'Guest'

/** "Jane Doe" */
export function guestFullName(dir: PeopleDirectory, guestId: string): string {
  const g = dir.byId.get(guestId)
  return g ? fullLabel(g) || UNKNOWN_GUEST : UNKNOWN_GUEST
}

/** "Jane D." */
export function guestShortName(dir: PeopleDirectory, guestId: string): string {
  const g = dir.byId.get(guestId)
  return g ? shortLabel(g) || UNKNOWN_GUEST : UNKNOWN_GUEST
}

/** "Tap a seat for Jane D." (the phone's strip adds Cancel). */
export function pickPrompt(dir: PeopleDirectory, guestId: string): string {
  return `Tap a seat for ${guestShortName(dir, guestId)}`
}

/** The default size of the + picker's list. */
export const PICKER_LIMIT = 8

/**
 * The + picker's list (spec section 4): guests not seated in this layout,
 * declined guests left out as in the side list, matching the search on
 * first name, last name and nickname, by last name, at most `limit`.
 */
export function seatPickerGuests<G extends PeopleGuest>(
  guests: readonly G[],
  canvas: Pick<Canvas, 'items'>,
  query: string,
  limit: number = PICKER_LIMIT,
): G[] {
  const seated = seatsByGuest(canvas)
  const terms = searchTerms(query)
  return guests
    .filter((g) => g.rsvp !== 'no' && !seated.has(g.id) && matchesSearch(g, terms))
    .sort(compareByName)
    .slice(0, Math.max(0, limit))
}
