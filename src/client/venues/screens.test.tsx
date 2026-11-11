import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { VenueDetail, VenueSummary } from '@/shared/api'
import { TemplateEditorScreen } from './editor/TemplateEditorScreen'
import { NewVenueButton, VenueList, venueHref } from './VenueList'

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
    ...over,
  }
}

describe('Venues tab', () => {
  it('lists each venue with its use, Open, Duplicate and Delete', () => {
    const html = renderToStaticMarkup(<VenueList weddingId={WEDDING} venues={[summary(), summary({ id: 'v2', name: 'Loft', usedBy: 0, fixedItemCount: 12 })]} />)
    expect(html).toContain('Toronto Beach Club')
    expect(html).toContain('Used by 2 layouts · Empty')
    expect(html).toContain('Not used yet · 12 items')
    expect(html).toContain(`href="${venueHref(VENUE, WEDDING)}"`)
    expect(html).toContain('aria-label="Duplicate Loft"')
    expect(html).toContain('aria-label="Delete Loft"')
    expect(venueHref(VENUE, WEDDING)).toBe(`/venues/${VENUE}?from=${WEDDING}`)
  })

  it('says how to start when there are no venues', () => {
    expect(renderToStaticMarkup(<VenueList weddingId={WEDDING} venues={[]} />)).toContain('No venues yet.')
    expect(renderToStaticMarkup(<NewVenueButton weddingId={WEDDING} />)).toContain('New venue')
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
}

describe('TemplateEditorScreen', () => {
  it('renders the template editor: back link, name, save status, tools, canvas and tabs', () => {
    const html = renderToStaticMarkup(<TemplateEditorScreen venue={venue} backHref={`/w/${WEDDING}/venues`} />)
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
})
