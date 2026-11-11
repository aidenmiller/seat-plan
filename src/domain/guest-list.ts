/**
 * The guest list as the screens show it (spec section 6, PLAN section 7):
 * search on first name, last name and nickname ignoring case and accents,
 * the filters (group, side, RSVP, child, meal), sorting by any column, the
 * "where they sit" text, and the editor's side list split into Unassigned
 * and Seated with its counts (DECISIONS 22). Pure: the Guests page and the
 * editor's Guests tab use the same rules.
 */
import type { Item } from './canvas-schema'
import { itemLabel } from './item-labels'
import { findLikelyDuplicates, foldName, type PersonName } from './names'

/** Partner 1, partner 2 or both (domain/partners). */
export type ListSide = 'partner1' | 'partner2' | 'both'
export type ListRsvp = 'yes' | 'no' | 'pending'

/** The fields of a guest the list reads (a subset of the API's Guest). */
export type ListGuest = {
  id: string
  firstName: string
  lastName: string
  nickname: string | null
  partnerId: string | null
  household: string | null
  side: ListSide
  rsvp: ListRsvp
  meal: string | null
  isChild: boolean
  notes: string | null
  groupIds: readonly string[]
}

// ---------------------------------------------------------------------------
// Search

/** The folded words of a search box. Blank gives none, which matches everyone. */
export function searchTerms(query: string): string[] {
  return foldName(query).split(' ').filter(Boolean)
}

/** "zoe kowalczyk zozo": what a search looks in. */
function haystack(guest: Pick<ListGuest, 'firstName' | 'lastName' | 'nickname'>): string {
  return foldName(`${guest.firstName} ${guest.lastName} ${guest.nickname ?? ''}`)
}

/**
 * True when every word typed is part of the guest's first name, last name or
 * nickname, ignoring case and accents: "zoe" finds Zoë, "kow zo" finds Zoë
 * Kowalczyk, "luk" finds Łukasz.
 */
export function matchesSearch(guest: Pick<ListGuest, 'firstName' | 'lastName' | 'nickname'>, terms: readonly string[]): boolean {
  if (terms.length === 0) return true
  const hay = haystack(guest)
  return terms.every((t) => hay.includes(t))
}

// ---------------------------------------------------------------------------
// Filters

/** "No group" and "No meal" choices in the filters. */
export const NONE = '__none__'

export type GuestFilters = {
  /** A group id, NONE for guests in no group, or null for any. */
  group: string | null
  side: ListSide | null
  rsvp: ListRsvp | null
  /** true: children only; false: adults only; null: everyone. */
  child: boolean | null
  /** A meal (compared ignoring case and accents), NONE for no meal, or null for any. */
  meal: string | null
}

export const NO_FILTERS: GuestFilters = Object.freeze({ group: null, side: null, rsvp: null, child: null, meal: null })

export function hasFilters(filters: GuestFilters): boolean {
  return Object.values(filters).some((v) => v !== null)
}

export function matchesFilters(guest: ListGuest, filters: GuestFilters): boolean {
  if (filters.group === NONE ? guest.groupIds.length > 0 : filters.group !== null && !guest.groupIds.includes(filters.group)) {
    return false
  }
  if (filters.side !== null && guest.side !== filters.side) return false
  if (filters.rsvp !== null && guest.rsvp !== filters.rsvp) return false
  if (filters.child !== null && guest.isChild !== filters.child) return false
  if (filters.meal !== null) {
    if (filters.meal === NONE) {
      if (guest.meal) return false
    } else if (!guest.meal || foldName(guest.meal) !== foldName(filters.meal)) {
      return false
    }
  }
  return true
}

/** The guests that match the search box and the filters, in the order given. */
export function filterGuests<G extends ListGuest>(guests: readonly G[], query: string, filters: GuestFilters = NO_FILTERS): G[] {
  const terms = searchTerms(query)
  return guests.filter((g) => matchesSearch(g, terms) && matchesFilters(g, filters))
}

/** The meals in use, each once (first spelling wins), sorted, for the meal filter. */
export function mealChoices(guests: readonly Pick<ListGuest, 'meal'>[]): string[] {
  const seen = new Map<string, string>()
  for (const g of guests) {
    const meal = g.meal?.trim()
    if (!meal) continue
    const key = foldName(meal)
    if (!seen.has(key)) seen.set(key, meal)
  }
  return [...seen.values()].sort(compareText)
}

// ---------------------------------------------------------------------------
// Sorting

export const GUEST_SORT_KEYS = [
  'firstName',
  'lastName',
  'nickname',
  'partner',
  'household',
  'side',
  'rsvp',
  'meal',
  'isChild',
  'groups',
  'notes',
  'seats',
] as const
export type GuestSortKey = (typeof GUEST_SORT_KEYS)[number]
export type SortDirection = 'asc' | 'desc'
export type GuestSort = { key: GuestSortKey; direction: SortDirection }

export const DEFAULT_SORT: GuestSort = Object.freeze({ key: 'lastName', direction: 'asc' })

/** What sorting needs beyond the guest itself: names of partners and groups, and where each guest sits. */
export type SortContext = {
  partnerName(id: string): string
  groupName(id: string): string
  /** "Reception · Table 3", or "" for nobody seated. */
  seatText(guestId: string): string
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

/** Text order: case and accents ignored, numbers in number order ("Table 2" before "Table 10"). */
export function compareText(a: string, b: string): number {
  return collator.compare(a, b)
}

const RSVP_ORDER: Record<ListRsvp, number> = { yes: 0, pending: 1, no: 2 }
const SIDE_ORDER: Record<ListSide, number> = { partner1: 0, partner2: 1, both: 2 }

/** The value a column sorts by: text, or a number. Empty text sorts last either way. */
function sortValue(guest: ListGuest, key: GuestSortKey, ctx: SortContext): string | number {
  switch (key) {
    case 'firstName':
      return guest.firstName
    case 'lastName':
      return guest.lastName
    case 'nickname':
      return guest.nickname ?? ''
    case 'partner':
      return guest.partnerId ? ctx.partnerName(guest.partnerId) : ''
    case 'household':
      return guest.household ?? ''
    case 'side':
      return SIDE_ORDER[guest.side]
    case 'rsvp':
      return RSVP_ORDER[guest.rsvp]
    case 'meal':
      return guest.meal ?? ''
    case 'isChild':
      return guest.isChild ? 0 : 1
    case 'groups':
      return guest.groupIds
        .map((id) => ctx.groupName(id))
        .sort(compareText)
        .join(', ')
    case 'notes':
      return guest.notes ?? ''
    case 'seats':
      return ctx.seatText(guest.id)
  }
}

/** Last name, then first name, then id: the order everything else falls back on. */
export function compareByName(a: Pick<ListGuest, 'id' | 'firstName' | 'lastName'>, b: Pick<ListGuest, 'id' | 'firstName' | 'lastName'>): number {
  return compareText(a.lastName, b.lastName) || compareText(a.firstName, b.firstName) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/**
 * Sorts by one column. Blank cells go last in both directions; ties fall
 * back on last name then first name, always A to Z, so the order is stable.
 */
export function sortGuests<G extends ListGuest>(guests: readonly G[], sort: GuestSort, ctx: SortContext): G[] {
  const sign = sort.direction === 'asc' ? 1 : -1
  const values = new Map(guests.map((g) => [g.id, sortValue(g, sort.key, ctx)]))
  return [...guests].sort((a, b) => {
    const va = values.get(a.id)!
    const vb = values.get(b.id)!
    if (typeof va === 'string' && typeof vb === 'string') {
      const blankA = va.trim() === ''
      const blankB = vb.trim() === ''
      if (blankA !== blankB) return blankA ? 1 : -1
      const c = compareText(va, vb)
      if (c !== 0) return c * sign
    } else if (typeof va === 'number' && typeof vb === 'number' && va !== vb) {
      return (va - vb) * sign
    }
    return compareByName(a, b)
  })
}

/** The next sort after pressing a column's header: A to Z first, then Z to A. */
export function nextSort(current: GuestSort, key: GuestSortKey): GuestSort {
  if (current.key !== key) return { key, direction: 'asc' }
  return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
}

// ---------------------------------------------------------------------------
// Where guests sit

export type SeatPlace = { guestId: string; layoutId: string; layoutName: string; itemLabel: string }

/** Guest id to "Reception · Table 3; Ceremony · Row 2", in the order the places come. */
export function seatTextByGuest(places: readonly SeatPlace[]): Map<string, string> {
  const lists = new Map<string, string[]>()
  for (const p of places) {
    const text = `${p.layoutName} · ${p.itemLabel}`
    const list = lists.get(p.guestId)
    if (list) list.push(text)
    else lists.set(p.guestId, [text])
  }
  return new Map([...lists].map(([id, list]) => [id, list.join('; ')]))
}

/** Guest id to the label of the table or row they sit at in this canvas ("Table 3", "Family (table 2)"). */
export function seatLabelsByGuest(items: readonly Item[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const item of items) {
    if (item.kind !== 'table' && item.kind !== 'chairRow') continue
    let label: string | null = null
    for (const seat of item.seats) {
      if (!seat.guestId || out.has(seat.guestId)) continue
      label ??= itemLabel(item)
      out.set(seat.guestId, label)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// The editor's side list

export type SideListOptions = {
  query: string
  group: string | null
  side: ListSide | null
  rsvp: ListRsvp | null
  /** Show guests who answered no in Unassigned too. The RSVP filter "No" turns it on. */
  showDeclined: boolean
}

/** True when declined guests show in Unassigned: asked for, or the RSVP filter is "No". */
export const declinedShown = (options: Pick<SideListOptions, 'rsvp' | 'showDeclined'>) => options.showDeclined || options.rsvp === 'no'

export type SideListCounts = {
  /** Guests who said yes or have not answered (DECISIONS 22). */
  guests: number
  /** Of those, seated in this layout. */
  seated: number
  /** Of those, not seated in this layout. */
  unassigned: number
  /** Guests who answered no. */
  declined: number
}

export type SeatedEntry<G> = { guest: G; label: string }

export type SideList<G> = {
  counts: SideListCounts
  unassigned: G[]
  seated: SeatedEntry<G>[]
  /** Declined guests left out of Unassigned because "Show declined" is off (after search and filters). */
  hiddenDeclined: number
}

/** "142 guests · 118 seated · 24 unassigned · 6 declined" (no declined part when there are none). */
export function sideListCountsText(counts: SideListCounts): string {
  const parts = [
    `${counts.guests} ${counts.guests === 1 ? 'guest' : 'guests'}`,
    `${counts.seated} seated`,
    `${counts.unassigned} unassigned`,
  ]
  if (counts.declined > 0) parts.push(`${counts.declined} declined`)
  return parts.join(' · ')
}

/**
 * The Seated heading's count, in the top line's terms: a declined guest who
 * still holds a seat is not counted as seated there (DECISIONS 22), so here
 * they are named apart: "Seated (5 + 1 declined)".
 */
export function seatedHeadingText(seated: readonly SeatedEntry<ListGuest>[]): string {
  const declined = seated.filter((s) => s.guest.rsvp === 'no').length
  const rest = seated.length - declined
  return declined > 0 ? `Seated (${rest} + ${declined} declined)` : `Seated (${rest})`
}

/**
 * The side list for one layout: counts over the whole guest list, then the
 * search and filters, then Unassigned (declined hidden unless asked, or the
 * RSVP filter is "No") and
 * Seated with each guest's table label. Both parts sort by last name, then
 * first name.
 */
export function sideList<G extends ListGuest>(
  guests: readonly G[],
  seatLabels: ReadonlyMap<string, string>,
  options: SideListOptions,
): SideList<G> {
  const counts: SideListCounts = { guests: 0, seated: 0, unassigned: 0, declined: 0 }
  for (const g of guests) {
    if (g.rsvp === 'no') {
      counts.declined++
      continue
    }
    counts.guests++
    if (seatLabels.has(g.id)) counts.seated++
    else counts.unassigned++
  }

  const filters: GuestFilters = { group: options.group, side: options.side, rsvp: options.rsvp, child: null, meal: null }
  const shown = filterGuests(guests, options.query, filters).sort(compareByName)
  const unassigned: G[] = []
  const seated: SeatedEntry<G>[] = []
  let hiddenDeclined = 0
  const showDeclined = declinedShown(options)
  for (const g of shown) {
    const label = seatLabels.get(g.id)
    if (label !== undefined) seated.push({ guest: g, label })
    else if (g.rsvp === 'no' && !showDeclined) hiddenDeclined++
    else unassigned.push(g)
  }
  return { counts, unassigned, seated, hiddenDeclined }
}

// ---------------------------------------------------------------------------
// Edits shown before the server confirms them

/** Fields a guest edit may carry, beyond which nothing is applied on screen. */
const PLAIN_FIELDS = ['firstName', 'lastName', 'nickname', 'household', 'side', 'rsvp', 'meal', 'isChild', 'notes'] as const

type Partnered = ListGuest & { coupleRuleEnabled?: boolean }

/**
 * One guest's edit applied to a list, the way the server will apply it:
 * plain fields as sent; partnerId links both guests and clears any earlier
 * partner of either, turning the couple rule on for both (PLAN change 8), and
 * null unlinks both; coupleRuleEnabled sets the switch on the guest and their
 * partner. Unknown fields (expectedPartners) are ignored. Returns the same
 * list when the guest is not in it.
 */
export function applyGuestPatch<G extends Partnered>(guests: readonly G[], id: string, patch: Readonly<Record<string, unknown>>): G[] {
  const index = new Map(guests.map((g, i) => [g.id, i]))
  const at = index.get(id)
  if (at === undefined) return guests as G[]
  const out = [...guests]
  const update = (guestId: string | null, change: Partial<Partnered>) => {
    if (!guestId) return
    const i = index.get(guestId)
    if (i === undefined) return
    out[i] = { ...out[i], ...change }
  }

  const plain: Record<string, unknown> = {}
  for (const key of PLAIN_FIELDS) if (key in patch) plain[key] = patch[key]
  update(id, plain as Partial<Partnered>)

  if ('partnerId' in patch) {
    const next = typeof patch.partnerId === 'string' ? patch.partnerId : null
    const before = out[at].partnerId
    if (next !== before) {
      update(before, { partnerId: null })
      if (next && next !== id && index.has(next)) {
        update(out[index.get(next)!].partnerId, { partnerId: null })
        update(id, { partnerId: next, coupleRuleEnabled: true })
        update(next, { partnerId: id, coupleRuleEnabled: true })
      } else {
        update(id, { partnerId: null })
      }
    }
  }
  if (typeof patch.coupleRuleEnabled === 'boolean') {
    update(id, { coupleRuleEnabled: patch.coupleRuleEnabled })
    update(out[at].partnerId, { coupleRuleEnabled: patch.coupleRuleEnabled })
  }
  return out
}

/** Sets each guest's groupIds to match one group's members (after adding or taking out members). */
export function applyGroupMembers<G extends ListGuest>(guests: readonly G[], group: { id: string; memberIds: readonly string[] }): G[] {
  const members = new Set(group.memberIds)
  return guests.map((g) => {
    const inGroup = g.groupIds.includes(group.id)
    const shouldBe = members.has(g.id)
    if (inGroup === shouldBe) return g
    return { ...g, groupIds: shouldBe ? [...g.groupIds, group.id] : g.groupIds.filter((x) => x !== group.id) }
  })
}

/** Takes a deleted group out of every guest's groupIds. */
export function dropGroup<G extends ListGuest>(guests: readonly G[], groupId: string): G[] {
  return guests.map((g) => (g.groupIds.includes(groupId) ? { ...g, groupIds: g.groupIds.filter((x) => x !== groupId) } : g))
}

/** A removed guest leaves the list, and their partner's link goes with them. */
export function dropGuest<G extends ListGuest>(guests: readonly G[], guestId: string): G[] {
  return guests.filter((g) => g.id !== guestId).map((g) => (g.partnerId === guestId ? { ...g, partnerId: null } : g))
}

// ---------------------------------------------------------------------------
// Pasted names, as edited in the preview

/** What stops a pasted line from saving after it was edited, or null. */
export function pastedRowError(row: { firstName: string; lastName: string }): string | null {
  const first = row.firstName.trim()
  const last = row.lastName.trim()
  if (!first && !last) return 'Needs a name'
  if (!last) return 'Needs a last name'
  if (!first) return 'Needs a first name'
  return null
}

const TWO_PEOPLE_RE = /\s(?:&|and)\s/i

/** True when an edited line still looks like two people ("John & Jane Smith"). Saving is still allowed. */
export function looksLikeTwoPeople(row: { firstName: string; lastName: string }): boolean {
  return TWO_PEOPLE_RE.test(` ${row.firstName.trim()} ${row.lastName.trim()} `)
}

// ---------------------------------------------------------------------------
// Names

/** "Zoë Kowalczyk" */
export function fullName(guest: Pick<ListGuest, 'firstName' | 'lastName'>): string {
  return `${guest.firstName} ${guest.lastName}`
}

/**
 * Pasted lines that look like someone already on the guest list, or like
 * another pasted line, so pasting a list twice does not quietly add everyone
 * twice. Same name ignoring case and accents, swapped names, nicknames and
 * close spellings count, as in the CSV import's likely duplicates. Each line
 * gets one message, keyed by its id; saving is still allowed.
 */
export function pastedDuplicates(
  rows: readonly { id: string; firstName: string; lastName: string }[],
  guests: readonly PersonName[],
): Map<string, string> {
  const people = [
    ...rows.map((r, i) => ({ key: `r:${i}`, firstName: r.firstName.trim(), lastName: r.lastName.trim() })),
    ...guests.map((g, i) => ({ key: `g:${i}`, firstName: g.firstName, lastName: g.lastName, nickname: g.nickname })),
  ]
  const out = new Map<string, string>()
  const line = (key: string) => Number(key.slice(2))
  const say = (rowIndex: number, message: string) => {
    const id = rows[rowIndex]!.id
    if (!out.has(id)) out.set(id, message)
  }
  // Guests first, so a line that is both on the list and pasted twice says "on the list".
  const pairs = findLikelyDuplicates(people, (key) => key.startsWith('r:')).sort(
    (a, b) => Number(b.b.startsWith('g:')) - Number(a.b.startsWith('g:')) || line(a.a) - line(b.a),
  )
  for (const pair of pairs) {
    const [a, b] = pair.a.startsWith('r:') ? [pair.a, pair.b] : [pair.b, pair.a]
    if (b.startsWith('g:')) {
      const g = guests[line(b)]!
      say(line(a), pair.reason === 'same-name' ? 'Already on the list' : `Looks like ${g.firstName} ${g.lastName}, already on the list`)
    } else {
      // Two pasted lines: flag the later one.
      const [first, later] = line(a) < line(b) ? [line(a), line(b)] : [line(b), line(a)]
      say(later, pair.reason === 'same-name' ? `Same name as line ${first + 1}` : `Looks like line ${first + 1}`)
    }
  }
  return out
}
