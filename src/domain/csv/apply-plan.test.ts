import { describe, expect, it } from 'vitest'
import { applyPlan } from './apply-plan'
import { planImport, type ExistingGuest } from './import-diff'

const guest = (id: string, firstName: string, lastName: string, extra: Partial<ExistingGuest> = {}): ExistingGuest => ({
  id,
  firstName,
  lastName,
  nickname: null,
  partnerId: null,
  household: null,
  side: 'Both',
  rsvp: 'pending',
  meal: null,
  isChild: false,
  notes: null,
  groups: [],
  ...extra,
})

describe('applyPlan', () => {
  it('adds new guests, patches changed ones, adds groups and links partners', () => {
    const guests = [guest('g1', 'Ana', 'Ruiz', { groups: ['Work'] })]
    const plan = planImport(
      [
        { rowNumber: 2, firstName: 'Ana', lastName: 'Ruiz', meal: 'Fish', groups: ['Gym'], extraNotes: [], partnerName: 'Bo Lee' },
        { rowNumber: 3, firstName: 'Bo', lastName: 'Lee', groups: ['gym'], extraNotes: [] },
      ],
      guests,
    )
    const { guests: after, groupNames } = applyPlan(plan, guests, { newId: (n) => `row-${n}` })
    expect(after).toEqual([
      guest('g1', 'Ana', 'Ruiz', { meal: 'Fish', groups: ['Work', 'Gym'], partnerId: 'row-3' }),
      guest('row-3', 'Bo', 'Lee', { groups: ['Gym'], partnerId: 'g1' }),
    ])
    expect(groupNames).toEqual(['Work', 'Gym'])
  })

  it('removes missing guests only when asked, and unlinks their partners', () => {
    const guests = [guest('g1', 'Ana', 'Ruiz', { partnerId: 'g2' }), guest('g2', 'Bo', 'Lee', { partnerId: 'g1' })]
    const plan = planImport([{ rowNumber: 2, firstName: 'Ana', lastName: 'Ruiz', groups: [], extraNotes: [] }], guests)
    expect(applyPlan(plan, guests, { newId: String }).guests).toHaveLength(2)
    const removed = applyPlan(plan, guests, { newId: String, removeMissing: true }).guests
    expect(removed).toEqual([guest('g1', 'Ana', 'Ruiz')])
  })

  it('does not change the guests it was given', () => {
    const guests = [guest('g1', 'Ana', 'Ruiz', { groups: ['Work'] })]
    const plan = planImport([{ rowNumber: 2, firstName: 'Ana', lastName: 'Ruiz', groups: ['Gym'], extraNotes: [] }], guests)
    applyPlan(plan, guests, { newId: String })
    expect(guests[0].groups).toEqual(['Work'])
  })
})
