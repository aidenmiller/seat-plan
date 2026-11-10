import { describe, expect, it } from 'vitest'
import { emptyCanvas, type Canvas, type Table } from '@/domain/canvas-schema'
import { makeItem } from '@/domain/presets'
import { guestIdsAtSeats, guestMenu, guestMenuLabel } from './guest-menu'
import { directory, guestFullName, guestShortName, pickPrompt, seatPickerGuests, UNKNOWN_GUEST, type PeopleGuest } from './people'

function guest(id: string, firstName: string, lastName: string, extra: Partial<PeopleGuest> = {}): PeopleGuest {
  return { id, firstName, lastName, nickname: null, rsvp: 'yes', partnerId: null, coupleRuleEnabled: true, ...extra }
}

const guests = [
  guest('g1', 'Jane', 'Doe'),
  guest('g2', 'Zoë', 'Kowalczyk', { nickname: 'Zozo' }),
  guest('g3', 'Ann', 'Adams', { rsvp: 'no' }),
  guest('g4', 'Ben', 'Brown', { rsvp: 'pending' }),
]

function canvasWith(seated: (string | null)[]): Canvas {
  const t = makeItem('round', { x: 0, y: 0 }, 't1', emptyCanvas()) as Table
  return { ...emptyCanvas(), items: [{ ...t, seats: t.seats.map((s, i) => ({ index: i, guestId: seated[i] ?? null })) }] }
}

describe('the people directory', () => {
  const dir = directory({ guests })

  it('names guests in full and short, with a plain word for one it does not know', () => {
    expect(guestFullName(dir, 'g1')).toBe('Jane Doe')
    expect(guestShortName(dir, 'g2')).toBe('Zoë K.')
    expect(guestFullName(dir, 'nobody')).toBe(UNKNOWN_GUEST)
    expect(pickPrompt(dir, 'g1')).toBe('Tap a seat for Jane D.')
  })

  it('lists unassigned guests for the + picker: no one seated, no one declined, by last name, searchable', () => {
    const c = canvasWith(['g1'])
    expect(seatPickerGuests(guests, c, '').map((g) => g.id)).toEqual(['g4', 'g2'])
    expect(seatPickerGuests(guests, c, 'zozo').map((g) => g.id)).toEqual(['g2'])
    expect(seatPickerGuests(guests, c, 'kow zo').map((g) => g.id)).toEqual(['g2'])
    expect(seatPickerGuests(guests, c, '', 1)).toHaveLength(1)
  })
})

describe('the guest menu', () => {
  it('offers Add to group and Unseat for selected guests in Edit mode, with room for more in front', () => {
    const unseated: string[][] = []
    const grouped: string[][] = []
    const menu = guestMenu({
      guestIds: ['g1', 'g2', 'g1'],
      mode: 'edit',
      unseat: (ids) => void unseated.push([...ids]),
      onAddToGroup: (ids) => void grouped.push([...ids]),
      extensions: [() => [{ id: 'together', label: 'Keep together', onSelect: () => undefined }]],
    })
    expect(menu?.label).toBe('2 guests menu')
    expect(menu?.items.map((i) => i.label)).toEqual(['Keep together', 'Add to group', 'Unseat'])
    menu?.items.find((i) => i.id === 'unseat')?.onSelect()
    menu?.items.find((i) => i.id === 'addToGroup')?.onSelect()
    expect(unseated).toEqual([['g1', 'g2']])
    expect(grouped).toEqual([['g1', 'g2']])
  })

  it('has no Add to group without a picker, and no menu in View mode or with nobody selected', () => {
    expect(guestMenu({ guestIds: ['g1'], mode: 'edit', unseat: () => undefined })?.items.map((i) => i.id)).toEqual(['unseat'])
    expect(guestMenu({ guestIds: ['g1'], mode: 'view', unseat: () => undefined })).toBeNull()
    expect(guestMenu({ guestIds: [], mode: 'edit', unseat: () => undefined })).toBeNull()
    expect(guestMenuLabel(1)).toBe('Guest menu')
  })

  it('finds the guests in selected seats, skipping empty seats', () => {
    const c = canvasWith(['g1', null, 'g2'])
    expect(
      guestIdsAtSeats(c, [
        { itemId: 't1', seatIndex: 2 },
        { itemId: 't1', seatIndex: 1 },
        { itemId: 't1', seatIndex: 0 },
        { itemId: 'gone', seatIndex: 0 },
      ]),
    ).toEqual(['g2', 'g1'])
  })
})
