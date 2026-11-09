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

const server = { version: 4, editedBy: 'Aiden' as const, updatedAt: '2026-11-09T15:42:00.000Z' }

function render(conflict: ConflictInfo) {
  return renderToStaticMarkup(
    <ConflictDialog conflict={conflict} me="Noa" onLoadTheirs={async () => undefined} onKeepMine={async () => undefined} />,
  )
}

describe('ConflictDialog', () => {
  it('keeps the heading line with the name and time', () => {
    const markup = render({ source: 'save', partlySaved: false, server, draft: null })
    expect(markup).toMatch(/Aiden changed this layout (at|on|yesterday)/)
    expect(markup).toContain('data-dismissable="false"')
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
