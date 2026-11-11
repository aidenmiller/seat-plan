import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { LayoutSummary } from '@/shared/api'
import { LayoutList } from './LayoutList'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

function summary(over: Partial<LayoutSummary>): LayoutSummary {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    weddingId: '44444444-4444-4444-8444-444444444444',
    name: 'Reception plan',
    kind: 'reception',
    venueTemplateId: '55555555-5555-4555-8555-555555555555',
    venueName: 'Toronto Beach Club',
    venueDeleted: false,
    version: 3,
    editedBy: 'Noa',
    editedById: null,
    updatedAt: '2026-11-09T15:42:00.000Z',
    thumbSvg: '<svg/>',
    ...over,
  }
}

function venueLine(markup: string): string {
  const m = /<p[^>]*data-testid="layout-venue"[^>]*>(.*?)<\/p>/.exec(markup)
  return (m?.[1] ?? '').replace(/<[^>]+>/g, '').replace(/<!-- -->/g, '')
}

describe('LayoutList', () => {
  it('says Venue deleted next to the old venue name when its template was deleted', () => {
    const markup = renderToStaticMarkup(<LayoutList weddingId="w" layouts={[summary({ venueDeleted: true })]} />)
    expect(venueLine(markup)).toBe('Reception · Toronto Beach Club Venue deleted')
  })

  it('shows the venue alone while its template exists, and Blank canvas without one', () => {
    const live = renderToStaticMarkup(<LayoutList weddingId="w" layouts={[summary({})]} />)
    expect(venueLine(live)).toBe('Reception · Toronto Beach Club')
    const blank = renderToStaticMarkup(
      <LayoutList weddingId="w" layouts={[summary({ venueTemplateId: null, venueName: null })]} />,
    )
    expect(venueLine(blank)).toBe('Reception · Blank canvas')
  })
})
