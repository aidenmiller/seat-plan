import { describe, expect, it } from 'vitest'
import { decodePartnerPick, encodePartnerPick, keepPicks, missingSeatLines, picksBody } from './picks'

describe('import review choices', () => {
  it('round-trips partner choices through the select value', () => {
    for (const pick of [undefined, null, { rowNumber: 4 }, { guestId: 'abc' }]) {
      expect(decodePartnerPick(encodePartnerPick(pick))).toEqual(pick)
    }
    expect(decodePartnerPick('r:x')).toBeUndefined()
    expect(decodePartnerPick('junk')).toBeUndefined()
  })

  it('sends row numbers as keys and leaves out rows with no choice', () => {
    const picks = new Map<number, string | undefined>([
      [4, 'new'],
      [7, undefined],
      [9, 'g1'],
    ])
    expect(picksBody(picks)).toEqual({ 4: 'new', 9: 'g1' })
    expect(picksBody(new Map([[3, null]]))).toEqual({ 3: null })
  })

  it('names the layouts and tables removing missing guests touches', () => {
    const lines = missingSeatLines(
      [
        { guestId: 'a', layoutId: 'l1', layoutName: 'Reception plan', itemLabel: 'Table 3' },
        { guestId: 'b', layoutId: 'l1', layoutName: 'Reception plan', itemLabel: 'Table 5' },
        { guestId: 'a', layoutId: 'l2', layoutName: 'Ceremony plan', itemLabel: 'Row 1' },
      ],
      (id) => (id === 'a' ? 'Ann Lee' : 'Bob Ray'),
    )
    expect(lines).toEqual(['Reception plan: Table 3 (Ann Lee), Table 5 (Bob Ray)', 'Ceremony plan: Row 1 (Ann Lee)'])
  })

  it('keeps picks across a column change while their rows read the same (review finding)', () => {
    const before = [
      { rowNumber: 2, firstName: 'Sam', lastName: 'Lee', partnerName: 'Ann Lee' },
      { rowNumber: 3, firstName: 'Ann', lastName: 'Lee' },
      { rowNumber: 4, firstName: 'Cy', lastName: 'Ray', partnerName: 'Dee' },
      { rowNumber: 5, firstName: 'Ed', lastName: 'Fox' },
    ]
    // Meal was matched to another column: names and partners read the same, except row 4's partner and row 5 dropped.
    const after = [
      { rowNumber: 2, firstName: 'Sam', lastName: 'Lee', partnerName: 'Ann Lee' },
      { rowNumber: 3, firstName: 'Ann', lastName: 'Lee' },
      { rowNumber: 4, firstName: 'Cy', lastName: 'Ray', partnerName: 'Dee Ray' },
    ]
    const kept = keepPicks(
      {
        reviewPicks: new Map([
          [2, 'g-sam'],
          [5, 'new'],
        ]),
        partnerPicks: new Map([
          [2, { rowNumber: 3 }],
          [3, null],
          [4, { guestId: 'g-dee' }],
        ]),
        removeMissing: true,
      },
      before,
      after,
    )
    expect(kept.reviewPicks).toEqual(new Map([[2, 'g-sam']]))
    expect(kept.partnerPicks).toEqual(
      new Map<number, unknown>([
        [2, { rowNumber: 3 }],
        [3, null],
      ]),
    )
    expect(kept.removeMissing).toBe(true)
    // A pick of a row that now holds someone else goes.
    const renamed = [after[0]!, { rowNumber: 3, firstName: 'Bo', lastName: 'Lee' }]
    expect(keepPicks({ reviewPicks: new Map(), partnerPicks: new Map([[2, { rowNumber: 3 }]]), removeMissing: false }, before, renamed).partnerPicks.size).toBe(0)
  })
})
