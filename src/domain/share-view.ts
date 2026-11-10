/**
 * What a venue share link shows (spec section 2, PLAN change 24). The server
 * builds this from the layout and the link's switches, so nothing hidden ever
 * reaches the viewer's browser:
 *
 *  - tables, fixtures, chair rows and plain shapes (shapes lose their text, and
 *    text shapes are left out, since either may hold a private comment);
 *  - the venue layer (the template's fixed items, without the import's notes);
 *  - notes only when the link shows notes;
 *  - for each seated guest only their meal and child flag, plus their name
 *    when the link shows names. Seats point at short keys ("g1"), not guest ids.
 *
 * Never sent: guest notes, nicknames, sides, RSVPs, groups, rules, other
 * layouts and the original floor plan image.
 */
import type { Canvas, Item } from './canvas-schema'
import { compareByName, matchesSearch, searchTerms } from './guest-list'
import type { FixedItem } from './venue-schema'

export type ShareGuest = {
  /** The key seats use for this guest in this reply. */
  key: string
  /** Only when the link shows names. */
  firstName?: string
  lastName?: string
  meal: string | null
  isChild: boolean
}

export type ShareView = {
  /** For the viewer's top bar, beside the layout's name. */
  weddingName: string
  layoutName: string
  kind: 'reception' | 'ceremony'
  unit: 'ft' | 'm'
  /** When the layout was last saved (the link shows the latest save, DECISIONS 26). */
  updatedAt: string
  showNames: boolean
  showNotes: boolean
  venue: FixedItem[]
  items: Item[]
  guests: ShareGuest[]
}

export type ShareViewInput = {
  weddingName: string
  layoutName: string
  kind: 'reception' | 'ceremony'
  unit: 'ft' | 'm'
  updatedAt: string
  canvas: Canvas
  /** The live template's fixed items, or none. */
  venue: readonly FixedItem[]
  /** At least the guests seated in this layout. */
  guests: readonly { id: string; firstName: string; lastName: string; meal: string | null; isChild: boolean }[]
  showNames: boolean
  showNotes: boolean
}

export function buildShareView(input: ShareViewInput): ShareView {
  const byId = new Map(input.guests.map((g) => [g.id, g]))
  const keys = new Map<string, string>()
  const shared: ShareGuest[] = []

  function keyFor(guestId: string | null): string | null {
    if (guestId === null) return null
    const known = keys.get(guestId)
    if (known) return known
    const guest = byId.get(guestId)
    if (!guest) return null
    const key = `g${keys.size + 1}`
    keys.set(guestId, key)
    shared.push({
      key,
      ...(input.showNames ? { firstName: guest.firstName, lastName: guest.lastName } : {}),
      meal: guest.meal,
      isChild: guest.isChild,
    })
    return key
  }

  const items: Item[] = []
  for (const item of input.canvas.items) {
    switch (item.kind) {
      case 'table':
      case 'chairRow':
        items.push({ ...item, seats: item.seats.map((seat) => ({ index: seat.index, guestId: keyFor(seat.guestId) })) })
        break
      case 'fixture':
        items.push(item)
        break
      case 'shape':
        if (item.type !== 'text') {
          const copy = { ...item }
          delete copy.text
          items.push(copy)
        }
        break
      case 'note':
        if (input.showNotes) items.push(item)
        break
    }
  }

  return {
    weddingName: input.weddingName,
    layoutName: input.layoutName,
    kind: input.kind,
    unit: input.unit,
    updatedAt: input.updatedAt,
    showNames: input.showNames,
    showNotes: input.showNotes,
    venue: input.venue.map((v) => ({ ...v, unsure: false, unsureNote: '' })),
    items,
    guests: shared,
  }
}

// ---------------------------------------------------------------- the viewer (PLAN section 7, "Share view")

/** How often an open share page asks for the data again: it shows the latest save, and signs out a link turned off. */
export const SHARE_RECHECK_MS = 60_000

/** A guest whose name the link shows. */
export type NamedShareGuest = ShareGuest & { firstName: string; lastName: string }

export function isNamed(guest: ShareGuest): guest is NamedShareGuest {
  return guest.firstName !== undefined && guest.lastName !== undefined
}

/** "Ann Lee", or null when the link shows table names only. */
export function shareGuestName(guest: ShareGuest): string | null {
  return isNamed(guest) ? `${guest.firstName} ${guest.lastName}`.trim() : null
}

/**
 * The viewer's search: guests whose first or last name holds every word
 * typed, ignoring case and accents, by last name, at most `limit`. Nothing
 * for an empty search, and nothing at all when the link shows table names
 * only.
 */
export function searchShareGuests(guests: readonly ShareGuest[], query: string, limit = 8): NamedShareGuest[] {
  const terms = searchTerms(query)
  if (terms.length === 0) return []
  return guests
    .filter(isNamed)
    .filter((g) => matchesSearch({ firstName: g.firstName, lastName: g.lastName, nickname: null }, terms))
    .sort((a, b) => compareByName({ ...a, id: a.key }, { ...b, id: b.key }))
    .slice(0, limit)
}

/**
 * The guests as the editor's seating tools read them (names for labels,
 * initials and the pan to a seat). Only named guests: with table names only
 * the seats show no names or initials.
 */
export function sharePeopleGuests(guests: readonly ShareGuest[]) {
  return guests.filter(isNamed).map((g) => ({
    id: g.key,
    firstName: g.firstName,
    lastName: g.lastName,
    nickname: null,
    rsvp: 'yes' as const,
    partnerId: null,
    coupleRuleEnabled: false,
  }))
}

/** What a seat's card shows: the name (when the link shows names), the meal and the child flag, nothing else. */
export function shareSeatCard(guest: ShareGuest | undefined): { name: string | null; meal: string | null; child: boolean } {
  if (!guest) return { name: null, meal: null, child: false }
  const meal = guest.meal?.trim() ? guest.meal.trim() : null
  return { name: shareGuestName(guest), meal, child: guest.isChild }
}

/**
 * What a reply from the data route means for an open viewer: show the plan
 * (200); sign out (401 when the link was turned off or its password changed,
 * 404 or 410 when the layout is gone); anything else is a hiccup to retry
 * on the next check.
 */
export function shareRecheckOutcome(status: number): 'show' | 'signedOut' | 'retry' {
  if (status === 200) return 'show'
  if (status === 401 || status === 404 || status === 410) return 'signedOut'
  return 'retry'
}
