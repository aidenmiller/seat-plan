import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { emptyCanvas, type Item, type Table } from '@/domain/canvas-schema'
import { makeItem } from '@/domain/presets'
import type { Group, Guest } from '@/shared/api'
import { createDocStore } from '../doc-store'
import { createEditorState, EditorStateProvider } from '../state'
import { EditorUiProvider, type EditorUi } from './editor-ui'
import { EditorGuestsProvider, refreshOnFocus } from './guests-context'
import { GuestsPanel } from './GuestsPanel'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const W = '44444444-4444-4444-8444-444444444444'
let n = 0
function guest(first: string, last: string, over: Partial<Guest> = {}): Guest {
  n += 1
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    weddingId: W,
    firstName: first,
    lastName: last,
    nickname: null,
    partnerId: null,
    coupleRuleEnabled: true,
    household: null,
    side: 'Both',
    rsvp: 'yes',
    meal: null,
    isChild: false,
    notes: null,
    groupIds: [],
    createdAt: '2026-11-09T12:00:00.000Z',
    updatedAt: '2026-11-09T12:00:00.000Z',
    ...over,
  }
}

const zoe = guest('Zoë', 'Kowalczyk', { nickname: 'Zozo' })
const sam = guest('Sam', 'Lee', { rsvp: 'pending' })
const anna = guest('Anna', 'van der Berg', { rsvp: 'no' })
const theo = guest('Theo', 'Lee')
const group: Group = {
  id: '55555555-5555-4555-8555-555555555555',
  weddingId: W,
  name: 'Aiden Family',
  color: '#2563EB',
  memberIds: [sam.id],
  createdAt: '2026-11-09T12:00:00.000Z',
  updatedAt: '2026-11-09T12:00:00.000Z',
}

function tableWith(guestIds: (string | null)[]): Item {
  const t = makeItem('round', { x: 0, y: 0 }, 't1', emptyCanvas()) as Table
  return { ...t, seats: t.seats.map((s, i) => ({ ...s, guestId: guestIds[i] ?? null })) }
}

const ui: EditorUi = {
  unit: 'ft',
  phone: false,
  layoutName: 'Reception plan',
  venueLabel: 'Blank canvas',
  onSeatRequest: () => undefined,
  showDetails: () => undefined,
}

function render(guests: Guest[], items: Item[], phone = false): string {
  const editor = createEditorState({
    layoutId: 'L1',
    store: createDocStore({ ...emptyCanvas(), items }),
    onCommit: () => undefined,
    settings: () => ({ unit: 'ft', minGapCm: 152.4 }),
    storage: null,
  })
  return renderToStaticMarkup(
    <EditorStateProvider state={editor}>
      <EditorUiProvider value={{ ...ui, phone }}>
        <EditorGuestsProvider value={{ weddingId: W, guests, groups: [group] }}>
          <GuestsPanel />
        </EditorGuestsProvider>
      </EditorUiProvider>
    </EditorStateProvider>,
  )
}

/** The guest rows of one part of the list, as [name text, table label]. */
function rows(html: string, part: 'unassigned' | 'seated'): string[] {
  const start = html.indexOf(`data-testid="side-list-${part}"`)
  const end = html.indexOf('</section>', start)
  const section = html.slice(start, end)
  return [...section.matchAll(/data-testid="side-list-guest"[^>]*>(.*?)<\/li>/g)].map((m) =>
    m[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  )
}

describe('the editor Guests tab', () => {
  const guests = [zoe, sam, anna, theo]
  const items = [tableWith([zoe.id, null, null, null, null, null, null, null])]

  it('shows the counts at the top: yes and pending counted, declined apart (DECISIONS 22)', () => {
    const html = render(guests, items)
    expect(html).toMatch(/data-testid="side-list-counts"[^>]*>3 guests · 1 seated · 2 unassigned · 1 declined</)
  })

  it('lists Unassigned and Seated with each seated guest’s table, declined hidden until asked', () => {
    const html = render(guests, items)
    expect(rows(html, 'unassigned')).toEqual(['Sam Lee', 'Theo Lee'])
    expect(rows(html, 'seated')).toEqual(['Zoë Kowalczyk (Zozo) Table 1'])
    expect(html).toContain('1 declined guest is hidden.')
    expect(html).toContain('data-testid="side-list-show-declined"')
  })

  it('renders each name as a row carrying its guest id, for the seating tools', () => {
    const html = render(guests, items)
    expect(html).toContain(`data-guest-id="${zoe.id}" data-seated="true"`)
    expect(html).toContain(`data-guest-id="${sam.id}" data-seated="false"`)
  })

  it('has the search box and the group, side and RSVP filters; phones open the filters from a button', () => {
    const html = render(guests, items)
    for (const id of ['side-list-search', 'side-list-group', 'side-list-side', 'side-list-rsvp']) expect(html).toContain(`data-testid="${id}"`)
    expect(html).toContain('>Aiden Family</option>')
    const phone = render(guests, items, true)
    expect(phone).toContain('data-testid="side-list-search"')
    expect(phone).not.toContain('data-testid="side-list-filters"')
    expect(phone).toMatch(/aria-expanded="false"[^>]*>Filters</)
  })

  it('points to the Guests tab when there are no guests', () => {
    const html = render([], [])
    expect(html).toContain('No guests yet.')
    expect(html).toContain(`href="/w/${W}/guests"`)
  })
})

describe('refreshing the guest list on focus', () => {
  it('loads again when the window regains focus or the page shows, one load at a time', async () => {
    const win = new EventTarget()
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
    let release: () => void = () => undefined
    const refresh = vi.fn(() => new Promise<void>((resolve) => (release = resolve)))
    const stop = refreshOnFocus(refresh, { windowTarget: win, documentTarget: doc, now: false })
    win.dispatchEvent(new Event('focus'))
    win.dispatchEvent(new Event('focus'))
    expect(refresh).toHaveBeenCalledTimes(1)
    release()
    await Promise.resolve()
    await Promise.resolve()
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(refresh).toHaveBeenCalledTimes(2)
    release()
    await Promise.resolve()
    await Promise.resolve()
    doc.visibilityState = 'hidden'
    doc.dispatchEvent(new Event('visibilitychange'))
    win.dispatchEvent(new Event('focus'))
    expect(refresh).toHaveBeenCalledTimes(2)
    stop()
    doc.visibilityState = 'visible'
    win.dispatchEvent(new Event('focus'))
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('loads once at the start too, since browser Back shows the page with its first lists (review finding)', async () => {
    const win = new EventTarget()
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
    const refresh = vi.fn(() => Promise.resolve())
    const stop = refreshOnFocus(refresh, { windowTarget: win, documentTarget: doc })
    expect(refresh).toHaveBeenCalledTimes(1)
    stop()
    // A page opened in the background waits until it shows.
    const hidden = Object.assign(new EventTarget(), { visibilityState: 'hidden' })
    const later = vi.fn(() => Promise.resolve())
    const stopHidden = refreshOnFocus(later, { windowTarget: win, documentTarget: hidden })
    expect(later).not.toHaveBeenCalled()
    hidden.visibilityState = 'visible'
    hidden.dispatchEvent(new Event('visibilitychange'))
    expect(later).toHaveBeenCalledTimes(1)
    stopHidden()
  })
})
