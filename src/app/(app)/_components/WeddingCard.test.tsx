import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { WeddingSummary } from '@/shared/api'
import { WeddingCard } from './WeddingCard'

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

const wedding: WeddingSummary = {
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
}

describe('WeddingCard', () => {
  it('gives an owner rename and Delete, and says Owner', () => {
    const markup = renderToStaticMarkup(<WeddingCard wedding={wedding} role="owner" canManage />)
    expect(markup).toContain('title="Click to rename"')
    expect(markup).toContain('aria-label="Delete Noa and Aiden"')
    expect(markup).toContain('Owner')
  })

  it('lets an editor open the wedding and nothing more, and says Editor', () => {
    const markup = renderToStaticMarkup(<WeddingCard wedding={wedding} role="editor" canManage={false} />)
    expect(markup).toContain('aria-label="Open Noa and Aiden"')
    expect(markup).toContain('Noa and Aiden')
    expect(markup).toContain('Editor')
    expect(markup).not.toContain('Delete')
    expect(markup).not.toContain('title="Click to rename"')
  })
})
