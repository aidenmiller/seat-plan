import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { WeddingAccessProvider, type WeddingAccessValue } from '@/client/wedding-access'
import type { WeddingSummary } from '@/shared/api'
import { WeddingSettingsDialog } from './WeddingSettingsDialog'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
// The real dialog opens in a portal on document.body; here it just shows its content.
vi.mock('@/client/ui/Dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) => (open ? <div role="dialog">{children}</div> : null),
  DialogActions: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
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

function render(access: WeddingAccessValue, open = true): string {
  return renderToStaticMarkup(
    <WeddingAccessProvider access={access}>
      <WeddingSettingsDialog wedding={wedding} open={open} onClose={() => {}} />
    </WeddingAccessProvider>,
  )
}

describe('WeddingSettingsDialog', () => {
  it('gives an owner the settings form and the backup', () => {
    const markup = render({ role: 'owner', viaAdmin: false })
    expect(markup).toContain('Minimum gap between tables')
    expect(markup).toContain('data-testid="backup-download"')
    expect(markup).not.toContain('settings-owners-only')
  })

  it('gives an admin in admin view the same', () => {
    expect(render({ role: 'owner', viaAdmin: true })).toContain('data-testid="backup-download"')
  })

  it('gives an editor a short note and no form or backup', () => {
    const markup = render({ role: 'editor', viaAdmin: false })
    expect(markup).toContain('Only owners can change the wedding settings or download a backup.')
    expect(markup).not.toContain('Minimum gap between tables')
    expect(markup).not.toContain('backup-download')
    expect(markup).not.toContain('Save')
  })

  it('renders nothing while closed', () => {
    expect(render({ role: 'editor', viaAdmin: false }, false)).toBe('')
  })
})
