import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { conflictChoiceMessage } from '@/domain/wording'
import { ConflictDialog, conflictSource } from './ConflictDialog'
import type { ConflictInfo } from './layout-session'

// The real dialog renders into a portal, which needs a browser.
vi.mock('@/client/ui/Dialog', () => ({
  Dialog: (p: { open: boolean; title: string; description?: ReactNode; children?: ReactNode; dismissable?: boolean }) =>
    p.open ? (
      <section data-dismissable={String(p.dismissable ?? true)}>
        <h2>{p.title}</h2>
        {p.description}
        {p.children}
      </section>
    ) : null,
  DialogActions: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

const NOA_ID = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a'
const AIDEN_ID = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b'
const server = { version: 4, editedBy: 'Aiden', editedById: AIDEN_ID, updatedAt: '2026-11-09T15:42:00.000Z' }

function render(conflict: ConflictInfo, meId = NOA_ID) {
  return renderToStaticMarkup(
    <ConflictDialog conflict={conflict} meId={meId} onLoadTheirs={async () => undefined} onKeepMine={async () => undefined} />,
  )
}

describe('ConflictDialog', () => {
  it('keeps the heading line with the name and time', () => {
    const markup = render({ source: 'save', partlySaved: false, server, draft: null })
    expect(markup).toMatch(/Aiden changed this layout (at|on|yesterday)/)
    expect(markup).toContain('data-dismissable="false"')
  })

  it('says "You" when the save was the reader’s own account, from another tab or device', () => {
    const markup = render({ source: 'save', partlySaved: false, server, draft: null }, AIDEN_ID)
    expect(markup).toMatch(/You changed this layout in another tab or on another device (at|on|yesterday)/)
    // Same name, another account: the name shows.
    expect(render({ source: 'save', partlySaved: false, server: { ...server, editedById: NOA_ID.replace('0a', '0c') }, draft: null }, AIDEN_ID)).toMatch(
      /Aiden changed this layout/,
    )
  })

  it('says that Load their version drops this tab’s changes', () => {
    const markup = render({ source: 'save', partlySaved: false, server, draft: null })
    expect(markup).toContain(conflictChoiceMessage('save'))
    expect(markup).toContain('Load their version to drop your changes here')
  })

  it('uses the recovery wording for a closed tab’s draft, and the partly saved wording when its last save landed', () => {
    expect(render({ source: 'recovery', partlySaved: false, server, draft: null })).toContain(
      'Load their version to drop the changes made on this device earlier, or keep them as a new copy.',
    )
    const partly = render({ source: 'recovery', partlySaved: true, server, draft: null })
    expect(partly).toContain(conflictChoiceMessage('recovery-partly-saved').replace(/'/g, '&#x27;'))
    expect(partly).not.toContain('were not saved')
  })

  it('maps each conflict to its wording', () => {
    expect(conflictSource({ source: 'save', partlySaved: false })).toBe('save')
    expect(conflictSource({ source: 'recovery', partlySaved: false })).toBe('recovery')
    expect(conflictSource({ source: 'recovery', partlySaved: true })).toBe('recovery-partly-saved')
  })
})
