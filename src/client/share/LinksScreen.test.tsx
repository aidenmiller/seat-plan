import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ShareLink } from '@/shared/api'
import { WeddingAccessProvider, type WeddingAccessValue } from '../wedding-access'
import { LinksScreen } from './LinksScreen'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const WEDDING = '44444444-4444-4444-8444-444444444444'

const link: ShareLink = {
  id: '66666666-6666-4666-8666-666666666666',
  weddingId: WEDDING,
  layoutId: '33333333-3333-4333-8333-333333333333',
  layoutName: 'Reception',
  label: 'Venue',
  path: '/share/abc',
  enabled: true,
  showNames: true,
  showNotes: false,
  lastOpenedAt: null,
  createdAt: '2026-11-09T15:42:00.000Z',
}

function render(access: WeddingAccessValue, initial: ShareLink[]): string {
  return renderToStaticMarkup(
    <WeddingAccessProvider access={access}>
      <LinksScreen weddingId={WEDDING} initial={initial} />
    </WeddingAccessProvider>,
  )
}

describe('LinksScreen', () => {
  it('gives an owner the controls', () => {
    const markup = render({ role: 'owner', viaAdmin: false }, [link])
    expect(markup).toContain('Change password')
    expect(markup).toContain('Turn off')
    expect(markup).not.toContain('links-owners-only')
    expect(markup).not.toContain('disabled=""')
  })

  it('shows an editor the links, read only, with one line saying why', () => {
    const markup = render({ role: 'editor', viaAdmin: false }, [link])
    expect(markup).toContain('Venue')
    expect(markup).toContain('Reception')
    expect(markup).toContain('Copy link')
    expect(markup).toContain('Only owners can make or change share links.')
    expect(markup).not.toContain('Change password')
    expect(markup).not.toContain('Turn off')
    expect(markup.match(/role="switch"[^>]*disabled=""/g)).toHaveLength(2)
  })

  it('tells an owner how to make the first link, and an editor only that there are none', () => {
    expect(render({ role: 'owner', viaAdmin: false }, [])).toContain('press Share to make one')
    const editor = render({ role: 'editor', viaAdmin: false }, [])
    expect(editor).toContain('No share links yet.')
    expect(editor).not.toContain('press Share')
    expect(editor).toContain('Only owners can make or change share links.')
  })
})
