import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { emptyCanvas } from '@/domain/canvas-schema'
import type { LayoutDetail } from '@/shared/api'
import { EditorShell } from './EditorShell'

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
