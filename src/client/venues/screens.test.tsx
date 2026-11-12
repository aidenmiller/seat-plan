import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { VenueDetail, VenueSummary } from '@/shared/api'
import { CurrentUserProvider } from '../current-user'
import { TemplateEditorScreen } from './editor/TemplateEditorScreen'
import { NewLayoutForm } from '@/app/(app)/w/[weddingId]/(tabs)/layouts/NewLayoutButton'
import { NewVenueButton, VenueList, venueHref } from './VenueList'
import { VenueOptions } from './VenuePicker'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/venues/v1',
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const ME = { id: '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a', displayName: 'Noa', email: 'noa@example.com', isAdmin: false }
const ADMIN = { ...ME, displayName: 'Avery', isAdmin: true }

function listHtml(venues: VenueSummary[], user = ME) {
  return renderToStaticMarkup(
    <CurrentUserProvider user={user}>
      <VenueList weddingId={WEDDING} venues={venues} />
    </CurrentUserProvider>,
  )
}

/** The markup of the card of one venue. */
function cardOf(html: string, id: string): string {
  const start = html.indexOf(`data-venue-id="${id}"`)
  expect(start).toBeGreaterThan(-1)
  const end = html.indexOf('</article>', start)
  return html.slice(start, end)
}

const WEDDING = '44444444-4444-4444-8444-444444444444'
const VENUE = '55555555-5555-4555-8555-555555555555'

function summary(over: Partial<VenueSummary> = {}): VenueSummary {
  return {
    id: VENUE,
    name: 'Toronto Beach Club',
    updatedAt: '2026-11-09T15:42:00.000Z',
    usedBy: 2,
    version: 3,
    editedBy: 'Noa',
    editedById: null,
    importedBy: 'hand',
    fixedItemCount: 0,
    hasReferenceImage: false,
    access: 'library',
    ownerName: null,
    canEdit: false,
    ...over,
  }
}

describe('Venues tab', () => {
  const mine = summary({ id: 'v-mine', name: 'Loft', usedBy: 0, fixedItemCount: 12, access: 'mine', ownerName: 'Noa', canEdit: true })
  const shared = summary({ id: 'v-shared', name: 'Barn', access: 'shared', ownerName: 'Dayna', canEdit: false })

  it('lists each venue with its use and the links', () => {
    const html = listHtml([summary(), mine])
    expect(html).toContain('Toronto Beach Club')
    expect(html).toContain('Used by 2 layouts · Empty')
    expect(html).toContain('Not used yet · 12 items')
    expect(html).toContain(`href="${venueHref(VENUE, WEDDING)}"`)
    expect(venueHref(VENUE, WEDDING)).toBe(`/venues/${VENUE}?from=${WEDDING}`)
  })

  it('groups the venues: Library, Your venues, Used in this wedding', () => {
    const html = listHtml([shared, mine, summary()])
    const order = ['>Library</h2>', '>Your venues</h2>', '>Used in this wedding</h2>'].map((h) => html.indexOf(h))
    expect(order.every((i) => i > -1)).toBe(true)
    expect(order).toEqual([...order].sort((x, y) => x - y))
    // A group with nothing in it is left out.
    expect(listHtml([summary()])).not.toContain('Your venues')
  })

  it('a library venue: Library badge, Open and Make my own copy, no Rename, Duplicate or Delete', () => {
    const card = cardOf(listHtml([summary()]), VENUE)
    expect(card).toContain('>Library</span>')
    expect(card).toContain('aria-label="Open Toronto Beach Club (view only)"')
    expect(card).toContain('aria-label="Make my own copy of Toronto Beach Club"')
    expect(card).not.toContain('Click to rename')
    expect(card).not.toContain('aria-label="Delete')
    expect(card).not.toContain('aria-label="Duplicate')
  })

  it('your own venue: Yours badge, rename, Duplicate and Delete, no copy button', () => {
    const card = cardOf(listHtml([mine]), 'v-mine')
    expect(card).toContain('>Yours</span>')
    expect(card).toContain('Click to rename')
    expect(card).toContain('aria-label="Duplicate Loft"')
    expect(card).toContain('aria-label="Delete Loft"')
    expect(card).not.toContain('Make my own copy')
  })

  it("someone else's venue names the owner and can only be viewed or copied", () => {
    const card = cardOf(listHtml([shared]), 'v-shared')
    expect(card).toContain('>Shared by Dayna</span>')
    expect(card).toContain('Make my own copy')
    expect(card).not.toContain('aria-label="Delete')
  })

  it('a venue with no owner is labelled for the admin, who can change it', () => {
    const old = summary({ id: 'v-old', name: 'Old hall', access: 'unowned', ownerName: null, canEdit: true })
    const card = cardOf(listHtml([old], ADMIN), 'v-old')
    expect(card).toContain('>No owner</span>')
    expect(card).toContain('aria-label="Delete Old hall"')
    expect(cardOf(listHtml([{ ...old, canEdit: false }]), 'v-old')).not.toContain('No owner')
  })

  it('shows no Add to library action (there is no route for it)', () => {
    expect(listHtml([summary({ canEdit: true })], ADMIN)).not.toContain('Add to library')
  })

  it('says how to start when there are no venues', () => {
    expect(listHtml([])).toContain('No venues yet.')
    expect(renderToStaticMarkup(<NewVenueButton weddingId={WEDDING} />)).toContain('New venue')
  })
})

describe('venue pickers', () => {
  const venues = [
    summary({ id: 'v-shared', name: 'Barn', access: 'shared', ownerName: 'Dayna' }),
    summary({ id: 'v-mine', name: 'Loft', access: 'mine', ownerName: 'Noa', canEdit: true }),
    summary(),
  ]

  it('the select groups its options and keeps Blank canvas last', () => {
    const html = renderToStaticMarkup(<VenueOptions venues={venues} />)
    const at = ['<optgroup label="Library">', '<optgroup label="Your venues">', '<optgroup label="Used in this wedding">'].map((h) => html.indexOf(h))
    expect(at.every((i) => i > -1)).toBe(true)
    expect(at).toEqual([...at].sort((x, y) => x - y))
    expect(html.lastIndexOf('Blank canvas')).toBeGreaterThan(html.indexOf('Barn'))
  })

  it('the new layout form groups its venue choices and keeps Blank canvas', () => {
    const html = renderToStaticMarkup(<NewLayoutForm weddingId={WEDDING} venues={venues} onCancel={() => undefined} />)
    expect(html).toContain('Blank canvas')
    const at = ['>Library</legend>', '>Your venues</legend>', '>Used in this wedding</legend>'].map((h) => html.indexOf(h))
    expect(at.every((i) => i > -1)).toBe(true)
    expect(at).toEqual([...at].sort((x, y) => x - y))
  })
})

const venue: VenueDetail = {
  id: VENUE,
  name: 'Toronto Beach Club',
  version: 1,
  lastSaveId: null,
  editedBy: null,
  editedById: null,
  updatedAt: '2026-11-09T15:42:00.000Z',
  importedBy: 'hand',
  fixedItems: [
    {
      id: 'w1',
      type: 'wall',
      points: [
        { x: 0, y: 0 },
        { x: 500, y: 0 },
      ],
      thickness: 15,
      unsure: true,
      unsureNote: 'Faint line',
    },
  ],
  reference: null,
  referenceImage: null,
  usedBy: 0,
  access: 'mine',
  ownerName: 'Noa',
  canEdit: true,
}

describe('TemplateEditorScreen', () => {
  it('renders the template editor: back link, name, save status, tools, canvas and tabs', () => {
    const html = renderToStaticMarkup(
      <CurrentUserProvider user={{ id: '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a', displayName: 'Noa', email: 'noa@example.com', isAdmin: false }}>
        <TemplateEditorScreen venue={venue} backHref={`/w/${WEDDING}/venues`} />
      </CurrentUserProvider>,
    )
    expect(html).toContain('data-testid="user-menu"')
    expect(html).toContain(`href="/w/${WEDDING}/venues"`)
    expect(html).toContain('Toronto Beach Club')
    expect(html).toContain('data-testid="save-status"')
    expect(html).toContain('Opening…')
    expect(html).toContain('data-testid="template-canvas"')
    expect(html).toContain('data-fixed-type="wall"')
    expect(html).toContain('data-unsure="true"')
    expect(html).toContain('data-testid="template-tabs"')
    expect(html).toContain('Revisions')
    expect(html).toContain('data-testid="unit-switch"')
    expect(html).toContain('data-testid="zoom-controls"')
  })

  const readOnlyHtml = (over: Partial<VenueDetail>) =>
    renderToStaticMarkup(
      <CurrentUserProvider user={ME}>
        <TemplateEditorScreen venue={{ ...venue, ...over }} backHref={`/w/${WEDDING}/venues`} />
      </CurrentUserProvider>,
    )

  it('a library venue opens read-only: banner, copy button, no tools, rename, import or revisions', () => {
    const html = readOnlyHtml({ access: 'library', ownerName: null, canEdit: false })
    expect(html).toContain('data-testid="template-read-only"')
    expect(html).toContain('This is a library venue. Only the admin can change it.')
    expect(html).toContain('data-testid="make-copy"')
    expect(html).toContain('Make my own copy')
    expect(html).toContain('View only')
    expect(html).toContain('data-status="read-only"')
    expect(html).not.toContain('aria-label="Tools"')
    expect(html).not.toContain('data-testid="mode-switch"')
    expect(html).not.toContain('data-testid="import-plan')
    expect(html).not.toContain('Click to rename')
    expect(html).not.toContain('>Revisions<')
    // Pan, zoom and inspection stay.
    expect(html).toContain('data-testid="template-canvas"')
    expect(html).toContain('data-testid="zoom-controls"')
  })

  it("someone else's venue names the owner", () => {
    const html = readOnlyHtml({ access: 'shared', ownerName: 'Dayna', canEdit: false })
    expect(html).toContain('This venue belongs to Dayna. You can view it.')
  })

  it('a venue you can change has no banner and keeps its controls', () => {
    const html = readOnlyHtml({})
    expect(html).not.toContain('template-read-only')
    expect(html).toContain('Click to rename')
    expect(html).toContain('data-testid="import-plan"')
    expect(html).toContain('>Revisions<')
  })
})
