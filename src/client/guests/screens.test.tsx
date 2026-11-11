import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { GroupsScreen } from '@/client/groups/GroupsScreen'
import { applyMapping, guessMapping } from '@/domain/csv/columns'
import { planImport, type ExistingGuest } from '@/domain/csv/import-diff'
import { parseCsv } from '@/domain/csv/parse'
import { SAMPLE_CSV_TEXT } from '@/domain/csv/sample'
import type { Group, Guest, GuestSeatPlace } from '@/shared/api'
import { GuestCards } from './GuestCards'
import { GuestsScreen } from './GuestsScreen'
import { ColumnStep } from './import/ColumnStep'
import { ImportWizard } from './import/ImportWizard'
import { ReviewStep } from './import/ReviewStep'
import { PartnerNamesProvider } from './partners-context'
import { rowsFromText } from './PasteNamesDialog'
import type { GuestRowActions } from './row-actions'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/w/w1/guests',
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const W = '44444444-4444-4444-8444-444444444444'
let n = 0
function guest(first: string, last: string, over: Partial<Guest> = {}): Guest {
  n += 1
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    weddingId: W,
    firstName: first,
    lastName: last,
    nickname: null,
    partnerId: null,
    coupleRuleEnabled: true,
    household: null,
    side: 'both',
    rsvp: 'pending',
    meal: null,
    isChild: false,
    notes: null,
    groupIds: [],
    createdAt: '2026-11-09T12:00:00.000Z',
    updatedAt: '2026-11-09T12:00:00.000Z',
    ...over,
  }
}

const family: Group = {
  id: '55555555-5555-4555-8555-555555555555',
  weddingId: W,
  name: 'Noa Family',
  color: '#C2410C',
  memberIds: [],
  createdAt: '2026-11-09T12:00:00.000Z',
  updatedAt: '2026-11-09T12:00:00.000Z',
}

const zoe = guest('Zoë', 'Kowalczyk', { side: 'partner1', rsvp: 'yes', meal: 'Fish', groupIds: [family.id], nickname: 'Zozo' })
const lukasz = guest('Łukasz', 'Kowalczyk', { side: 'partner1', rsvp: 'yes', meal: 'Beef', groupIds: [family.id] })
zoe.partnerId = lukasz.id
lukasz.partnerId = zoe.id
const jose = guest('José', 'García', { notes: 'Arrives late' })
family.memberIds = [zoe.id, lukasz.id]
const seats: GuestSeatPlace[] = [{ guestId: zoe.id, layoutId: 'l1', layoutName: 'Reception plan', itemLabel: 'Table 3' }]

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/<!-- -->/g, '').replace(/\s+/g, ' ')

describe('the Guests page', () => {
  const html = renderToStaticMarkup(<GuestsScreen weddingId={W} guests={[zoe, lukasz, jose]} groups={[family]} seats={seats} />)

  it('shows a row per guest, sorted by last name, with every column', () => {
    const ids = [...html.matchAll(/data-testid="guest-row" data-guest-id="([^"]+)"/g)].map((m) => m[1])
    expect(ids).toEqual([jose.id, lukasz.id, zoe.id])
    for (const key of ['firstName', 'lastName', 'nickname', 'partner', 'household', 'side', 'rsvp', 'meal', 'isChild', 'groups', 'notes', 'seats']) {
      expect(html).toContain(`data-testid="sort-${key}"`)
    }
    expect(html).toContain('aria-sort="ascending"')
  })

  it('shows partners, groups, where guests sit, and notes', () => {
    const t = text(html)
    expect(t).toContain('Partner of Zoë Kowalczyk: Łukasz Kowalczyk')
    expect(t).toContain('Groups of Zoë Kowalczyk: Noa Family')
    expect(t).toContain('Reception plan · Table 3')
    expect(t).toContain('Not seated')
    expect(t).toContain('Arrives late')
  })

  it('has the add row, search, filters, export and sample links, and paste and import', () => {
    for (const id of ['add-guest-form', 'guest-search', 'filter-group', 'filter-side', 'filter-rsvp', 'filter-child', 'filter-meal', 'open-paste-names']) {
      expect(html).toContain(`data-testid="${id}"`)
    }
    // Export is a button: it sends waiting edits before the download starts.
    expect(html).toMatch(/<button type="button"[^>]*data-testid="export-csv"[^>]*>Export CSV</)
    expect(html).toContain('href="/samples/guests-sample.csv"')
    expect(html).toContain(`href="/w/${W}/guests/import"`)
    expect(html).toMatch(/data-testid="guest-count"[^>]*>3 guests</)
  })

  it('says so when there are no guests', () => {
    const empty = renderToStaticMarkup(<GuestsScreen weddingId={W} guests={[]} groups={[]} seats={[]} />)
    expect(empty).toContain('data-testid="guests-empty"')
  })

  it("labels sides with the wedding's partner names, in the cells and the side filter", () => {
    const named = renderToStaticMarkup(
      <PartnerNamesProvider partner1="Sam" partner2="Alex">
        <GuestsScreen weddingId={W} guests={[zoe, lukasz, jose]} groups={[family]} seats={seats} />
      </PartnerNamesProvider>,
    )
    // The option a select shows carries selected="".
    const option = (value: string, label: string) => `<option value="${value}"(?: selected="")?>${label}</option>`
    const choices = option('partner1', 'Sam') + option('partner2', 'Alex') + option('both', 'Both')
    expect(named).toMatch(new RegExp(`data-testid="filter-side"[^>]*>${option('__any__', 'Any side')}${choices}`))
    expect(named).toMatch(new RegExp(`data-testid="cell-side"[^>]*>${choices}`))
    expect(named).not.toContain('Noa</option>')
  })

  it('reads Partner 1 and Partner 2 without names', () => {
    expect(html).toMatch(/data-testid="filter-side"[^>]*><option value="__any__" selected="">Any side<\/option><option value="partner1">Partner 1<\/option><option value="partner2">Partner 2<\/option>/)
  })

  it("shows a guest's side by name on the phone cards", () => {
    const actions = new Proxy({}, { get: () => () => undefined }) as GuestRowActions
    const cards = renderToStaticMarkup(
      <PartnerNamesProvider partner1="Sam" partner2="Alex">
        <GuestCards guests={[zoe, jose]} selected={new Set()} guestById={new Map()} groupById={new Map()} seatText={new Map()} actions={actions} />
      </PartnerNamesProvider>,
    )
    expect(text(cards)).toContain('Side: Sam')
    expect(text(cards)).toContain('Side: Both')
  })
})

describe('the Groups page', () => {
  it('lists each group with its color and member count', () => {
    const html = renderToStaticMarkup(<GroupsScreen weddingId={W} guests={[zoe, lukasz, jose]} groups={[family]} />)
    expect(html).toContain(`data-group-id="${family.id}"`)
    expect(html).toContain('background-color:#C2410C')
    expect(html).toMatch(/data-testid="group-count"[^>]*>2 guests</)
    expect(text(html)).toContain('Group name: Noa Family')
    expect(html).toContain('data-testid="new-group-form"')
  })

  it('says so when there are no groups', () => {
    const html = renderToStaticMarkup(<GroupsScreen weddingId={W} guests={[]} groups={[]} />)
    expect(html).toContain('data-testid="groups-empty"')
  })
})

describe('the CSV import', () => {
  const parsed = parseCsv(SAMPLE_CSV_TEXT)
  const file = { fileName: 'guests-sample.csv', encoding: 'utf-8' as const, bytes: new ArrayBuffer(0), ...parsed }
  const mapping = guessMapping(parsed.headers)
  const mapped = applyMapping(parsed.rows, mapping, { partner1: 'Noa', partner2: 'Aiden' }, parsed.rowNumbers)

  it('starts by asking for a file, with the sample to download', () => {
    const html = renderToStaticMarkup(<ImportWizard weddingId={W} guests={[]} />)
    expect(html).toContain('data-testid="import-file"')
    expect(html).toContain('href="/samples/guests-sample.csv"')
  })

  it('shows each column with its guessed field and the first 10 rows', () => {
    const html = renderToStaticMarkup(<ColumnStep file={file} mapping={mapping} onMapping={() => undefined} onBack={() => undefined} onNext={() => undefined} />)
    expect([...html.matchAll(/data-testid="import-column"/g)]).toHaveLength(11)
    expect(html).toMatch(/data-column="Table wish"[\s\S]*?<option value="add_to_notes" selected="">Add to notes</)
    expect(html).toContain('<option value="ignore">Ignore</option>')
    const preview = html.slice(html.indexOf('data-testid="import-preview"'))
    expect([...preview.matchAll(/<tr class="border-t/g)]).toHaveLength(10)
    expect(text(preview)).toContain('Table wish: Near the dance floor')
    expect(html).not.toContain('data-testid="mapping-problems"')
  })

  it('says when a file is not UTF-8 and offers the other older encoding (review finding)', () => {
    expect(renderToStaticMarkup(<ColumnStep file={file} mapping={mapping} onMapping={() => undefined} onBack={() => undefined} onNext={() => undefined} />)).not.toContain(
      'data-testid="import-encoding"',
    )
    const mac = { ...file, encoding: 'mac-roman' as const }
    const html = renderToStaticMarkup(<ColumnStep file={mac} mapping={mapping} onMapping={() => undefined} onBack={() => undefined} onNext={() => undefined} />)
    expect(html).toContain('data-testid="import-encoding"')
    expect(html).toMatch(/<option value="mac-roman" selected="">Mac/)
    expect(html).toContain('<option value="windows-1252">Windows (Excel for Windows)</option>')
  })

  it('blocks the next step until first and last name have columns', () => {
    const html = renderToStaticMarkup(
      <ColumnStep file={file} mapping={{ ...mapping, first_name: 'ignore' }} onMapping={() => undefined} onBack={() => undefined} onNext={() => undefined} />,
    )
    expect(html).toContain('Pick the column for First name.')
    expect(html).toMatch(/disabled=""[^>]*data-testid="import-check"/)
  })

  it('summarises a re-import: changed fields, needs review, missing guests and the seats removing them clears', () => {
    const existing: ExistingGuest[] = [
      { id: zoe.id, firstName: 'Zoë', lastName: 'Kowalczyk', partnerId: null, household: 'Kowalczyk', side: 'partner2', rsvp: 'yes', meal: 'Beef', isChild: false, notes: null, groups: [] },
      { id: 'b1', firstName: 'Sam', lastName: 'Lee', partnerId: null, household: null, side: 'both', rsvp: 'pending', meal: null, isChild: false, notes: null, groups: [] },
      { id: 'b2', firstName: 'Sam', lastName: 'Lee', partnerId: null, household: null, side: 'both', rsvp: 'pending', meal: null, isChild: false, notes: null, groups: [] },
      { id: 'gone', firstName: 'Old', lastName: 'Friend', partnerId: null, household: null, side: 'both', rsvp: 'pending', meal: null, isChild: false, notes: null, groups: [] },
    ]
    const plan = planImport(mapped.rows, existing)
    const missingSeats: GuestSeatPlace[] = [{ guestId: 'gone', layoutId: 'l1', layoutName: 'Reception plan', itemLabel: 'Table 4' }]
    const html = renderToStaticMarkup(
      <PartnerNamesProvider partner1="Noa" partner2="Aiden">
      <ReviewStep
        preview={{ plan, missingSeats }}
        rows={mapped.rows}
        skipped={[{ rowNumber: 12, field: 'last_name', message: 'Needs a last name' }]}
        warnings={[]}
        guests={[]}
        reviewPicks={new Map()}
        onReviewPick={() => undefined}
        partnerPicks={new Map()}
        onPartnerPick={() => undefined}
        removeMissing={false}
        onRemoveMissing={() => undefined}
        refreshing={false}
        busy={false}
        error={null}
        onBack={() => undefined}
        onImport={() => undefined}
      />
      </PartnerNamesProvider>,
    )
    const t = text(html)
    expect(html).toMatch(/data-testid="count-changed"[^>]*>1</)
    expect(html).toMatch(/data-testid="count-review"[^>]*>1</)
    expect(t).toContain('Meal: Beef to Fish')
    // Sides travel as codes and read as the wedding's names.
    expect(t).toContain('Side: Aiden to Noa')
    expect(t).toContain('Row 12: Needs a last name')
    expect(t).toContain('2 guests have this name')
    expect(html).toContain('<option value="new">Add as a new guest</option>')
    expect(t).toContain('Old Friend')
    expect(t).toContain('Reception plan: Table 4 (Old Friend)')
    expect(html).toContain('data-testid="import-remove-missing"')
    expect(html).toContain('data-testid="import-groups"')
    // Import waits for the pick.
    expect(html).toMatch(/disabled=""[^>]*data-testid="import-commit"/)
  })
})

describe('paste names', () => {
  it('turns 10 pasted names into 10 rows to check (acceptance check 25)', () => {
    const names = [
      'Anna van der Berg',
      'Smith, John',
      'José García',
      'Mrs. Priya Raman',
      'Daniel O’Connor',
      'Zoë Kowalczyk',
      'Łukasz Kowalczyk',
      'Mia Kowalczyk',
      'Sam Lee',
      'Theo Lee',
    ]
    let id = 0
    const rows = rowsFromText(`${names.join('\n')}\n\n`, () => `id-${++id}`)
    expect(rows).toHaveLength(10)
    expect(rows[0]).toMatchObject({ id: 'id-1', firstName: 'Anna', lastName: 'van der Berg' })
    expect(rows[1]).toMatchObject({ firstName: 'John', lastName: 'Smith' })
    expect(rows[3]).toMatchObject({ firstName: 'Priya', lastName: 'Raman' })
  })
})
