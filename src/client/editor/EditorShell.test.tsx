import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { emptyCanvas } from '@/domain/canvas-schema'
import { makeItem } from '@/domain/presets'
import type { LayoutDetail } from '@/shared/api'
import { canvasInsets, EditorShell } from './EditorShell'
import { projectOverlay, TAP_TARGET_PX } from './overlay/geometry'
import { PHONE_TOOLBAR_BOTTOM_PX } from './panels/CanvasToolbar'
import { ZOOM_CONTROLS_PX } from './panels/ZoomControls'

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
  name: 'A very long layout name that cannot fit on a phone at all',
  kind: 'reception',
  venueTemplateId: null,
  venueName: null,
  venueDeleted: false,
  version: 3,
  editedBy: 'Noa',
  updatedAt: '2026-11-09T15:42:00.000Z',
  thumbSvg: '<svg/>',
  canvas: emptyCanvas(),
  lastSaveId: null,
  recentSaveIds: [],
  template: null,
}

describe('EditorShell top bar', () => {
  it('never wraps: the name is cut short and the save status has a fixed slot', () => {
    const markup = renderToStaticMarkup(<EditorShell layout={layout} />)
    const header = /<header class="([^"]*)"/.exec(markup)![1].split(' ')
    expect(header).toContain('flex')
    expect(header.some((c) => c.includes('wrap'))).toBe(false)
    const h1 = /<h1 class="([^"]*)"/.exec(markup)![1].split(' ')
    expect(h1).toEqual(expect.arrayContaining(['min-w-0', 'flex-1']))
    expect(h1.some((c) => c.startsWith('basis-'))).toBe(false)
    const slot = /<p role="status"[^>]*data-testid="save-status"[^>]*>/.exec(markup)![0]
    expect(slot).toMatch(/class="[^"]*\bw-24\b[^"]*\bshrink-0\b[^"]*\btruncate\b/)
    expect(slot).toContain('title="Opening…"')
  })
})

describe('canvasInsets', () => {
  // A phone canvas 390 px wide and 700 tall; a laptop one 900 by 800.
  const phone = { width: 390, height: 700 }
  const laptop = { width: 900, height: 800 }
  const zoomRow = (size: { height: number }, phoneLayout: boolean) => {
    const bottom = size.height - (phoneLayout ? 88 + 8 : 8)
    return { top: bottom - ZOOM_CONTROLS_PX, bottom }
  }

  it('keeps the + and − and More buttons of a table at the bottom clear of the zoom controls and, on phones, the sheet', () => {
    for (const [size, phoneLayout] of [
      [phone, true],
      [laptop, false],
    ] as const) {
      const insets = canvasInsets(phoneLayout)
      // A round table centered 10 px above the bottom edge of the canvas, at its right side, at 100%.
      const table = makeItem('round', { x: 0, y: 0 }, 't', emptyCanvas())
      const camera = { zoom: 1, x: size.width - 140, y: size.height - 10 }
      const s = projectOverlay({ selected: [table], mode: 'edit', marquee: null, guides: [], gap: null }, camera, size, { insets })
      const row = zoomRow(size, phoneLayout)
      for (const c of [s.seatButtons!.plus, s.seatButtons!.minus, s.menuButton!.at]) {
        expect(c.y + TAP_TARGET_PX / 2).toBeLessThanOrEqual(row.top - 8)
        expect(c.y - TAP_TARGET_PX / 2).toBeGreaterThanOrEqual(insets.top)
      }
    }
  })

  it('keeps them below the toolbar at the top on every screen size', () => {
    expect(canvasInsets(true).top).toBe(PHONE_TOOLBAR_BOTTOM_PX + 8)
    expect(canvasInsets(false).top).toBe(PHONE_TOOLBAR_BOTTOM_PX + 8)
    expect(canvasInsets(true).bottom).toBe(88 + 8 + ZOOM_CONTROLS_PX + 8)
    expect(canvasInsets(false).bottom).toBe(8 + ZOOM_CONTROLS_PX + 8)
  })
})
