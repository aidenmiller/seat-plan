import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { WeddingAccessProvider } from '@/client/wedding-access'
import type { WeddingSummary } from '@/shared/api'
import { newestWedding, WeddingHeader } from './WeddingHeader'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

function wedding(over: Partial<WeddingSummary> = {}): WeddingSummary {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    name: 'Noa and Aiden',
    date: null,
    unit: 'ft',
    minGapCm: 152.4,
    partner1Name: 'Noa',
    partner2Name: 'Aiden',
    guestCount: 0,
    layoutCount: 0,
    updatedAt: '2026-11-09T15:42:00.000Z',
    ...over,
  }
}

describe('newestWedding', () => {
  it("uses the page's copy until a save here returns one", () => {
    const page = wedding()
    expect(newestWedding(page, null)).toBe(page)
  })

  it('uses the saved copy while router.refresh() has not brought the new props yet', () => {
    const page = wedding()
    const saved = wedding({ unit: 'm', updatedAt: '2026-11-09T15:43:00.000Z' })
    expect(newestWedding(page, saved)).toBe(saved)
  })

  it("goes back to the page's copy once it is as new or newer", () => {
    const saved = wedding({ unit: 'm', updatedAt: '2026-11-09T15:43:00.000Z' })
    const refreshed = wedding({ unit: 'm', updatedAt: '2026-11-09T15:43:00.000Z' })
    expect(newestWedding(refreshed, saved)).toBe(refreshed)
    const later = wedding({ unit: 'ft', updatedAt: '2026-11-09T15:44:00.000Z' })
    expect(newestWedding(later, saved)).toBe(later)
  })

  it('uses the saved copy for new partner names too', () => {
    const page = wedding()
    const saved = wedding({ partner1Name: 'Noah', partner2Name: null, updatedAt: '2026-11-09T15:43:00.000Z' })
    expect(newestWedding(page, saved)).toMatchObject({ partner1Name: 'Noah', partner2Name: null })
  })

  it('ignores a saved copy of another wedding', () => {
    const page = wedding()
    const other = wedding({ id: '55555555-5555-4555-8555-555555555555', updatedAt: '2026-11-09T16:00:00.000Z' })
    expect(newestWedding(page, other)).toBe(page)
  })
})

function render(role: 'owner' | 'editor', over: Partial<WeddingSummary> = {}): string {
  return renderToStaticMarkup(
    <WeddingAccessProvider access={{ role, viaAdmin: false }}>
      <WeddingHeader wedding={wedding(over)} />
    </WeddingAccessProvider>,
  )
}

describe('WeddingHeader', () => {
  it('shows the name and the date', () => {
    const markup = render('owner', { date: '2027-06-12' })
    expect(markup).toContain('Noa and Aiden')
    expect(markup).toContain('Saturday, June 12, 2027')
  })

  it('gives an owner Settings and a name to rename', () => {
    const markup = render('owner')
    expect(markup).toContain('Settings')
    expect(markup).toContain('title="Click to rename"')
  })

  it('shows an editor the name and date only: no Settings, no rename', () => {
    const markup = render('editor', { date: '2027-06-12' })
    expect(markup).toContain('Noa and Aiden')
    expect(markup).toContain('Saturday, June 12, 2027')
    expect(markup).not.toContain('Settings')
    expect(markup).not.toContain('title="Click to rename"')
  })
})
