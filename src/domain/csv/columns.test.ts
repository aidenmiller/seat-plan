import { describe, expect, it } from 'vitest'
import {
  applyMapping,
  cleanNotes,
  cleanOneLine,
  COLUMN_TARGETS,
  guessMapping,
  mappingProblems,
  normaliseChild,
  normaliseHeader,
  normaliseRsvp,
  normaliseSide,
  SAMPLE_COLUMNS,
  splitGroups,
  unguardCell,
  type ColumnMapping,
} from './columns'

const NOA_AIDEN = { partner1: 'Noa', partner2: 'Aiden' }
const SAM_ALEX = { partner1: 'Sam Rivera', partner2: 'Alex Chen' }
const UNNAMED = { partner1: null, partner2: null }

describe('guessMapping', () => {
  it("maps the sample file's own headers and guest_id", () => {
    const mapping = guessMapping([...SAMPLE_COLUMNS, 'guest_id', 'Table wish'])
    expect(mapping).toEqual({
      first_name: 'first_name',
      last_name: 'last_name',
      partner: 'partner',
      household: 'household',
      side: 'side',
      groups: 'groups',
      rsvp: 'rsvp',
      meal: 'meal',
      child: 'child',
      notes: 'notes',
      guest_id: 'guest_id',
      'Table wish': 'add_to_notes',
    })
  })

  it('knows the common synonyms', () => {
    const cases: [string, string][] = [
      ['First Name', 'first_name'],
      ['Given name', 'first_name'],
      ['Surname', 'last_name'],
      ['Family name', 'last_name'],
      ['Last', 'last_name'],
      ['Spouse', 'partner'],
      ['Plus one', 'partner'],
      ['Plus-One', 'partner'],
      ['+1', 'partner'],
      ['Partner name', 'partner'],
      ['Family', 'household'],
      ['Household', 'household'],
      ['Side', 'side'],
      ['Bride or groom', 'side'],
      ['Bride/Groom', 'side'],
      ['Groups', 'groups'],
      ['Tags', 'groups'],
      ['RSVP', 'rsvp'],
      ['Attending', 'rsvp'],
      ['Meal', 'meal'],
      ['Entrée', 'meal'],
      ['Dinner choice', 'meal'],
      ['Child', 'child'],
      ['Kid', 'child'],
      ['Age group', 'child'],
      ['Notes', 'notes'],
      ['Comments', 'notes'],
      ['Dietary', 'notes'],
      ['Guest ID', 'guest_id'],
    ]
    for (const [header, field] of cases) {
      expect([header, guessMapping([header])[header]]).toEqual([header, field])
    }
  })

  it('reads looser headers', () => {
    const mapping = guessMapping(['Guest First Name', 'Guest Last Name (required)', 'Meal choice (main)', 'RSVP status'])
    expect(mapping).toEqual({
      'Guest First Name': 'first_name',
      'Guest Last Name (required)': 'last_name',
      'Meal choice (main)': 'meal',
      'RSVP status': 'rsvp',
    })
  })

  it('does not take "Partner first name" for the guest\'s first name', () => {
    const mapping = guessMapping(['First name', 'Last name', 'Partner first name'])
    expect(mapping['Partner first name']).toBe('add_to_notes')
  })

  it('gives each field to one column, the closest match first', () => {
    const mapping = guessMapping(['Dietary', 'First', 'Notes', 'First Name', 'Last Name'])
    expect(mapping).toEqual({
      Dietary: 'add_to_notes',
      First: 'add_to_notes',
      Notes: 'notes',
      'First Name': 'first_name',
      'Last Name': 'last_name',
    })
  })

  it('a duplicate header goes to notes', () => {
    const mapping = guessMapping(['Notes', 'Notes (2)', 'first_name', 'last_name'])
    expect(mapping['Notes']).toBe('notes')
    expect(mapping['Notes (2)']).toBe('add_to_notes')
  })

  it('defaults unknown columns to Add to notes', () => {
    expect(guessMapping(['Table wish', 'Email', 'Column 4'])).toEqual({
      'Table wish': 'add_to_notes',
      Email: 'add_to_notes',
      'Column 4': 'add_to_notes',
    })
  })

  it('normaliseHeader folds case, accents and punctuation', () => {
    expect(normaliseHeader('First_Name')).toBe('first name')
    expect(normaliseHeader('  ENTRÉE ')).toBe('entree')
    expect(normaliseHeader('Last Name (required)')).toBe('last name')
    expect(normaliseHeader('Notes (2)')).toBe('notes')
  })
})

describe('mappingProblems', () => {
  it('needs first and last name', () => {
    expect(mappingProblems({ a: 'first_name' })).toEqual(['Pick the column for Last name'])
    expect(mappingProblems({})).toEqual(['Pick the column for First name', 'Pick the column for Last name'])
  })

  it('refuses a field picked twice, except notes', () => {
    expect(
      mappingProblems({ a: 'first_name', b: 'last_name', c: 'meal', d: 'meal', e: 'notes', f: 'notes', g: 'ignore', h: 'ignore' }),
    ).toEqual(['Meal is picked for more than one column'])
  })

  it('lists every target with a label', () => {
    expect(COLUMN_TARGETS.map((t) => t.target)).toEqual([
      'first_name',
      'last_name',
      'nickname',
      ...SAMPLE_COLUMNS.slice(2),
      'guest_id',
      'add_to_notes',
      'ignore',
    ])
  })
})

describe('values', () => {
  it("side: the wedding's names, Partner 1 / 2 or Both; bride and groom become both and are reported", () => {
    expect(normaliseSide('Noa', NOA_AIDEN)).toEqual({ value: 'partner1', understood: true })
    expect(normaliseSide("noa's side", NOA_AIDEN)).toEqual({ value: 'partner1', understood: true })
    expect(normaliseSide('AIDEN', NOA_AIDEN)).toEqual({ value: 'partner2', understood: true })
    expect(normaliseSide('Both', NOA_AIDEN)).toEqual({ value: 'both', understood: true })
    expect(normaliseSide('mutual', NOA_AIDEN)).toEqual({ value: 'both', understood: true })
    expect(normaliseSide('Partner 2', NOA_AIDEN)).toEqual({ value: 'partner2', understood: true })
    expect(normaliseSide('Bride', NOA_AIDEN)).toEqual({ value: 'both', understood: false })
    expect(normaliseSide('groom', NOA_AIDEN)).toEqual({ value: 'both', understood: false })
    expect(normaliseSide('xyz', NOA_AIDEN)).toEqual({ value: 'both', understood: false })
    expect(normaliseSide('  ', NOA_AIDEN)).toEqual({ value: undefined, understood: true })
  })

  it("side: another wedding's names, first names and possessives; Noa and Aiden mean nothing there", () => {
    expect(normaliseSide('Sam', SAM_ALEX)).toEqual({ value: 'partner1', understood: true })
    expect(normaliseSide('Sam Rivera', SAM_ALEX)).toEqual({ value: 'partner1', understood: true })
    expect(normaliseSide('Sams side', SAM_ALEX)).toEqual({ value: 'partner1', understood: true })
    expect(normaliseSide('Alex’s Side', SAM_ALEX)).toEqual({ value: 'partner2', understood: true })
    expect(normaliseSide('p1', SAM_ALEX)).toEqual({ value: 'partner1', understood: true })
    expect(normaliseSide('Noa', SAM_ALEX)).toEqual({ value: 'both', understood: false })
    expect(normaliseSide('Aiden', SAM_ALEX)).toEqual({ value: 'both', understood: false })
  })

  it('side: with no names, Partner 1, Partner 2 and Both only', () => {
    expect(normaliseSide('Partner 1', UNNAMED)).toEqual({ value: 'partner1', understood: true })
    expect(normaliseSide('partner2', UNNAMED)).toEqual({ value: 'partner2', understood: true })
    expect(normaliseSide('Both sides', UNNAMED)).toEqual({ value: 'both', understood: true })
    expect(normaliseSide('Noa', UNNAMED)).toEqual({ value: 'both', understood: false })
  })

  it('rsvp: yes, no or pending', () => {
    for (const v of ['yes', 'Y', 'Attending', 'accepted', '1', 'TRUE'])
      expect(normaliseRsvp(v)).toEqual({ value: 'yes', understood: true })
    for (const v of ['no', 'N', 'Declined', 'regrets', '0', 'Not attending'])
      expect(normaliseRsvp(v)).toEqual({ value: 'no', understood: true })
    for (const v of ['pending', 'Maybe', 'no response', '?'])
      expect(normaliseRsvp(v)).toEqual({ value: 'pending', understood: true })
    expect(normaliseRsvp('')).toEqual({ value: undefined, understood: true })
    expect(normaliseRsvp('later this week')).toEqual({ value: undefined, understood: false })
  })

  it('child: yes, y, true, 1, child, kid are true', () => {
    for (const v of ['yes', 'Y', 'true', '1', 'Child', 'kid', 'x', '✓'])
      expect(normaliseChild(v)).toEqual({ value: true, understood: true })
    for (const v of ['no', 'N', 'false', '0', 'Adult']) expect(normaliseChild(v)).toEqual({ value: false, understood: true })
    expect(normaliseChild('')).toEqual({ value: undefined, understood: true })
    expect(normaliseChild('13')).toEqual({ value: undefined, understood: false })
  })

  it('groups split on ";" and on "," only when there is no ";"', () => {
    expect(splitGroups('Noa Family; Noa Cousins')).toEqual(['Noa Family', 'Noa Cousins'])
    expect(splitGroups('Work, Book Club')).toEqual(['Work', 'Book Club'])
    expect(splitGroups('Smith, Jones Family; Work')).toEqual(['Smith, Jones Family', 'Work'])
    expect(splitGroups(' ; Noa  Family ;; noa family ; ')).toEqual(['Noa Family'])
    expect(splitGroups('')).toEqual([])
  })

  it('nickname: guessed from its usual headers, and read into the row (review finding)', () => {
    for (const h of ['Nickname', 'Nick name', 'Preferred name', 'Goes by', 'Known as', 'Preferred first name']) {
      expect(guessMapping(['First', 'Last', h])[h]).toBe('nickname')
    }
    // The partner's nickname is not the guest's own, and not a partner name either.
    expect(guessMapping(['First', 'Last', 'Partner nickname'])['Partner nickname']).toBe('add_to_notes')
    const mapped = applyMapping([{ First: 'Robert', Last: 'Smith', Nickname: ' Bobby ' }], guessMapping(['First', 'Last', 'Nickname']), NOA_AIDEN)
    expect(mapped.rows[0]).toMatchObject({ firstName: 'Robert', nickname: 'Bobby', extraNotes: [] })
  })

  it('cleanOneLine and cleanNotes store text in NFC (review finding)', () => {
    expect(cleanOneLine(' Zoe\u0308  Nowak ')).toBe('Zoë Nowak')
    expect(cleanOneLine('Zoe\u0308')).toBe('Zo\u00eb')
    expect(cleanNotes('Cafe\u0301\r\nowner')).toBe('Caf\u00e9\nowner')
  })

  it('unguardCell removes one apostrophe from a guarded cell only', () => {
    expect(unguardCell("''=already quoted")).toBe("'=already quoted")
    expect(unguardCell("'''+1")).toBe("''+1")
    expect(unguardCell("'")).toBe("'")
  })

  it('unguardCell removes the apostrophe our export adds', () => {
    expect(unguardCell("'=SUM(A1)")).toBe('=SUM(A1)')
    expect(unguardCell("'-vegan")).toBe('-vegan')
    expect(unguardCell("'+1")).toBe('+1')
    expect(unguardCell("'@home")).toBe('@home')
    expect(unguardCell("O'Connor")).toBe("O'Connor")
    expect(unguardCell("'tis")).toBe("'tis")
  })
})

describe('applyMapping', () => {
  const headers = [...SAMPLE_COLUMNS, 'Table wish']
  const mapping = guessMapping(headers)
  const row = (values: Partial<Record<string, string>>) => Object.fromEntries(headers.map((h) => [h, values[h] ?? '']))

  it('builds ImportRows with normalised values and extra notes', () => {
    const result = applyMapping(
      [
        row({
          first_name: ' Zoë ',
          last_name: 'Kowalczyk',
          partner: 'Łukasz  Kowalczyk',
          household: 'Kowalczyk',
          side: 'noa',
          groups: 'Noa Family; Noa Cousins',
          rsvp: 'Yes',
          meal: 'Fish',
          child: 'no',
          notes: 'Allergic to nuts',
          'Table wish': 'Near the dance floor',
        }),
      ],
      mapping,
      NOA_AIDEN,
    )
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.rows).toEqual([
      {
        rowNumber: 2,
        firstName: 'Zoë',
        lastName: 'Kowalczyk',
        partnerName: 'Łukasz Kowalczyk',
        household: 'Kowalczyk',
        side: 'partner1',
        rsvp: 'yes',
        meal: 'Fish',
        isChild: false,
        notes: 'Allergic to nuts',
        groups: ['Noa Family', 'Noa Cousins'],
        extraNotes: ['Table wish: Near the dance floor'],
      },
    ])
  })

  it('leaves blank cells out, so they change nothing', () => {
    const result = applyMapping([row({ first_name: 'Anna', last_name: 'Lee' })], mapping, NOA_AIDEN)
    expect(result.rows).toEqual([{ rowNumber: 2, firstName: 'Anna', lastName: 'Lee', groups: [], extraNotes: [] }])
  })

  it('uses the row numbers given', () => {
    const result = applyMapping([row({ first_name: 'Anna', last_name: 'Lee' })], mapping, NOA_AIDEN, [7])
    expect(result.rows[0].rowNumber).toBe(7)
  })

  it('leaves out rows without a first or last name, with why', () => {
    const result = applyMapping(
      [row({ first_name: 'Anna' }), row({ last_name: 'Lee' }), row({ notes: 'just a note' })],
      mapping,
      NOA_AIDEN,
    )
    expect(result.rows).toEqual([])
    expect(result.errors).toEqual([
      { rowNumber: 2, field: 'last_name', message: 'Needs a last name' },
      { rowNumber: 3, field: 'first_name', message: 'Needs a first name' },
      { rowNumber: 4, field: 'first_name', message: 'Needs a first and last name' },
    ])
  })

  it('reports values it does not understand', () => {
    const result = applyMapping(
      [row({ first_name: 'Anna', last_name: 'Lee', side: 'Bride', rsvp: 'soon', child: 'teen' })],
      mapping,
      NOA_AIDEN,
    )
    expect(result.rows[0].side).toBe('both')
    expect(result.rows[0].rsvp).toBeUndefined()
    expect(result.rows[0].isChild).toBeUndefined()
    expect(result.warnings.map((w) => w.field)).toEqual(['side', 'rsvp', 'child'])
    expect(result.warnings[0].message).toBe('Side "Bride" is not Noa, Aiden or Both, so it is set to Both')
  })

  it("reads sides with the wedding's names, and names them in the warning", () => {
    const result = applyMapping(
      [row({ first_name: 'Anna', last_name: 'Lee', side: "Alex's" }), row({ first_name: 'Ben', last_name: 'Lee', side: 'Noa' })],
      mapping,
      { partner1: 'Sam', partner2: 'Alex' },
    )
    expect(result.rows.map((r) => r.side)).toEqual(['partner2', 'both'])
    expect(result.warnings.map((w) => w.message)).toEqual(['Side "Noa" is not Sam, Alex or Both, so it is set to Both'])
    const unnamed = applyMapping([row({ first_name: 'Anna', last_name: 'Lee', side: 'Bride' })], mapping, UNNAMED)
    expect(unnamed.warnings[0].message).toBe('Side "Bride" is not Partner 1, Partner 2 or Both, so it is set to Both')
  })

  it('reads guest_id only when it is one of ours', () => {
    const m: ColumnMapping = { ...mapping, guest_id: 'guest_id' }
    const id = '3F2504E0-4F89-41D3-9A0C-0305E82C3301'
    const ok = applyMapping([{ ...row({ first_name: 'Anna', last_name: 'Lee' }), guest_id: id }], m, NOA_AIDEN)
    expect(ok.rows[0].guestId).toBe(id.toLowerCase())
    const bad = applyMapping([{ ...row({ first_name: 'Anna', last_name: 'Lee' }), guest_id: '1234' }], m, NOA_AIDEN)
    expect(bad.rows[0].guestId).toBeUndefined()
    expect(bad.warnings[0].field).toBe('guest_id')
  })

  it('ignores Ignore columns and joins several notes columns', () => {
    const m: ColumnMapping = { First: 'first_name', Last: 'last_name', A: 'notes', B: 'notes', C: 'ignore' }
    const result = applyMapping([{ First: 'Anna', Last: 'Lee', A: 'one', B: 'two', C: 'secret' }], m, NOA_AIDEN)
    expect(result.rows[0].notes).toBe('one\ntwo')
    expect(result.rows[0].extraNotes).toEqual([])
  })

  it('takes the first non-blank column when a field is picked twice', () => {
    const m: ColumnMapping = { First: 'first_name', Last: 'last_name', M1: 'meal', M2: 'meal' }
    expect(applyMapping([{ First: 'A', Last: 'B', M1: '', M2: 'Fish' }], m, NOA_AIDEN).rows[0].meal).toBe('Fish')
  })

  it('cleans text: NUL characters, line ends in notes, guarded cells', () => {
    const result = applyMapping(
      [row({ first_name: 'An\u0000na', last_name: 'Lee', notes: "'-likes dancing\r\n  second   line ", meal: "'=1+1" })],
      mapping,
      NOA_AIDEN,
    )
    expect(result.rows[0]).toMatchObject({ firstName: 'Anna', notes: '-likes dancing\nsecond line', meal: '=1+1' })
  })
})
