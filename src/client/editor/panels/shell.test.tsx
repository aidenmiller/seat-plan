import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { emptyCanvas } from '@/domain/canvas-schema'
import { makeItem } from '@/domain/presets'
import type { LayoutDetail } from '@/shared/api'
import { EditorShell } from '../EditorShell'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/w/w1/layouts/l1',
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const layout: LayoutDetail = {
  id: '33333333-3333-4333-8333-333333333333',
  weddingId: '44444444-4444-4444-8444-444444444444',
  name: 'Reception',
  kind: 'reception',
  venueTemplateId: null,
  venueName: null,
  venueDeleted: false,
  version: 3,
  editedBy: 'Noa',
  updatedAt: '2026-11-09T15:42:00.000Z',
  thumbSvg: '<svg/>',
  canvas: { ...emptyCanvas(), items: [makeItem('round', { x: 0, y: 0 }, 't1', emptyCanvas())] },
  lastSaveId: null,
  recentSaveIds: [],
  template: null,
}

describe('EditorShell layout', () => {
  // The server render: the desktop layout, in View mode until the device is known.
  const html = renderToStaticMarkup(<EditorShell layout={layout} wedding={{ unit: 'm', minGapCm: 152.4 }} />)

  it('draws the canvas with its tables inside a viewport that turns off browser gestures', () => {
    expect(html).toContain('data-testid="canvas"')
    expect(html).toMatch(/data-item-id="t1" data-kind="table"/)
    expect(html).toMatch(/data-editor-viewport=""[^>]*class="[^"]*editor-grid[^"]*editor-canvas/)
  })

  it('has the top bar pieces: back link, name, save status, mode switch, author switch', () => {
    expect(html).toContain('aria-label="Back to layouts"')
    expect(html).toContain('data-testid="layout-title"')
    expect(html).toContain('data-testid="save-status"')
    expect(html).toContain('data-testid="mode-switch"')
    expect(html).toContain('data-testid="author-switch"')
  })

  it('puts the zoom controls and the right panel tabs on the page', () => {
    expect(html).toContain('data-testid="zoom-controls"')
    expect(html).toContain('data-testid="zoom-level"')
    for (const label of ['Zoom out', 'Zoom in', 'Zoom to 100%', 'Fit to content']) expect(html).toContain(`aria-label="${label}"`)
    for (const tab of ['Properties', 'Guests', 'Groups', 'Problems', 'Notes']) expect(html).toContain(`>${tab}</button>`)
    expect(html).toContain('data-testid="room-panel"')
  })

  it('keeps the shape panel and edit tools out of View mode', () => {
    expect(html).not.toContain('data-testid="shape-panel"')
    expect(html).not.toContain('data-testid="canvas-toolbar"')
  })
})
