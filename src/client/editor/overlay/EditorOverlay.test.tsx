import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { emptyCanvas, type Item, type Table } from '@/domain/canvas-schema'
import { makeItem } from '@/domain/presets'
import { createDocStore } from '../doc-store'
import type { ContextMenuRequest } from '../input/controller'
import { createEditorState, EditorStateProvider } from '../state'
import { EditorOverlay, moreMenuRequest } from './EditorOverlay'

function render(items: Item[], setup: (editor: ReturnType<typeof createEditorState>) => void) {
  const editor = createEditorState({
    layoutId: 'L1',
    store: createDocStore({ ...emptyCanvas(), items }),
    onCommit: () => undefined,
    settings: () => ({ unit: 'ft', minGapCm: 152.4 }),
    storage: null,
    traits: () => ({ width: 1440, touchOnly: false, phone: false }),
  })
  editor.loadDevice()
  setup(editor)
  return renderToStaticMarkup(
    <EditorStateProvider state={editor}>
      <EditorOverlay />
    </EditorStateProvider>,
  )
}

const table = makeItem('round', { x: 0, y: 0 }, 't1', emptyCanvas())

describe('EditorOverlay', () => {
  it('shows handles, the rotate handle and 44 px seat buttons for one selected table in Edit mode', () => {
    const html = render([table], (e) => e.ui.select(['t1']))
    expect(html.match(/data-handle="/g)).toHaveLength(8)
    expect(html).toContain('data-rotate-handle')
    expect(html).toContain('aria-label="Add a seat"')
    expect(html).toContain('aria-label="Remove a seat"')
    expect(html).toContain('h-11 w-11')
    expect(html).toContain('data-overlay-control')
  })

  it('shows only the outline in View mode', () => {
    const html = render([table], (e) => {
      e.ui.select(['t1'])
      e.ui.setMode('view')
    })
    expect(html).not.toContain('data-handle=')
    expect(html).not.toContain('Add a seat')
    expect(html).toContain('<circle')
  })

  it('shows the gap readout with its warning', () => {
    const html = render([table], (e) =>
      e.interaction.setState({ gap: { otherId: 'x', gapCm: 100, from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, text: '3′ 3″', warn: true } }),
    )
    expect(html).toContain('data-warn="true"')
    expect(html).toContain('3′ 3″ · too close')
  })
})

describe('the More button', () => {
  it('sits with the seat buttons beside a table: 44 px, labelled More, left to its own click handler', () => {
    const html = render([table], (e) => e.ui.select(['t1']))
    const control = html.slice(html.indexOf('data-overlay-control'))
    expect(control).toMatch(/<button[^>]*class="[^"]*h-11 w-11[^"]*"[^>]*aria-label="More"[^>]*aria-haspopup="menu"/)
    expect(control.indexOf('aria-label="Remove a seat"')).toBeLessThan(control.indexOf('aria-label="More"'))
  })

  it('shows alone beside a fixture or several items, and not in View mode or with nothing selected', () => {
    const bar = makeItem('bar', { x: 400, y: 0 }, 'f1', emptyCanvas())
    const one = render([table, bar], (e) => e.ui.select(['f1']))
    expect(one).toContain('aria-label="More"')
    expect(one).not.toContain('Add a seat')
    const several = render([table, bar], (e) => e.ui.select(['t1', 'f1']))
    expect(several).toContain('aria-label="More"')
    expect(several).not.toContain('Add a seat')
    expect(render([table], (e) => e.ui.select([]))).not.toContain('aria-label="More"')
    const view = render([table], (e) => {
      e.ui.select(['t1'])
      e.ui.setMode('view')
    })
    expect(view).not.toContain('aria-label="More"')
  })

  it('opens the same menu as right click, at the button, for the selection', () => {
    const bar = makeItem('bar', { x: 400, y: 0 }, 'f1', emptyCanvas())
    const heard: ContextMenuRequest[] = []
    const editor = createEditorState({
      layoutId: 'L1',
      store: createDocStore({ ...emptyCanvas(), items: [table, bar] }),
      onCommit: () => undefined,
      settings: () => ({ unit: 'ft', minGapCm: 152.4 }),
      storage: null,
      traits: () => ({ width: 1440, touchOnly: false, phone: false }),
      events: { onContextMenu: (r) => heard.push(r) },
    })
    editor.loadDevice()
    editor.ui.select(['t1', 'f1'])
    // The viewport's top left is at (0, 0) until mounted, so client and screen points agree.
    const request = moreMenuRequest(bar, { left: 600, bottom: 344 }, editor.camera)
    expect(request).toEqual({ at: { x: 600, y: 344 }, target: { kind: 'item', itemId: 'f1', itemKind: 'fixture', locked: false } })
    editor.controller.contextMenu(request.at, request.target, 'touch')
    expect(heard).toEqual([{ at: { x: 600, y: 344 }, target: request.target, pointer: 'touch' }])
    // The selection stays as it was, so the menu is the several-items one.
    expect(editor.ui.getState().selection).toEqual(['t1', 'f1'])
  })

  it('reads the button place through the camera', () => {
    const camera = { clientToScreen: (x: number, y: number) => ({ x: x - 10, y: y - 60 }) }
    expect(moreMenuRequest({ id: 't1', kind: 'table', locked: true }, { left: 300, bottom: 200 }, camera)).toEqual({
      at: { x: 290, y: 140 },
      target: { kind: 'item', itemId: 't1', itemKind: 'table', locked: true },
    })
  })
})

describe('seating in the overlay', () => {
  const seated = { ...(table as Table), seats: (table as Table).seats.map((seat, i) => ({ index: i, guestId: i === 0 ? 'g1' : null })) }

  it('rings selected guests and offers the guest menu beside them in Edit mode', () => {
    const html = render([seated], (e) => e.ui.selectSeat({ itemId: 't1', seatIndex: 0 }))
    expect(html).toContain('data-testid="guest-selection"')
    expect(html).toMatch(/aria-label="Guest menu"[^>]*aria-haspopup="menu"/)
    const view = render([seated], (e) => {
      e.ui.selectSeat({ itemId: 't1', seatIndex: 0 })
      e.ui.setMode('view')
    })
    expect(view).toContain('data-testid="guest-selection"')
    expect(view).not.toContain('Guest menu')
  })
})
