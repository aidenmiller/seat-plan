import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { emptyCanvas, type Item, type Table } from '@/domain/canvas-schema'
import { makeItem } from '@/domain/presets'
import type { Group, Guest } from '@/shared/api'
import { createDocStore } from '../doc-store'
import { createEditorState, EditorStateProvider, type EditorState } from '../state'
import { EditorUiProvider, type EditorUi } from './editor-ui'
import { EditorGuestsProvider } from './guests-context'
import { GuestsPanel } from './GuestsPanel'
import { PropertiesPanel } from './PropertiesPanel'
import { GuestGhost, PickStrip, SeatCard, SeatPicker } from './SeatingOverlays'

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
    side: 'both',
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

const jane = guest('Jane', 'Doe', { meal: 'Fish', notes: 'Near the door' })
const bo = guest('Bo', 'Ray')
const ann = guest('Ann', 'Lee')
const cy = guest('Cy', 'Ng', { rsvp: 'no' })
// Jane and Bo are partners.
jane.partnerId = bo.id
bo.partnerId = jane.id
const family: Group = { id: '55555555-5555-4555-8555-555555555555', weddingId: W, name: 'Noa Family', color: '#2563EB', memberIds: [jane.id], createdAt: '', updatedAt: '' }
jane.groupIds = [family.id]
const GUESTS = [jane, bo, ann, cy]

function table(id: string, x: number, guests: (string | null)[]): Table {
  const t = makeItem('round', { x, y: 0 }, id, emptyCanvas()) as Table
  return { ...t, number: Number(id.slice(1)), name: '', seats: t.seats.map((s, i) => ({ index: i, guestId: guests[i] ?? null })) }
}

const ui: EditorUi = { unit: 'ft', phone: false, layoutName: 'Plan', venueLabel: 'Blank canvas', onSeatRequest: () => undefined, showDetails: () => undefined }

function setup(items: Item[], mode: 'edit' | 'view' = 'edit'): EditorState {
  const editor = createEditorState({
    layoutId: 'L1',
    store: createDocStore({ ...emptyCanvas(), items }),
    onCommit: () => undefined,
    settings: () => ({ unit: 'ft', minGapCm: 152.4 }),
    storage: null,
    traits: () => ({ width: 1440, touchOnly: false, phone: false }),
  })
  editor.loadDevice()
  editor.ui.setMode(mode)
  editor.setPeople({ guests: GUESTS, groups: [family] })
  return editor
}

function render(editor: EditorState, node: ReactNode, phone = false): string {
  return renderToStaticMarkup(
    <EditorStateProvider state={editor}>
      <EditorUiProvider value={{ ...ui, phone }}>
        <EditorGuestsProvider value={{ weddingId: W, guests: GUESTS, groups: [family] }}>{node}</EditorGuestsProvider>
      </EditorUiProvider>
    </EditorStateProvider>,
  )
}

describe('the side list is connected to seating (review finding)', () => {
  it('makes each name a focusable row that keeps the list scrolling with a finger', () => {
    const html = render(setup([table('t1', 0, [jane.id])]), <GuestsPanel />)
    const row = new RegExp(`<li role="button" tabindex="0"[^>]*data-testid="side-list-guest" style="touch-action:pan-y;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none" data-guest-id="${jane.id}" data-seated="true"`)
    expect(html).toMatch(row)
    expect(html).toMatch(new RegExp(`data-guest-id="${ann.id}" data-seated="false"`))
    expect(html).toMatch(/<ul role="presentation"/)
  })
})

describe('Properties lists a table’s guests (review finding)', () => {
  it('names each seat’s guest in order, with Move up and Move down in Edit mode', () => {
    const editor = setup([table('t2', 0, [jane.id, null, bo.id])])
    editor.ui.select(['t2'])
    const html = render(editor, <PropertiesPanel />)
    expect(html).toContain('data-testid="table-guests"')
    expect(html).toMatch(/data-seat-row="0"[^>]*data-seat-state="taken"[^>]*data-guest-id="[^"]+"[^>]*>.*?Seat 1.*?Jane Doe/)
    expect(html).toMatch(/data-seat-row="1"[^>]*data-seat-state="empty"[^>]*>.*?Seat 2.*?Empty/)
    expect(html).toMatch(/data-seat-row="2"[^>]*>.*?Bo Ray/)
    expect(html.match(/data-testid="seat-move-up"/g)).toHaveLength(2)
    expect(html).toContain('aria-label="Move Jane Doe up a seat"')
    expect(html).toMatch(/aria-label="Move Jane Doe up a seat" disabled=""/)
  })

  it('lists the names read only in View mode', () => {
    const editor = setup([table('t2', 0, [jane.id])], 'view')
    editor.ui.select(['t2'])
    const html = render(editor, <PropertiesPanel />)
    expect(html).toContain('data-testid="table-seats"')
    expect(html).toContain('Jane Doe')
    expect(html).not.toContain('seat-move-up')
    expect(html).toContain('1 of 8 seats taken')
  })

  it('names the guests selected on the canvas, with Unseat in Edit mode', () => {
    const editor = setup([table('t1', 0, [jane.id, bo.id])])
    editor.ui.selectSeat({ itemId: 't1', seatIndex: 0 })
    editor.ui.selectSeat({ itemId: 't1', seatIndex: 1 }, true)
    const html = render(editor, <PropertiesPanel />)
    expect(html).toContain('2 guests selected')
    expect(html).toContain('<li>Jane Doe</li><li>Bo Ray</li>')
    expect(html).toContain('Unseat 2 guests')
    expect(html).not.toContain('once the guest list is in')
  })
})

describe('the seating overlays (review finding)', () => {
  it('show the + picker with unassigned guests only, each a 44 px row', () => {
    const editor = setup([table('t1', 0, [jane.id])])
    expect(editor.actions.openSeatPicker('t1', 3)).toBe(true)
    const html = render(editor, <SeatPicker />)
    expect(html).toContain('data-testid="seat-picker"')
    expect(html).toContain('Table 1, seat 4')
    const rows = [...html.matchAll(/data-testid="seat-picker-guest" data-guest-id="([^"]+)"/g)].map((m) => m[1])
    // Jane is seated and Cy said no: Ann and Bo, by last name.
    expect(rows).toEqual([ann.id, bo.id])
    expect(html).toMatch(/class="flex min-h-11 w-full[^"]*"[^>]*data-testid="seat-picker-guest"/)
    expect(html).toMatch(/aria-label="Close" class="inline-flex h-11 w-11/)
    // On a phone it runs across the bottom of the screen.
    expect(render(editor, <SeatPicker />, true)).toMatch(/class="fixed inset-x-0 bottom-0/)
    editor.actions.closeSeatPicker()
    expect(render(editor, <SeatPicker />)).toBe('')
  })

  it('show the tap-then-tap strip with Cancel', () => {
    const editor = setup([table('t1', 0, [])])
    expect(render(editor, <PickStrip top={60} />)).toBe('')
    editor.actions.startPick(ann.id)
    const html = render(editor, <PickStrip top={60} />)
    expect(html).toContain('Tap a seat for Ann L.')
    expect(html).toMatch(/class="inline-flex min-h-11[^"]*"[^>]*data-testid="pick-cancel">Cancel</)
  })

  it('show the seat card with name, groups, meal, notes and rule problems', () => {
    // Jane at Table 1, her partner Bo at Table 2: the couple rule is broken.
    const editor = setup([table('t1', 0, [jane.id]), table('t2', 600, [bo.id])], 'view')
    const seat = editor.camera.worldToScreen({ x: 0, y: -(76.2 + 30.5) })
    editor.controller.pointer({ type: 'down', id: 1, pointer: 'touch', button: 0, at: seat, time: 0, target: editor.controller.targetAt(seat), shift: false, alt: false })
    editor.controller.pointer({ type: 'up', id: 1, at: seat, time: 10, shift: false, alt: false })
    expect(editor.seating.store.getState().card).toMatchObject({ guestId: jane.id, source: 'tap' })
    const html = render(editor, <SeatCard />)
    expect(html).toContain('data-testid="seat-card"')
    expect(html).toContain('Jane Doe')
    expect(html).toContain('Noa Family')
    expect(html).toContain('Fish')
    expect(html).toContain('Near the door')
    expect(html).toContain('Partners split across 2 tables')
  })

  it('show the ghost with the guest’s name only while a drag is under way', () => {
    const editor = setup([table('t1', 0, [])])
    expect(render(editor, <GuestGhost />)).toBe('')
    editor.seating.listPointer({ type: 'down', id: 1, pointer: 'mouse', button: 0, guestId: ann.id, at: { x: 2000, y: 300 }, time: 0 })
    editor.seating.listPointer({ type: 'move', id: 1, at: { x: 1900, y: 300 }, time: 0 })
    expect(render(editor, <GuestGhost />)).toMatch(/data-testid="guest-ghost">Ann Lee</)
  })
})
