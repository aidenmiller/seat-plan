import { describe, expect, it } from 'vitest'
import { matchPartners, partnerKeys, type PartnerCandidate } from './partner-match'

type Row = { rowNumber: number; firstName: string; lastName: string; partnerName?: string }
const row = (rowNumber: number, name: string, partnerName?: string): Row => {
  const [firstName, ...rest] = name.split(' ')
  return { rowNumber, firstName, lastName: rest.join(' '), ...(partnerName ? { partnerName } : {}) }
}
const guest = (id: string, name: string, partnerId: string | null = null): PartnerCandidate => {
  const [firstName, ...rest] = name.split(' ')
  return { id, firstName, lastName: rest.join(' '), partnerId }
}
const brief = (ms: ReturnType<typeof matchPartners>) =>
  ms.map((m) => ({ row: m.rowNumber, status: m.status, partner: m.partner, message: m.message }))

describe('matchPartners', () => {
  it('matches a pair inside the file, both ways', () => {
    const rows = [row(2, 'Zoë Kowalczyk', 'Łukasz Kowalczyk'), row(3, 'Łukasz Kowalczyk', 'Zoe KOWALCZYK')]
    expect(brief(matchPartners(rows, []))).toEqual([
      { row: 2, status: 'file', partner: { rowNumber: 3, guestId: null }, message: null },
      { row: 3, status: 'file', partner: { rowNumber: 2, guestId: null }, message: null },
    ])
  })

  it('matches when only one side names the other', () => {
    const rows = [row(2, 'Anna Lee', 'Tom Lee'), row(3, 'Tom Lee')]
    expect(brief(matchPartners(rows, []))).toEqual([
      { row: 2, status: 'file', partner: { rowNumber: 3, guestId: null }, message: null },
    ])
  })

  it('finds a guest whose own name holds an honorific or a comma (review finding)', () => {
    // A user's file: the first name holds "Dr.", so the name as written must be tried first.
    const rows: Row[] = [
      { rowNumber: 2, firstName: 'Dr. Jane', lastName: 'Smith', partnerName: 'Bob Smith' },
      { rowNumber: 3, firstName: 'Bob', lastName: 'Smith', partnerName: 'Dr. Jane Smith' },
    ]
    expect(brief(matchPartners(rows, []))).toEqual([
      { row: 2, status: 'file', partner: { rowNumber: 3, guestId: null }, message: null },
      { row: 3, status: 'file', partner: { rowNumber: 2, guestId: null }, message: null },
    ])
    // A last name with a comma, among existing guests.
    const guests: PartnerCandidate[] = [{ id: 'g-bob', firstName: 'Bob', lastName: 'Smith, Jr', partnerId: null }]
    expect(brief(matchPartners([row(2, 'Ann Lee', 'Bob Smith, Jr')], guests))).toEqual([
      { row: 2, status: 'existing', partner: { rowNumber: null, guestId: 'g-bob' }, message: null },
    ])
  })

  it('an already linked couple named with an honorific and a comma is settled, as our export writes them', () => {
    const guests: PartnerCandidate[] = [
      { id: 'g-jane', firstName: 'Dr. Jane', lastName: 'Smith', partnerId: 'g-bob' },
      { id: 'g-bob', firstName: 'Bob', lastName: 'Smith, Jr', partnerId: 'g-jane' },
    ]
    const rows: Row[] = [
      { rowNumber: 2, firstName: 'Dr. Jane', lastName: 'Smith', partnerName: 'Bob Smith, Jr' },
      { rowNumber: 3, firstName: 'Bob', lastName: 'Smith, Jr', partnerName: 'Dr. Jane Smith' },
    ]
    const ids = new Map([
      [2, 'g-jane'],
      [3, 'g-bob'],
    ])
    expect(brief(matchPartners(rows, guests, ids))).toEqual([
      { row: 2, status: 'file', partner: { rowNumber: 3, guestId: 'g-bob' }, message: null },
      { row: 3, status: 'file', partner: { rowNumber: 2, guestId: 'g-jane' }, message: null },
    ])
    // Only one side in the file: the partner they already have still settles it.
    expect(brief(matchPartners([rows[1]!], guests, new Map([[3, 'g-bob']])))).toEqual([
      { row: 3, status: 'existing', partner: { rowNumber: null, guestId: 'g-jane' }, message: null },
    ])
  })

  it('partnerKeys: the name as written first, then as a pasted name reads it', () => {
    expect(partnerKeys('Dr. Jane Smith')).toEqual(['dr jane smith', 'jane smith'])
    expect(partnerKeys('Smith, Jane')).toEqual(['smith, jane', 'jane smith'])
    expect(partnerKeys('Jane Smith')).toEqual(['jane smith'])
    expect(partnerKeys('  ')).toEqual([])
  })

  it('reads "Last, First" and honorifics in the partner cell', () => {
    const rows = [row(2, 'Anna Lee', 'Lee, Tom'), row(3, 'Tom Lee', 'Mrs. Anna Lee')]
    expect(matchPartners(rows, []).map((m) => m.status)).toEqual(['file', 'file'])
  })

  it('looks at the file first, then existing guests', () => {
    const rows = [row(2, 'Anna Lee', 'Tom Lee'), row(3, 'Tom Lee')]
    const guests = [guest('g-tom', 'Tom Lee')]
    // The file's Tom wins over the guest of the same name.
    expect(matchPartners(rows, guests)[0].partner).toEqual({ rowNumber: 3, guestId: null })
    // With no Tom in the file, the existing guest is found.
    expect(brief(matchPartners([row(2, 'Anna Lee', 'Tom Lee')], guests))).toEqual([
      { row: 2, status: 'existing', partner: { rowNumber: null, guestId: 'g-tom' }, message: null },
    ])
  })

  it('a guest the file also holds is reported as that row', () => {
    const rows = [row(2, 'Anna Lee', 'Tom Lee'), row(3, 'Thomas Lee')]
    const guests = [guest('g-tom', 'Tom Lee')]
    // Row 3 is guest g-tom, renamed through its guest_id.
    const result = matchPartners(rows, guests, new Map([[3, 'g-tom']]))
    expect(brief(result)).toEqual([{ row: 2, status: 'file', partner: { rowNumber: 3, guestId: 'g-tom' }, message: null }])
  })

  it('lists a name that matches no one', () => {
    expect(brief(matchPartners([row(2, 'Anna Lee', 'Nobody Known')], []))).toEqual([
      { row: 2, status: 'unmatched', partner: null, message: 'No guest is named Nobody Known' },
    ])
    expect(matchPartners([row(2, 'Anna Lee', 'Anna Lee')], [])[0].message).toBe(
      'This row names the same guest as partner',
    )
    expect(matchPartners([row(2, 'Anna Lee', 'Tom')], [])[0].status).toBe('unmatched')
  })

  it('lists a name that matches several people', () => {
    const rows = [row(2, 'Anna Lee', 'Sam Kim'), row(3, 'Sam Kim'), row(4, 'Sam Kim')]
    const [m] = matchPartners(rows, [])
    expect(m.status).toBe('ambiguous')
    expect(m.candidates).toEqual([
      { rowNumber: 3, guestId: null },
      { rowNumber: 4, guestId: null },
    ])
    expect(m.message).toBe('2 guests are named Sam Kim')
  })

  it('settles a shared name by who names this row back', () => {
    const rows = [row(2, 'Anna Lee', 'Sam Kim'), row(3, 'Sam Kim', 'Anna Lee'), row(4, 'Sam Kim')]
    expect(brief(matchPartners(rows, []))).toEqual([
      { row: 2, status: 'file', partner: { rowNumber: 3, guestId: null }, message: null },
      { row: 3, status: 'file', partner: { rowNumber: 2, guestId: null }, message: null },
    ])
  })

  it('several existing guests with the name are ambiguous too', () => {
    const guests = [guest('g1', 'Sam Kim'), guest('g2', 'Sam Kim')]
    const [m] = matchPartners([row(2, 'Anna Lee', 'Sam Kim')], guests)
    expect(m.status).toBe('ambiguous')
    expect(m.candidates.map((c) => c.guestId)).toEqual(['g1', 'g2'])
  })

  it('flags a partner who names someone else', () => {
    const rows = [row(2, 'Anna Lee', 'Tom Lee'), row(3, 'Tom Lee', 'Mia Chen'), row(4, 'Mia Chen', 'Tom Lee')]
    expect(brief(matchPartners(rows, []))).toEqual([
      {
        row: 2,
        status: 'one-sided',
        partner: { rowNumber: 3, guestId: null },
        message: 'Tom Lee names Mia Chen as partner',
      },
      { row: 3, status: 'file', partner: { rowNumber: 4, guestId: null }, message: null },
      { row: 4, status: 'file', partner: { rowNumber: 3, guestId: null }, message: null },
    ])
  })

  it('flags an existing guest who is already linked to someone else', () => {
    const guests = [guest('g-tom', 'Tom Lee', 'g-mia'), guest('g-mia', 'Mia Chen', 'g-tom')]
    expect(brief(matchPartners([row(2, 'Anna Lee', 'Tom Lee')], guests))).toEqual([
      {
        row: 2,
        status: 'one-sided',
        partner: { rowNumber: null, guestId: 'g-tom' },
        message: 'Tom Lee is already the partner of Mia Chen',
      },
    ])
  })

  it('an existing link between the same two people is fine', () => {
    const guests = [guest('g-anna', 'Anna Lee', 'g-tom'), guest('g-tom', 'Tom Lee', 'g-anna')]
    const result = matchPartners([row(2, 'Anna Lee', 'Tom Lee')], guests, new Map([[2, 'g-anna']]))
    expect(brief(result)).toEqual([
      { row: 2, status: 'existing', partner: { rowNumber: null, guestId: 'g-tom' }, message: null },
    ])
  })

  it('the current partner settles a name two guests share (re-import of our export)', () => {
    const guests = [
      guest('g-anna', 'Anna Lee', 'g-sam1'),
      guest('g-sam1', 'Sam Kim', 'g-anna'),
      guest('g-sam2', 'Sam Kim'),
    ]
    const rows = [row(2, 'Anna Lee', 'Sam Kim'), row(3, 'Sam Kim', 'Anna Lee'), row(4, 'Sam Kim')]
    const ids = new Map([
      [2, 'g-anna'],
      [3, 'g-sam1'],
      [4, 'g-sam2'],
    ])
    expect(brief(matchPartners(rows, guests, ids))).toEqual([
      { row: 2, status: 'file', partner: { rowNumber: 3, guestId: 'g-sam1' }, message: null },
      { row: 3, status: 'file', partner: { rowNumber: 2, guestId: 'g-anna' }, message: null },
    ])
  })

  it('flags two rows naming the same person', () => {
    const rows = [row(2, 'Anna Lee', 'Tom Lee'), row(3, 'Mia Chen', 'Tom Lee'), row(4, 'Tom Lee')]
    expect(brief(matchPartners(rows, []))).toEqual([
      {
        row: 2,
        status: 'shared',
        partner: { rowNumber: 4, guestId: null },
        message: 'Tom Lee is also named as partner on row 3',
      },
      {
        row: 3,
        status: 'shared',
        partner: { rowNumber: 4, guestId: null },
        message: 'Tom Lee is also named as partner on row 2',
      },
    ])
  })

  it('a pick wins over the name, and null means no partner', () => {
    const rows = [row(2, 'Anna Lee', 'Nobody Known'), row(3, 'Tom Lee'), row(4, 'Mia Chen', 'Somebody')]
    const guests = [guest('g-sam', 'Sam Kim')]
    const result = matchPartners(rows, guests, new Map(), { 2: { rowNumber: 3 }, 4: null })
    expect(brief(result)).toEqual([{ row: 2, status: 'file', partner: { rowNumber: 3, guestId: null }, message: null }])
    expect(result[0].picked).toBe(true)
    const toGuest = matchPartners(rows, guests, new Map(), { 2: { guestId: 'g-sam' }, 4: null })
    expect(toGuest[0].partner).toEqual({ rowNumber: null, guestId: 'g-sam' })
  })

  it('a pick of someone unknown, or of the row itself, asks again', () => {
    const rows = [row(2, 'Anna Lee', 'Tom Lee')]
    expect(matchPartners(rows, [], new Map(), { 2: { guestId: 'nope' } })[0]).toMatchObject({
      status: 'unmatched',
      message: 'Pick another guest',
    })
    expect(matchPartners(rows, [], new Map(), { 2: { rowNumber: 2 } })[0].status).toBe('unmatched')
  })

  it('a pick that gives someone a second partner is flagged', () => {
    const rows = [row(2, 'Anna Lee', 'Tom Lee'), row(3, 'Tom Lee', 'Anna Lee'), row(4, 'Mia Chen')]
    const result = matchPartners(rows, [], new Map(), { 4: { rowNumber: 3 } })
    expect(result.map((m) => [m.rowNumber, m.status])).toEqual([
      [2, 'shared'],
      [3, 'shared'],
      [4, 'shared'],
    ])
  })

  it('rows without a partner name give no result', () => {
    expect(matchPartners([row(2, 'Anna Lee'), row(3, 'Tom Lee')], [])).toEqual([])
  })
})
