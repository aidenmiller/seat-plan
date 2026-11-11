import { describe, expect, it } from 'vitest'
import type { ChairRow, Item, Table } from './canvas-schema'
import {
  applyGroupMembers,
  applyGuestPatch,
  compareText,
  dropGroup,
  dropGuest,
  filterGuests,
  hasFilters,
  looksLikeTwoPeople,
  pastedDuplicates,
  matchesSearch,
  mealChoices,
  nextSort,
  NO_FILTERS,
  NONE,
  pastedRowError,
  searchTerms,
  seatLabelsByGuest,
  seatTextByGuest,
  declinedShown,
  seatedHeadingText,
  sideList,
  sideListCountsText,
  sortGuests,
  type ListGuest,
  type SortContext,
} from './guest-list'

let n = 0
function guest(first: string, last: string, over: Partial<ListGuest> = {}): ListGuest {
  n += 1
  return {
    id: `g${String(n).padStart(3, '0')}`,
    firstName: first,
    lastName: last,
    nickname: null,
    partnerId: null,
    household: null,
    side: 'both',
    rsvp: 'pending',
    meal: null,
    isChild: false,
    notes: null,
    groupIds: [],
    ...over,
  }
}

const zoe = guest('Zoë', 'Kowalczyk', { nickname: 'Zozo', side: 'partner1', rsvp: 'yes', meal: 'Fish', groupIds: ['fam'] })
const lukasz = guest('Łukasz', 'Kowalczyk', { side: 'partner1', rsvp: 'yes', meal: 'Beef', groupIds: ['fam'] })
const mia = guest('Mia', 'Kowalczyk', { side: 'partner1', rsvp: 'yes', meal: 'kids meal', isChild: true, groupIds: ['fam', 'kids'] })
const anna = guest('Anna', 'van der Berg', { side: 'partner2', rsvp: 'no' })
const jose = guest('José', 'García', { meal: 'Vegetarian', notes: 'Arrives late' })
const all = [zoe, lukasz, mia, anna, jose]

describe('search', () => {
  it('matches first name, last name and nickname, ignoring case and accents', () => {
    expect(filterGuests(all, 'zoe').map((g) => g.firstName)).toEqual(['Zoë'])
    expect(filterGuests(all, 'LUK').map((g) => g.firstName)).toEqual(['Łukasz'])
    expect(filterGuests(all, 'zozo').map((g) => g.firstName)).toEqual(['Zoë'])
    expect(filterGuests(all, 'garcia').map((g) => g.firstName)).toEqual(['José'])
    expect(filterGuests(all, 'van der').map((g) => g.firstName)).toEqual(['Anna'])
  })

  it('needs every word typed, in any of the names', () => {
    expect(filterGuests(all, 'kow mia').map((g) => g.firstName)).toEqual(['Mia'])
    expect(filterGuests(all, 'kowalczyk').length).toBe(3)
    expect(filterGuests(all, 'kowalczyk smith')).toEqual([])
  })

  it('does not look in notes or meals, and a blank box matches everyone', () => {
    expect(filterGuests(all, 'fish')).toEqual([])
    expect(filterGuests(all, 'late')).toEqual([])
    expect(filterGuests(all, '   ')).toHaveLength(5)
    expect(searchTerms('  Zoë   K ')).toEqual(['zoe', 'k'])
    expect(matchesSearch(zoe, [])).toBe(true)
  })
})

describe('filters', () => {
  it('filters by group, including no group', () => {
    expect(filterGuests(all, '', { ...NO_FILTERS, group: 'kids' })).toEqual([mia])
    expect(filterGuests(all, '', { ...NO_FILTERS, group: NONE })).toEqual([anna, jose])
  })

  it('filters by side, RSVP and child', () => {
    expect(filterGuests(all, '', { ...NO_FILTERS, side: 'partner2' })).toEqual([anna])
    expect(filterGuests(all, '', { ...NO_FILTERS, rsvp: 'pending' })).toEqual([jose])
    expect(filterGuests(all, '', { ...NO_FILTERS, child: true })).toEqual([mia])
    expect(filterGuests(all, '', { ...NO_FILTERS, child: false })).toHaveLength(4)
  })

  it('filters by meal ignoring case and accents, or by no meal', () => {
    expect(filterGuests(all, '', { ...NO_FILTERS, meal: 'KIDS MEAL' })).toEqual([mia])
    expect(filterGuests(all, '', { ...NO_FILTERS, meal: NONE })).toEqual([anna])
  })

  it('combines filters with the search', () => {
    expect(filterGuests(all, 'kow', { ...NO_FILTERS, group: 'fam', child: false })).toEqual([zoe, lukasz])
    expect(hasFilters(NO_FILTERS)).toBe(false)
    expect(hasFilters({ ...NO_FILTERS, child: false })).toBe(true)
  })

  it('lists each meal once for the meal filter', () => {
    expect(mealChoices([...all, guest('A', 'B', { meal: 'fish ' }), guest('C', 'D', { meal: '' })])).toEqual([
      'Beef',
      'Fish',
      'kids meal',
      'Vegetarian',
    ])
  })
})

describe('sorting', () => {
  const ctx: SortContext = {
    partnerName: (id) => (id === zoe.id ? 'Zoë Kowalczyk' : id === lukasz.id ? 'Łukasz Kowalczyk' : ''),
    groupName: (id) => ({ fam: 'Noa Family', kids: 'Kids' })[id] ?? '',
    seatText: (id) => (id === zoe.id ? 'Reception · Table 10' : id === jose.id ? 'Reception · Table 2' : ''),
  }

  it('sorts by last name then first name by default order, accents ignored', () => {
    const sorted = sortGuests(all, { key: 'lastName', direction: 'asc' }, ctx)
    expect(sorted.map((g) => g.firstName)).toEqual(['José', 'Łukasz', 'Mia', 'Zoë', 'Anna'])
  })

  it('reverses on desc but keeps blank cells last', () => {
    const asc = sortGuests(all, { key: 'meal', direction: 'asc' }, ctx).map((g) => g.firstName)
    const desc = sortGuests(all, { key: 'meal', direction: 'desc' }, ctx).map((g) => g.firstName)
    expect(asc).toEqual(['Łukasz', 'Zoë', 'Mia', 'José', 'Anna'])
    expect(desc).toEqual(['José', 'Mia', 'Zoë', 'Łukasz', 'Anna'])
  })

  it('sorts seats with numbers in number order', () => {
    const sorted = sortGuests(all, { key: 'seats', direction: 'asc' }, ctx).map((g) => g.firstName)
    expect(sorted.slice(0, 2)).toEqual(['José', 'Zoë'])
  })

  it('sorts RSVP yes, pending, no, and child first on asc', () => {
    expect(sortGuests(all, { key: 'rsvp', direction: 'asc' }, ctx).map((g) => g.rsvp)).toEqual(['yes', 'yes', 'yes', 'pending', 'no'])
    expect(sortGuests(all, { key: 'isChild', direction: 'asc' }, ctx)[0]).toBe(mia)
    expect(sortGuests(all, { key: 'side', direction: 'asc' }, ctx).map((g) => g.side)).toEqual(['partner1', 'partner1', 'partner1', 'partner2', 'both'])
  })

  it('sorts by every column without throwing, ties by name', () => {
    for (const key of ['firstName', 'nickname', 'partner', 'household', 'groups', 'notes'] as const) {
      expect(sortGuests(all, { key, direction: 'asc' }, ctx)).toHaveLength(5)
    }
    expect(sortGuests(all, { key: 'groups', direction: 'asc' }, ctx).map((g) => g.firstName)).toEqual([
      'Mia',
      'Łukasz',
      'Zoë',
      'José',
      'Anna',
    ])
  })

  it('flips direction when the same header is pressed again', () => {
    expect(nextSort({ key: 'lastName', direction: 'asc' }, 'lastName')).toEqual({ key: 'lastName', direction: 'desc' })
    expect(nextSort({ key: 'lastName', direction: 'desc' }, 'lastName')).toEqual({ key: 'lastName', direction: 'asc' })
    expect(nextSort({ key: 'lastName', direction: 'desc' }, 'meal')).toEqual({ key: 'meal', direction: 'asc' })
    expect(compareText('Table 2', 'table 10')).toBeLessThan(0)
  })
})

function table(id: string, number: number, name: string, guests: (string | null)[]): Table {
  return {
    id,
    kind: 'table',
    shape: 'round',
    x: 0,
    y: 0,
    width: 152.4,
    height: 152.4,
    rotation: 0,
    locked: false,
    number,
    name,
    seatCount: guests.length,
    seatSides: 'all',
    seats: guests.map((guestId, index) => ({ index, guestId })),
  } as unknown as Table
}

function row(id: string, rowNumber: number, guests: (string | null)[]): ChairRow {
  return {
    id,
    kind: 'chairRow',
    x: 0,
    y: 0,
    rotation: 0,
    locked: false,
    rowNumber,
    rowLabel: '',
    blockLabel: null,
    chairCount: guests.length,
    spacing: 50,
    seats: guests.map((guestId, index) => ({ index, guestId })),
  } as unknown as ChairRow
}

describe('where guests sit', () => {
  it('labels each seated guest with the table or row', () => {
    const items: Item[] = [table('t1', 3, 'Table 3', [zoe.id, null]), table('t2', 4, 'Family', [mia.id]), row('r1', 2, [jose.id])]
    const labels = seatLabelsByGuest(items)
    expect(labels.get(zoe.id)).toBe('Table 3')
    expect(labels.get(mia.id)).toBe('Family (table 4)')
    expect(labels.get(jose.id)).toBe('Row 2')
    expect(labels.has(anna.id)).toBe(false)
  })

  it('joins places across layouts for the Guests page', () => {
    const text = seatTextByGuest([
      { guestId: 'a', layoutId: 'l1', layoutName: 'Ceremony', itemLabel: 'Row 2' },
      { guestId: 'a', layoutId: 'l2', layoutName: 'Reception', itemLabel: 'Table 3' },
      { guestId: 'b', layoutId: 'l2', layoutName: 'Reception', itemLabel: 'Table 4' },
    ])
    expect(text.get('a')).toBe('Ceremony · Row 2; Reception · Table 3')
    expect(text.get('b')).toBe('Reception · Table 4')
  })
})

describe('the editor side list', () => {
  const declinedSeated = guest('Dee', 'Clined', { rsvp: 'no' })
  const guests = [...all, declinedSeated]
  const labels = new Map([
    [zoe.id, 'Table 3'],
    [declinedSeated.id, 'Table 4'],
  ])
  const base = { query: '', group: null, side: null, rsvp: null, showDeclined: false }

  it('counts guests who said yes or have not answered, and declined apart (DECISIONS 22)', () => {
    const list = sideList(guests, labels, base)
    expect(list.counts).toEqual({ guests: 4, seated: 1, unassigned: 3, declined: 2 })
    expect(sideListCountsText(list.counts)).toBe('4 guests · 1 seated · 3 unassigned · 2 declined')
    expect(sideListCountsText({ guests: 1, seated: 0, unassigned: 1, declined: 0 })).toBe('1 guest · 0 seated · 1 unassigned')
  })

  it('splits into Unassigned and Seated with table labels, declined hidden from Unassigned', () => {
    const list = sideList(guests, labels, base)
    expect(list.unassigned.map((g) => g.firstName)).toEqual(['José', 'Łukasz', 'Mia'])
    expect(list.seated.map((s) => [s.guest.firstName, s.label])).toEqual([
      ['Dee', 'Table 4'],
      ['Zoë', 'Table 3'],
    ])
    expect(list.hiddenDeclined).toBe(1)
    const withDeclined = sideList(guests, labels, { ...base, showDeclined: true })
    expect(withDeclined.unassigned.map((g) => g.firstName)).toEqual(['José', 'Łukasz', 'Mia', 'Anna'])
    expect(withDeclined.hiddenDeclined).toBe(0)
  })

  it('filters both parts by search, group, side and RSVP, but counts the whole list', () => {
    const list = sideList(guests, labels, { ...base, query: 'kow' })
    expect(list.unassigned.map((g) => g.firstName)).toEqual(['Łukasz', 'Mia'])
    expect(list.seated.map((s) => s.guest.firstName)).toEqual(['Zoë'])
    expect(list.counts.guests).toBe(4)
    expect(sideList(guests, labels, { ...base, group: 'kids' }).unassigned).toEqual([mia])
    expect(sideList(guests, labels, { ...base, side: 'partner2', showDeclined: true }).unassigned).toEqual([anna])
    expect(sideList(guests, labels, { ...base, rsvp: 'pending' }).unassigned).toEqual([jose])
  })

  it('the RSVP filter "No" shows the declined guests it asks for (review finding)', () => {
    const list = sideList(guests, labels, { ...base, rsvp: 'no' })
    expect(list.unassigned.map((g) => g.firstName)).toEqual(['Anna'])
    expect(list.hiddenDeclined).toBe(0)
    expect(declinedShown({ rsvp: 'no', showDeclined: false })).toBe(true)
    expect(declinedShown({ rsvp: 'yes', showDeclined: false })).toBe(false)
  })

  it('names a seated declined guest apart in the Seated heading, so it agrees with the top line (review finding)', () => {
    const list = sideList(guests, labels, base)
    expect(list.counts.seated).toBe(1)
    expect(seatedHeadingText(list.seated)).toBe('Seated (1 + 1 declined)')
    expect(seatedHeadingText(list.seated.filter((s) => s.guest.rsvp !== 'no'))).toBe('Seated (1)')
    expect(seatedHeadingText([])).toBe('Seated (0)')
  })
})

describe('edits shown before the server confirms them', () => {
  type P = ListGuest & { coupleRuleEnabled: boolean }
  const p = (first: string, over: Partial<P> = {}): P => ({ ...guest(first, 'X'), coupleRuleEnabled: true, ...over })

  it('applies plain fields and ignores the rest', () => {
    const a = p('Ann')
    const [out] = applyGuestPatch([a], a.id, { meal: 'Fish', isChild: true, expectedPartners: {}, bogus: 1 })
    expect(out).toEqual({ ...a, meal: 'Fish', isChild: true })
    expect(applyGuestPatch([a], 'missing', { meal: 'Fish' })[0]).toBe(a)
  })

  it('links partners both ways and clears earlier partners of either', () => {
    const a = p('A')
    const b = p('B')
    const c = p('C')
    const d = p('D')
    a.partnerId = b.id
    b.partnerId = a.id
    c.partnerId = d.id
    d.partnerId = c.id
    d.coupleRuleEnabled = false
    c.coupleRuleEnabled = false
    const out = applyGuestPatch([a, b, c, d], a.id, { partnerId: c.id, expectedPartners: {} })
    const byName = Object.fromEntries(out.map((g) => [g.firstName, g]))
    expect(byName.A.partnerId).toBe(c.id)
    expect(byName.C.partnerId).toBe(a.id)
    expect(byName.B.partnerId).toBeNull()
    expect(byName.D.partnerId).toBeNull()
    expect(byName.C.coupleRuleEnabled).toBe(true)
  })

  it('unlinks both, and sets the couple rule switch on both', () => {
    const a = p('A')
    const b = p('B')
    a.partnerId = b.id
    b.partnerId = a.id
    const off = applyGuestPatch([a, b], a.id, { coupleRuleEnabled: false })
    expect(off.map((g) => g.coupleRuleEnabled)).toEqual([false, false])
    const unlinked = applyGuestPatch([a, b], b.id, { partnerId: null })
    expect(unlinked.map((g) => g.partnerId)).toEqual([null, null])
  })

  it('keeps group membership in step with a group, and drops deleted groups and guests', () => {
    const a = p('A', { groupIds: ['g1'] })
    const b = p('B')
    const out = applyGroupMembers([a, b], { id: 'g2', memberIds: [a.id, b.id] })
    expect(out.map((g) => g.groupIds)).toEqual([['g1', 'g2'], ['g2']])
    const fewer = applyGroupMembers(out, { id: 'g2', memberIds: [b.id] })
    expect(fewer.map((g) => g.groupIds)).toEqual([['g1'], ['g2']])
    expect(fewer[1]).toBe(out[1])
    expect(dropGroup(out, 'g2').map((g) => g.groupIds)).toEqual([['g1'], []])
    const linked = applyGuestPatch([a, b], a.id, { partnerId: b.id })
    expect(dropGuest(linked, a.id)).toEqual([{ ...b, partnerId: null, coupleRuleEnabled: true }])
  })
})

describe('pasted names after editing', () => {
  it('blocks a line missing a first or last name', () => {
    expect(pastedRowError({ firstName: ' ', lastName: '' })).toBe('Needs a name')
    expect(pastedRowError({ firstName: 'Ann', lastName: '' })).toBe('Needs a last name')
    expect(pastedRowError({ firstName: '', lastName: 'Lee' })).toBe('Needs a first name')
    expect(pastedRowError({ firstName: 'Ann', lastName: 'Lee' })).toBeNull()
  })

  it('flags a line that still looks like two people', () => {
    expect(looksLikeTwoPeople({ firstName: 'John & Jane', lastName: 'Smith' })).toBe(true)
    expect(looksLikeTwoPeople({ firstName: 'John and', lastName: 'Jane Smith' })).toBe(true)
    expect(looksLikeTwoPeople({ firstName: 'Alexandra', lastName: 'Anderson' })).toBe(false)
  })
})

describe('pasted names that are already on the list (review finding)', () => {
  const r = (id: string, firstName: string, lastName: string) => ({ id, firstName, lastName })
  it('marks lines that match a guest, ignoring case and accents, and repeats among the lines', () => {
    const guests = [
      { firstName: 'Zoë', lastName: 'Kowalczyk' },
      { firstName: 'José', lastName: 'García' },
      { firstName: 'William', lastName: 'Ray', nickname: null },
    ]
    const rows = [
      r('a', 'zoe', 'KOWALCZYK'),
      r('b', 'Jose', 'Garcia'),
      r('c', 'Anna', 'Berg'),
      r('d', 'Anna', 'Berg'),
      r('e', 'Bill', 'Ray'),
      r('f', 'Tom', 'Lee'),
    ]
    const marks = pastedDuplicates(rows, guests)
    expect(Object.fromEntries(marks)).toEqual({
      a: 'Already on the list',
      b: 'Already on the list',
      d: 'Same name as line 3',
      e: 'Looks like William Ray, already on the list',
    })
  })

  it('marks nothing for a fresh list', () => {
    expect(pastedDuplicates([r('a', 'Ann', 'Lee'), r('b', 'Bo', 'Ray')], [{ firstName: 'Cy', lastName: 'Fox' }]).size).toBe(0)
  })
})
