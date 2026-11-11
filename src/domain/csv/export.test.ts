import { describe, expect, it } from 'vitest'
import { applyMapping, guessMapping, splitGroups, unguardCell } from './columns'
import { csvCell, groupsCell, guardCell, guestsCsvFileName, guestsToCsv, type ExportGuest } from './export'
import { parseCsv } from './parse'

const NOA_AIDEN = { partner1: 'Noa', partner2: 'Aiden' }

const guest = (id: string, firstName: string, lastName: string, extra: Partial<ExportGuest> = {}): ExportGuest => ({
  id,
  firstName,
  lastName,
  nickname: null,
  partnerId: null,
  household: null,
  side: 'both',
  rsvp: 'pending',
  meal: null,
  isChild: false,
  notes: null,
  groupIds: [],
  ...extra,
})

describe('guardCell and csvCell', () => {
  it('guards cells Excel would run as formulas', () => {
    for (const v of ['=1+1', '+44 20', '-vegan', '@home', '\tx', '\rx']) expect(guardCell(v)).toBe(`'${v}`)
    for (const v of ['Anna', "O'Connor", '', ' =x', '1+1']) expect(guardCell(v)).toBe(v)
  })

  it('guards a value that already starts with an apostrophe and a formula sign, so it round-trips (review finding)', () => {
    expect(guardCell("'=already quoted")).toBe("''=already quoted")
    expect(guardCell("''+1")).toBe("'''+1")
    expect(guardCell("'tis")).toBe("'tis")
    for (const v of ["'=already quoted", "''=x", '=1+1', "'-", "'tis", "O'Connor", "'", "''"]) {
      expect(unguardCell(guardCell(v))).toBe(v)
    }
  })

  it('quotes only when needed', () => {
    expect(csvCell('Anna')).toBe('Anna')
    expect(csvCell('Lee, Jr.')).toBe('"Lee, Jr."')
    expect(csvCell('Say "hi"')).toBe('"Say ""hi"""')
    expect(csvCell('one\ntwo')).toBe('"one\ntwo"')
    expect(csvCell('Noa Family; Work')).toBe('"Noa Family; Work"')
    expect(csvCell(' padded ')).toBe('" padded "')
    expect(csvCell('=1,2')).toBe(`"'=1,2"`)
  })
})

describe('guestsToCsv', () => {
  const groups = [
    { id: 'g-work', name: 'Work' },
    { id: 'g-fam', name: 'Noa Family' },
  ]
  const guests = [
    guest('id-1', 'Zoë', 'Kowalczyk', {
      partnerId: 'id-2',
      household: 'Kowalczyk',
      side: 'partner1',
      rsvp: 'yes',
      meal: 'Fish',
      notes: 'Nuts\nTable wish: window',
      groupIds: ['g-fam', 'g-work'],
    }),
    guest('id-2', 'Łukasz', 'Kowalczyk', { partnerId: 'id-1', isChild: true, meal: '=cmd' }),
  ]
  const csv = guestsToCsv(guests, groups, NOA_AIDEN)

  it('starts with a byte order mark and uses CRLF line ends', () => {
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv.endsWith('\r\n')).toBe(true)
    expect(csv.slice(1).split('\r\n')[0]).toBe(
      'first_name,last_name,partner,household,side,groups,rsvp,meal,child,notes,guest_id,nickname',
    )
  })

  it('writes the partner as a full name, groups joined with "; ", child as yes or no', () => {
    const parsed = parseCsv(csv)
    expect(parsed.rows).toEqual([
      {
        first_name: 'Zoë',
        last_name: 'Kowalczyk',
        partner: 'Łukasz Kowalczyk',
        household: 'Kowalczyk',
        side: 'Noa',
        groups: 'Work; Noa Family',
        rsvp: 'yes',
        meal: 'Fish',
        child: 'no',
        notes: 'Nuts\nTable wish: window',
        guest_id: 'id-1',
        nickname: '',
      },
      {
        first_name: 'Łukasz',
        last_name: 'Kowalczyk',
        partner: 'Zoë Kowalczyk',
        household: '',
        side: 'Both',
        groups: '',
        rsvp: 'pending',
        meal: "'=cmd",
        child: 'yes',
        notes: '',
        guest_id: 'id-2',
        nickname: '',
      },
    ])
  })

  it('keeps a lone group whose name holds a comma whole (review finding)', () => {
    expect(groupsCell(['Mom side, cousins'])).toBe('Mom side, cousins;')
    expect(groupsCell(['Mom side, cousins', 'Work'])).toBe('Mom side, cousins; Work')
    expect(groupsCell(['Work'])).toBe('Work')
    expect(groupsCell([])).toBe('')
    for (const names of [['Mom side, cousins'], ['A, B', 'C, D'], ['Work'], []]) {
      expect(splitGroups(groupsCell(names))).toEqual(names)
    }
    const one = guestsToCsv([guest('a', 'Ann', 'Lee', { groupIds: ['g'] })], [{ id: 'g', name: 'Mom side, cousins' }], NOA_AIDEN)
    expect(parseCsv(one).rows[0].groups).toBe('Mom side, cousins;')
  })

  it('writes the nickname last, after guest_id', () => {
    const one = guestsToCsv([guest('a', 'Robert', 'Smith', { nickname: 'Bobby' })], [], NOA_AIDEN)
    expect(parseCsv(one).rows[0]).toMatchObject({ guest_id: 'a', nickname: 'Bobby' })
  })

  it('leaves the partner blank when the partner is not in the list', () => {
    const lone = guestsToCsv([guest('a', 'Ana', 'Ruiz', { partnerId: 'gone' })], [], NOA_AIDEN)
    expect(parseCsv(lone).rows[0].partner).toBe('')
  })

  it("writes sides as the wedding's names, which read back as the same sides", () => {
    const three = [guest('a', 'Ann', 'Lee', { side: 'partner1' }), guest('b', 'Ben', 'Lee', { side: 'partner2' }), guest('c', 'Cy', 'Lee')]
    const read = (partners: { partner1: string | null; partner2: string | null }) => {
      const parsed = parseCsv(guestsToCsv(three, [], partners))
      return { cells: parsed.rows.map((r) => r.side), sides: applyMapping(parsed.rows, guessMapping(parsed.headers), partners).rows.map((r) => r.side) }
    }
    expect(read({ partner1: 'Sam', partner2: 'Alex' })).toEqual({ cells: ['Sam', 'Alex', 'Both'], sides: ['partner1', 'partner2', 'both'] })
    expect(read({ partner1: null, partner2: null })).toEqual({ cells: ['Partner 1', 'Partner 2', 'Both'], sides: ['partner1', 'partner2', 'both'] })
    // Two partners called Sam: "Sam" would read as neither, so the file says Partner 1 and Partner 2.
    expect(read({ partner1: 'Sam', partner2: 'Sam' })).toEqual({ cells: ['Partner 1', 'Partner 2', 'Both'], sides: ['partner1', 'partner2', 'both'] })
  })

  it('writes a header only for no guests', () => {
    expect(guestsToCsv([], [], NOA_AIDEN)).toBe('﻿first_name,last_name,partner,household,side,groups,rsvp,meal,child,notes,guest_id,nickname\r\n')
  })
})

describe('guestsCsvFileName', () => {
  it('names the file after the wedding and the date', () => {
    expect(guestsCsvFileName('Noa & Aiden', new Date(2027, 5, 12))).toBe('Noa & Aiden guests 2027-06-12.csv')
    expect(guestsCsvFileName('a/b:c', new Date(2027, 0, 2))).toBe('a b c guests 2027-01-02.csv')
    expect(guestsCsvFileName('  ', new Date(2027, 0, 2))).toBe('Guests 2027-01-02.csv')
  })
})
