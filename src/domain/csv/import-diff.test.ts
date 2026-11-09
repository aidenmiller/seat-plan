import { describe, expect, it } from 'vitest'
import { applyPlan } from './apply-plan'
import { applyMapping, guessMapping, type ImportRow } from './columns'
import { decodeCsvBytes } from './decode'
import { guestsToCsv, type ExportGroup, type ExportGuest } from './export'
import { planImport, type ExistingGuest, type ImportOptions, type ImportPlan } from './import-diff'
import { parseCsv } from './parse'
import { SAMPLE_CSV_FILE } from './sample'

// --- Fixtures ----------------------------------------------------------------

const guest = (id: string, name: string, extra: Partial<ExistingGuest> = {}): ExistingGuest => {
  const [firstName, ...rest] = name.split(' ')
  return {
    id,
    firstName,
    lastName: rest.join(' '),
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
  }
}

let rowCounter = 100
const row = (name: string, extra: Partial<ImportRow> = {}): ImportRow => {
  const [firstName, ...rest] = name.split(' ')
  return { rowNumber: rowCounter++, firstName, lastName: rest.join(' '), groups: [], extraNotes: [], ...extra }
}

/** The rows a CSV file gives, through the same steps the browser runs. */
function rowsFromFile(text: string | Uint8Array): ImportRow[] {
  const decoded = typeof text === 'string' ? { text, delimiter: null } : decodeCsvBytes(text)
  const parsed = parseCsv(decoded.text, decoded.delimiter)
  expect(parsed.errors).toEqual([])
  const mapped = applyMapping(parsed.rows, guessMapping(parsed.headers), parsed.rowNumbers)
  expect(mapped.errors).toEqual([])
  return mapped.rows
}

const newId = (rowNumber: number) => `new-${rowNumber}`

/** Imports, applies, and returns the guests after, with the plan. */
function importInto(
  guests: ExistingGuest[],
  rows: ImportRow[],
  options: ImportOptions = {},
): { plan: ImportPlan; guests: ExistingGuest[]; groupNames: string[] } {
  const plan = planImport(rows, guests, options)
  const applied = applyPlan(plan, guests, {
    newId,
    existingGroupNames: options.existingGroupNames,
  })
  return { plan, ...applied }
}

const nameOf = (g: { firstName: string; lastName: string }) => `${g.firstName} ${g.lastName}`

// --- The sample file -----------------------------------------------------------

describe('importing the sample file', () => {
  const rows = rowsFromFile(SAMPLE_CSV_FILE)

  it('adds ten guests, their groups and two couples into an empty wedding', () => {
    const plan = planImport(rows, [])
    expect(plan.counts).toEqual({ new: 10, changed: 0, unchanged: 0, needsReview: 0, missing: 0 })
    expect(plan.groupsToCreate).toEqual([
      'Noa Family',
      'Noa Cousins',
      'Aiden HS Friends',
      'Book Club',
      'Work Friends',
      'Aiden Family',
      'Noa College',
      'Aiden Cousins',
    ])
    expect(plan.partnerLinks.map((l) => [l.aName, l.bName])).toEqual([
      ['Zoë Kowalczyk', 'Łukasz Kowalczyk'],
      ["Daniel O'Connor", 'Priya Raman'],
    ])
    expect(plan.partnerProblems).toEqual([])
    expect(plan.duplicates).toEqual([])
    const zoe = plan.newGuests[0].guest
    expect(zoe).toEqual({
      firstName: 'Zoë',
      lastName: 'Kowalczyk',
      nickname: null,
      household: 'Kowalczyk',
      side: 'Noa',
      rsvp: 'yes',
      meal: 'Fish',
      isChild: false,
      notes: 'Allergic to nuts\nTable wish: Near the dance floor',
    })
    const mia = plan.newGuests.find((n) => n.guest.firstName === 'Mia')!
    expect(mia.guest.isChild).toBe(true)
  })

  it('twice creates no duplicates: the second import reports 0 new and 0 changed (acceptance 13)', () => {
    const first = importInto([], rows)
    expect(first.guests).toHaveLength(10)
    const zoe = first.guests.find((g) => g.firstName === 'Zoë')!
    expect(nameOf(first.guests.find((g) => g.id === zoe.partnerId)!)).toBe('Łukasz Kowalczyk')

    const second = planImport(rowsFromFile(SAMPLE_CSV_FILE), first.guests, { existingGroupNames: first.groupNames })
    expect(second.counts).toEqual({ new: 0, changed: 0, unchanged: 10, needsReview: 0, missing: 0 })
    expect(second.groupsToCreate).toEqual([])
    expect(second.partnerLinks).toEqual([])
    expect(second.partnerProblems).toEqual([])
    expect(second.duplicates).toEqual([])
    expect(second.unchanged.every((u) => u.matchedBy === 'name')).toBe(true)
  })
})

// --- Matching ------------------------------------------------------------------

describe('matching rows to guests', () => {
  it('matches names ignoring case and accents, and keeps the stored spelling', () => {
    const guests = [guest('g1', 'Zoë Kowalczyk'), guest('g2', 'Łukasz Nowak')]
    const plan = planImport([row('ZOE kowalczyk'), row('Lukasz NOWAK')], guests)
    expect(plan.counts).toMatchObject({ new: 0, changed: 0, unchanged: 2 })
    expect(plan.unchanged.map((u) => u.guestId)).toEqual(['g1', 'g2'])
  })

  it('a name that matches two live guests waits for a pick and is not applied', () => {
    const guests = [
      guest('g1', 'Sam Lee', { household: 'Lee family' }),
      guest('g2', 'Sam Lee', { household: 'Lee-Park' }),
      guest('g3', 'Ana Ruiz'),
    ]
    const r = row('Sam Lee', { meal: 'Fish', groups: ['Cousins'] })
    const plan = planImport([r, row('Ana Ruiz')], guests)
    expect(plan.counts).toEqual({ new: 0, changed: 0, unchanged: 1, needsReview: 1, missing: 0 })
    expect(plan.needsReview[0]).toMatchObject({ rowNumber: r.rowNumber, message: '2 guests have this name' })
    expect(plan.needsReview[0].candidates.map((c) => [c.guestId, c.household])).toEqual([
      ['g1', 'Lee family'],
      ['g2', 'Lee-Park'],
    ])
    // Nothing from the row is applied, not even its groups.
    expect(plan.groupsToCreate).toEqual([])
    // Candidates are not "missing": the row may be either of them.
    expect(plan.missing).toEqual([])
  })

  it('a pick applies the row to the chosen guest', () => {
    const guests = [guest('g1', 'Sam Lee'), guest('g2', 'Sam Lee')]
    const r = row('Sam Lee', { meal: 'Fish' })
    const plan = planImport([r], guests, { reviewPicks: { [r.rowNumber]: 'g2' } })
    expect(plan.needsReview).toEqual([])
    expect(plan.changed).toMatchObject([{ guestId: 'g2', matchedBy: 'pick', patch: { meal: 'Fish' } }])
    expect(plan.missing.map((m) => m.guestId)).toEqual(['g1'])
  })

  it('a pick of "new" adds the row as a new guest', () => {
    const guests = [guest('g1', 'Sam Lee'), guest('g2', 'Sam Lee')]
    const r = row('Sam Lee')
    const plan = planImport([r], guests, { reviewPicks: { [r.rowNumber]: 'new' } })
    expect(plan.counts).toMatchObject({ new: 1, needsReview: 0, missing: 2 })
    // A third Sam Lee is worth a second look.
    expect(plan.duplicates.map((d) => d.reason)).toEqual(['same-name', 'same-name'])
  })

  it('two rows matching one guest both wait for a pick', () => {
    const guests = [guest('g1', 'Sam Lee')]
    const a = row('Sam Lee')
    const b = row('sam lee')
    const plan = planImport([a, b], guests)
    expect(plan.counts).toMatchObject({ new: 0, unchanged: 0, needsReview: 2 })
    expect(plan.needsReview.map((x) => x.message)).toEqual([
      `Row ${b.rowNumber} also matches this guest`,
      `Row ${a.rowNumber} also matches this guest`,
    ])
    // Picking one for the guest and "new" for the other settles it.
    const picked = planImport([a, b], guests, { reviewPicks: { [a.rowNumber]: 'g1', [b.rowNumber]: 'new' } })
    expect(picked.counts).toMatchObject({ new: 1, unchanged: 1, needsReview: 0 })
  })

  it('matches on guest_id first, and only then on the name', () => {
    const guests = [guest('g1', 'Sam Lee'), guest('g2', 'Sam Lee')]
    const plan = planImport([row('Samuel Lee', { guestId: 'g2' }), row('Sam Lee', { guestId: 'g1' })], guests)
    expect(plan.needsReview).toEqual([])
    expect(plan.changed).toMatchObject([
      {
        guestId: 'g2',
        matchedBy: 'id',
        changes: [{ field: 'firstName', before: 'Sam', after: 'Samuel' }],
        patch: { firstName: 'Samuel' },
      },
    ])
    expect(plan.unchanged).toMatchObject([{ guestId: 'g1', matchedBy: 'id' }])
  })

  it('a row whose name matches a guest another row has by guest_id waits for a pick', () => {
    const guests = [guest('g1', 'Sam Lee')]
    const a = row('Sam Lee', { guestId: 'g1' })
    const b = row('Sam Lee')
    const plan = planImport([a, b], guests)
    expect(plan.unchanged).toMatchObject([{ rowNumber: a.rowNumber, guestId: 'g1' }])
    expect(plan.needsReview).toMatchObject([
      { rowNumber: b.rowNumber, message: `Row ${a.rowNumber} is already matched to this guest` },
    ])
  })

  it('a repeated guest_id: the first row keeps it, the second waits', () => {
    const guests = [guest('g1', 'Sam Lee')]
    const a = row('Sam Lee', { guestId: 'g1' })
    const b = row('Sam Lee', { guestId: 'g1', meal: 'Fish' })
    const plan = planImport([a, b], guests)
    expect(plan.unchanged.map((u) => u.rowNumber)).toEqual([a.rowNumber])
    expect(plan.needsReview).toMatchObject([{ rowNumber: b.rowNumber, message: `Row ${a.rowNumber} has the same guest_id` }])
  })

  it('a guest_id that is not a live guest falls back to the name', () => {
    const guests = [guest('g1', 'Sam Lee')]
    const plan = planImport([row('Sam Lee', { guestId: 'gone' }), row('Ana Ruiz', { guestId: 'gone-too' })], guests)
    expect(plan.unchanged).toMatchObject([{ guestId: 'g1', matchedBy: 'name' }])
    expect(plan.newGuests.map((n) => n.guest.firstName)).toEqual(['Ana'])
  })

  it('lists live guests missing from the file, by last name', () => {
    const guests = [guest('g1', 'Sam Lee'), guest('g2', 'Ana Ruiz'), guest('g3', 'Bo Adams'), guest('g4', 'Cy Adams')]
    const plan = planImport([row('Sam Lee')], guests)
    expect(plan.missing).toEqual([
      { guestId: 'g3', firstName: 'Bo', lastName: 'Adams' },
      { guestId: 'g4', firstName: 'Cy', lastName: 'Adams' },
      { guestId: 'g2', firstName: 'Ana', lastName: 'Ruiz' },
    ])
    const applied = applyPlan(plan, guests, { newId: String, removeMissing: true })
    expect(applied.guests.map((g) => g.id)).toEqual(['g1'])
  })
})

// --- Changes -----------------------------------------------------------------------

describe('changed fields', () => {
  const base = guest('g1', 'Ana Ruiz', {
    household: 'Ruiz',
    side: 'Noa',
    rsvp: 'pending',
    meal: 'Fish',
    isChild: false,
    notes: 'Likes jazz',
    groups: ['Noa Family'],
  })

  it('blank cells leave fields as they were', () => {
    const plan = planImport([row('Ana Ruiz')], [base])
    expect(plan.counts).toMatchObject({ changed: 0, unchanged: 1 })
  })

  it('lists each changed field with before and after', () => {
    const plan = planImport(
      [row('Ana Ruiz', { household: 'Ruiz-Lee', side: 'Aiden', rsvp: 'yes', meal: 'Beef', isChild: true })],
      [base],
    )
    expect(plan.changed[0].changes).toEqual([
      { field: 'household', before: 'Ruiz', after: 'Ruiz-Lee' },
      { field: 'meal', before: 'Fish', after: 'Beef' },
      { field: 'side', before: 'Noa', after: 'Aiden' },
      { field: 'rsvp', before: 'pending', after: 'yes' },
      { field: 'isChild', before: 'No', after: 'Yes' },
    ])
    expect(plan.changed[0].patch).toEqual({ household: 'Ruiz-Lee', meal: 'Beef', side: 'Aiden', rsvp: 'yes', isChild: true })
    expect(plan.changed[0].name).toBe('Ana Ruiz')
  })

  it('a name match never renames, even when accents or case differ', () => {
    const plan = planImport([row('ANA RUÍZ')], [base])
    expect(plan.counts).toMatchObject({ changed: 0, unchanged: 1 })
  })

  it('stored values with extra spaces still count as the same', () => {
    const messy = { ...base, household: '  Ruiz ', meal: 'Fish  ' }
    expect(planImport([row('Ana Ruiz', { household: 'Ruiz', meal: 'Fish' })], [messy]).counts.changed).toBe(0)
  })

  it('groups are only added, matched to existing groups ignoring case', () => {
    const plan = planImport([row('Ana Ruiz', { groups: ['noa family', 'Book Club', 'book club'] })], [base], {
      existingGroupNames: ['Noa Family', 'BOOK CLUB', 'Empty Group'],
    })
    expect(plan.changed[0].addGroups).toEqual(['BOOK CLUB'])
    expect(plan.changed[0].changes).toEqual([{ field: 'groups', before: 'Noa Family', after: 'Noa Family; BOOK CLUB' }])
    expect(plan.groupsToCreate).toEqual([])
  })

  it('a file without a group the guest is in takes no one out of it', () => {
    const plan = planImport([row('Ana Ruiz', { groups: [] })], [base])
    expect(plan.counts.changed).toBe(0)
  })

  it('new groups are created once, spelled as first written', () => {
    const plan = planImport(
      [row('Ana Ruiz', { groups: ['Work'] }), row('Bo Lee', { groups: ['WORK', 'Gym'] }), row('Cy Lee', { groups: ['gym'] })],
      [base],
    )
    expect(plan.groupsToCreate).toEqual(['Work', 'Gym'])
    expect(plan.newGuests.map((n) => n.groups)).toEqual([['Work', 'Gym'], ['Gym']])
  })

  it('extra notes are appended once, so a second import changes nothing', () => {
    const r = row('Ana Ruiz', { extraNotes: ['Table wish: Window'] })
    const plan = planImport([r], [base])
    expect(plan.changed[0].changes).toEqual([
      { field: 'notes', before: 'Likes jazz', after: 'Likes jazz\nTable wish: Window' },
    ])
    const after = applyPlan(plan, [base], { newId: String }).guests
    expect(planImport([r], after).counts).toMatchObject({ changed: 0, unchanged: 1 })
  })

  it('on a name match, notes lines are added only when missing', () => {
    expect(planImport([row('Ana Ruiz', { notes: 'Likes jazz' })], [base]).counts.changed).toBe(0)
    const plan = planImport([row('Ana Ruiz', { notes: 'Likes jazz\nVegan' })], [base])
    expect(plan.changed[0].patch).toEqual({ notes: 'Likes jazz\nVegan' })
  })

  it('on a guest_id match, the notes cell replaces the notes', () => {
    const plan = planImport([row('Ana Ruiz', { guestId: 'g1', notes: 'Likes blues' })], [base])
    expect(plan.changed[0].patch).toEqual({ notes: 'Likes blues' })
    // The same text with other line ends or spaces is no change.
    const same = { ...base, notes: 'Line one\r\nLine  two ' }
    expect(planImport([row('Ana Ruiz', { guestId: 'g1', notes: 'Line one\nLine two' })], [same]).counts.changed).toBe(0)
  })
})

// --- Partners ---------------------------------------------------------------------

describe('partner links', () => {
  it('links a new row to an existing guest and shows it as a change on a matched row', () => {
    const guests = [guest('g-tom', 'Tom Lee')]
    const anna = row('Anna Lee', { partnerName: 'Tom Lee' })
    const plan = planImport([anna], guests)
    expect(plan.partnerLinks).toEqual([
      { a: { rowNumber: anna.rowNumber, guestId: null }, b: { rowNumber: null, guestId: 'g-tom' }, aName: 'Anna Lee', bName: 'Tom Lee' },
    ])
    const applied = applyPlan(plan, guests, { newId: () => 'g-anna' }).guests
    expect(applied.find((g) => g.id === 'g-tom')!.partnerId).toBe('g-anna')
  })

  it('a matched guest whose partner changes lists it', () => {
    const guests = [guest('g-ana', 'Ana Ruiz', { partnerId: 'g-bo' }), guest('g-bo', 'Bo Lee', { partnerId: 'g-ana' }), guest('g-cy', 'Cy Kim')]
    const plan = planImport([row('Ana Ruiz', { partnerName: 'Cy Kim' })], guests)
    expect(plan.changed[0].changes).toEqual([{ field: 'partner', before: 'Bo Lee', after: 'Cy Kim' }])
    const applied = applyPlan(plan, guests, { newId: String }).guests
    const by = (id: string) => applied.find((g) => g.id === id)!
    expect([by('g-ana').partnerId, by('g-bo').partnerId, by('g-cy').partnerId]).toEqual(['g-cy', null, 'g-ana'])
  })

  it('a link that already exists is not repeated', () => {
    const guests = [guest('g-ana', 'Ana Ruiz', { partnerId: 'g-bo' }), guest('g-bo', 'Bo Lee', { partnerId: 'g-ana' })]
    const plan = planImport([row('Ana Ruiz', { partnerName: 'Bo Lee' }), row('Bo Lee', { partnerName: 'Ana Ruiz' })], guests)
    expect(plan.partnerLinks).toEqual([])
    expect(plan.counts).toMatchObject({ changed: 0, unchanged: 2 })
  })

  it('a blank partner cell keeps the link', () => {
    const guests = [guest('g-ana', 'Ana Ruiz', { partnerId: 'g-bo' }), guest('g-bo', 'Bo Lee', { partnerId: 'g-ana' })]
    expect(planImport([row('Ana Ruiz')], guests).partnerLinks).toEqual([])
  })

  it('passes partner problems through, and a pick settles them', () => {
    const anna = row('Anna Lee', { partnerName: 'Tommy Lee' })
    const tom = row('Tom Lee')
    const plan = planImport([anna, tom], [])
    expect(plan.partnerProblems).toMatchObject([{ rowNumber: anna.rowNumber, status: 'unmatched' }])
    expect(plan.partnerLinks).toEqual([])
    const fixed = planImport([anna, tom], [], { partnerPicks: { [anna.rowNumber]: { rowNumber: tom.rowNumber } } })
    expect(fixed.partnerProblems).toEqual([])
    expect(fixed.partnerLinks.map((l) => [l.aName, l.bName])).toEqual([['Anna Lee', 'Tom Lee']])
  })
})

// --- Duplicates -----------------------------------------------------------------------

describe('likely duplicates', () => {
  it('flags close spellings among new rows and against existing guests', () => {
    const guests = [guest('g1', 'Jonathan Smith'), guest('g2', 'Katherine Smyth')]
    const a = row('Jon Smith')
    const b = row('John Smith')
    const c = row('Katharine Smith')
    const d = row('Bill Ng')
    const e = row('William Ng')
    const plan = planImport([a, b, c, d, e], guests)
    expect(plan.duplicates.map((x) => [x.rowNumber, x.message])).toEqual([
      [a.rowNumber, 'Nickname: Jonathan Smith (already a guest)'],
      [b.rowNumber, `Close spelling: Jon Smith (row ${a.rowNumber})`],
      [c.rowNumber, 'Close spelling: Katherine Smyth (already a guest)'],
      [e.rowNumber, `Nickname: Bill Ng (row ${d.rowNumber})`],
    ])
  })

  it('does not flag two people about to be linked as partners', () => {
    const plan = planImport([row('Jon Smith', { partnerName: 'Joan Smith' }), row('Joan Smith', { partnerName: 'Jon Smith' })], [])
    expect(plan.partnerLinks).toHaveLength(1)
    expect(plan.duplicates).toEqual([])
  })

  it('does not flag rows that matched a guest', () => {
    const guests = [guest('g1', 'Jon Smith'), guest('g2', 'John Smith')]
    expect(planImport([row('Jon Smith'), row('John Smith')], guests).duplicates).toEqual([])
  })
})

// --- Our own export ------------------------------------------------------------------

describe('re-importing our own export', () => {
  const groups: ExportGroup[] = [
    { id: 'grp-1', name: 'Noa Family' },
    { id: 'grp-2', name: 'Book Club' },
    // A comma in a name the API allows: alone in a cell it must not split.
    { id: 'grp-3', name: 'Mom side, cousins' },
  ]
  const exported: ExportGuest[] = [
    {
      id: '11111111-1111-4111-8111-111111111111',
      firstName: 'Sam',
      lastName: 'Lee',
      nickname: 'Sammy',
      partnerId: '22222222-2222-4222-8222-222222222222',
      household: 'Lee',
      side: 'Aiden',
      rsvp: 'yes',
      meal: '=Fish',
      isChild: false,
      notes: '-likes jazz\nTable wish: "window", please',
      groupIds: ['grp-1', 'grp-2'],
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      firstName: 'Ana',
      lastName: 'Ruiz',
      nickname: null,
      partnerId: '11111111-1111-4111-8111-111111111111',
      household: 'Lee',
      side: 'Both',
      rsvp: 'pending',
      meal: null,
      isChild: false,
      notes: null,
      groupIds: [],
    },
    {
      // Shares a name with the first Sam Lee.
      id: '33333333-3333-4333-8333-333333333333',
      firstName: 'Sam',
      lastName: 'Lee',
      nickname: null,
      partnerId: null,
      household: null,
      side: 'Noa',
      rsvp: 'no',
      meal: null,
      isChild: true,
      notes: '@home',
      groupIds: ['grp-1'],
    },
    {
      id: '44444444-4444-4444-8444-444444444444',
      firstName: 'Zoë',
      lastName: "O'Brien-Łęcka",
      nickname: null,
      partnerId: null,
      household: null,
      side: 'Noa',
      rsvp: 'pending',
      meal: null,
      isChild: false,
      // A value that already starts with an apostrophe and a formula sign.
      notes: "'=already quoted",
      groupIds: ['grp-3'],
    },
    {
      // A linked couple whose names hold an honorific and a comma.
      id: '55555555-5555-4555-8555-555555555555',
      firstName: 'Dr. Jane',
      lastName: 'Smith',
      nickname: null,
      partnerId: '66666666-6666-4666-8666-666666666666',
      household: null,
      side: 'Both',
      rsvp: 'pending',
      meal: null,
      isChild: false,
      notes: null,
      groupIds: [],
    },
    {
      id: '66666666-6666-4666-8666-666666666666',
      firstName: 'Bob',
      lastName: 'Smith, Jr',
      nickname: null,
      partnerId: '55555555-5555-4555-8555-555555555555',
      household: null,
      side: 'Both',
      rsvp: 'pending',
      meal: null,
      isChild: false,
      notes: null,
      groupIds: [],
    },
    {
      // Stored decomposed (e and a combining mark), as text pasted from a macOS PDF can be.
      id: '77777777-7777-4777-8777-777777777777',
      firstName: 'Zoe\u0308',
      lastName: 'Nowak',
      nickname: null,
      partnerId: null,
      household: 'Nowak, Ze\u0301lie',
      side: 'Both',
      rsvp: 'pending',
      meal: null,
      isChild: false,
      notes: 'Cafe\u0301 owner',
      groupIds: [],
    },
  ]
  const existing: ExistingGuest[] = exported.map((g) => ({
    id: g.id,
    firstName: g.firstName,
    lastName: g.lastName,
    nickname: g.nickname,
    partnerId: g.partnerId,
    household: g.household,
    side: g.side,
    rsvp: g.rsvp,
    meal: g.meal,
    isChild: g.isChild,
    notes: g.notes,
    groups: groups.filter((x) => g.groupIds.includes(x.id)).map((x) => x.name),
  }))

  it('matches every row by guest_id and changes nothing', () => {
    const csv = guestsToCsv(exported, groups)
    const rows = rowsFromFile(new TextEncoder().encode(csv))
    expect(rows.map((r) => r.guestId)).toEqual(exported.map((g) => g.id))
    const plan = planImport(rows, existing, { existingGroupNames: groups.map((x) => x.name) })
    expect(plan.counts).toEqual({ new: 0, changed: 0, unchanged: 7, needsReview: 0, missing: 0 })
    expect(plan.unchanged.every((u) => u.matchedBy === 'id')).toBe(true)
    expect(plan.partnerLinks).toEqual([])
    expect(plan.partnerProblems).toEqual([])
    expect(plan.groupsToCreate).toEqual([])
    expect(plan.duplicates).toEqual([])
    // The cells that carry the edge cases.
    expect(rows[0]).toMatchObject({ nickname: 'Sammy', groups: ['Noa Family', 'Book Club'] })
    expect(rows[3]).toMatchObject({ notes: "'=already quoted", groups: ['Mom side, cousins'] })
    expect(rows[4]!.partnerName).toBe('Bob Smith, Jr')
    expect(rows[5]!.partnerName).toBe('Dr. Jane Smith')
  })

  it('matches the same file by name too, with no guest_id column', () => {
    const csv = guestsToCsv(exported, groups)
    const rows = rowsFromFile(new TextEncoder().encode(csv)).map((r) => ({ ...r, guestId: undefined }))
    const plan = planImport(rows, existing, { existingGroupNames: groups.map((x) => x.name) })
    // The two Sam Lees wait for a pick; everyone else, the couple with the
    // honorific and the comma included, matches with no change.
    expect(plan.counts).toEqual({ new: 0, changed: 0, unchanged: 5, needsReview: 2, missing: 0 })
    expect(plan.partnerProblems.filter((m) => m.partnerName !== 'Ana Ruiz')).toEqual([])
  })

  it('an edit in the spreadsheet comes back as a change to that guest only', () => {
    const csv = guestsToCsv(exported, groups).replace('Zoë,', 'Zoe,')
    const plan = planImport(rowsFromFile(csv), existing, { existingGroupNames: groups.map((x) => x.name) })
    expect(plan.changed).toMatchObject([
      { guestId: exported[3].id, changes: [{ field: 'firstName', before: 'Zoë', after: 'Zoe' }] },
    ])
    expect(plan.counts.unchanged).toBe(6)
  })
})
