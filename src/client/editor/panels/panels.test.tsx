import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { emptyCanvas, type Item, type Table } from '@/domain/canvas-schema'
import { makeItem, type PresetId } from '@/domain/presets'
import { nearestSnap, SHEET_TOP_GAP_PX } from '@/client/ui/BottomSheet'
import { moveItems, renameTable, setTableNumber } from '../commands'
import { createDocStore } from '../doc-store'
import type { EditorActions } from '../input/controller'
import { createEditorState, EditorStateProvider, type EditorState } from '../state'
import { memoSelector } from '../state/store'
import { canvasMenu, type CanvasMenuInput } from './canvas-menu'
import { EditorUiProvider, type EditorUi } from './editor-ui'
import { panelFields, PropertiesPanel, samePanelItems, selectPanelItems, tableNumberCount } from './PropertiesPanel'
import { dropTile, ShapePanel, tileDragStarts } from './ShapePanel'
import { unseatLines, unseatSeatNumbers, unseatTitle } from './UnseatDialog'

const GUEST_A = '11111111-1111-4111-8111-111111111111'
const GUEST_B = '22222222-2222-4222-8222-222222222222'

function item(preset: PresetId, id: string, x = 0, y = 0): Item {
  return makeItem(preset, { x, y }, id, emptyCanvas())
}

function setup(items: Item[], mode: 'edit' | 'view' = 'edit', select: string[] = []): EditorState {
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
  editor.ui.select(select)
  return editor
}

const ui: EditorUi = {
  unit: 'ft',
  phone: false,
  layoutName: 'Reception plan',
  venueLabel: 'Blank canvas',
  onSeatRequest: () => undefined,
  showDetails: () => undefined,
}

function render(editor: EditorState, node: ReactNode, overrides: Partial<EditorUi> = {}): string {
  return renderToStaticMarkup(
    <EditorStateProvider state={editor}>
      <EditorUiProvider value={{ ...ui, ...overrides }}>{node}</EditorUiProvider>
    </EditorStateProvider>,
  )
}

describe('PropertiesPanel', () => {
  it('shows the Room panel and the layout with nothing selected', () => {
    const html = render(setup([item('round', 't1')]), <PropertiesPanel />)
    expect(html).toContain('data-testid="room-panel"')
    expect(html).toContain('Reception plan')
    expect(html).toContain('Blank canvas')
    expect(html).toContain('data-testid="snap-switch"')
    expect(html).toContain('data-testid="wheel-setting"')
  })

  it('edits one table: name, number, shape, size in feet, rotation, seats, sides, Fit seats, Lock', () => {
    const html = render(setup([item('rect', 't1')], 'edit', ['t1']), <PropertiesPanel />)
    expect(html).toContain('value="Table 1"')
    expect(html).toContain('data-testid="table-number"')
    expect(html).toContain('data-testid="table-shape"')
    expect(html).toContain('value="8′ 0″"')
    expect(html).toContain('value="2′ 6″"')
    expect(html).toContain('data-testid="table-rotation"')
    expect(html).toContain('data-testid="table-seat-count"')
    expect(html).toContain('aria-label="One seat fewer"')
    expect(html).toContain('aria-label="One more seat"')
    expect(html).toContain('data-testid="table-sides"')
    expect(html).toContain('data-testid="fit-seats"')
    expect(html).toContain('data-testid="lock-switch"')
    expect(html).not.toContain('data-testid="tight-reason"')
  })

  it('says why a table is tight, in yellow', () => {
    const t = { ...(item('round', 't1') as Table), width: 100, height: 100 }
    const html = render(setup([t], 'edit', ['t1']), <PropertiesPanel />)
    expect(html).toMatch(/data-testid="tight-reason">8 seats need/)
    expect(html).toContain('bg-yellow-50')
  })

  it('warns when two tables share a number', () => {
    const a = item('round', 't1')
    const b = { ...(item('round', 't2', 400) as Table), number: 1 }
    const html = render(setup([a, b], 'edit', ['t1']), <PropertiesPanel />)
    expect(html).toContain('Another table also has number 1.')
  })

  it('edits a fixture label and size', () => {
    const html = render(setup([item('bar', 'f1')], 'edit', ['f1']), <PropertiesPanel />)
    expect(html).toContain('data-testid="item-label"')
    expect(html).toContain('value="Bar"')
    expect(html).toContain('data-testid="item-width"')
    expect(html).toContain('data-testid="item-rotation"')
  })

  it('offers align and distribute for several items', () => {
    const html = render(setup([item('round', 't1'), item('round', 't2', 400)], 'edit', ['t1', 't2']), <PropertiesPanel />)
    expect(html).toContain('2 items selected')
    for (const label of ['Left', 'Center', 'Right', 'Top', 'Middle', 'Bottom', 'Space across', 'Space down']) expect(html).toContain(`>${label}</button>`)
  })

  it('reads the selection without x and y, so a drag that moves it changes nothing here', () => {
    const editor = setup([item('round', 't1'), item('bar', 'f1', 400)], 'edit', ['t1', 'f1'])
    const read = memoSelector(editor.store, (s) => selectPanelItems(s.canvas, editor.ui.getState().selection), samePanelItems)
    const before = read()
    expect(before.map((i) => i.id)).toEqual(['t1', 'f1'])
    expect(before.some((i) => 'x' in i || 'y' in i)).toBe(false)

    // Every frame of a drag shows a new canvas with new x and y.
    const drag = editor.doc.begin('Move')!
    for (let frame = 1; frame <= 5; frame++) {
      drag.preview((c) => moveItems(c, ['t1', 'f1'], frame * 10, frame * 5))
      expect(read()).toBe(before)
    }
    drag.commit()
    expect(read()).toBe(before)

    editor.doc.edit('Rename table', (c) => renameTable(c, 't1', 'Family'))
    const renamed = read()
    expect(renamed).not.toBe(before)
    expect(renamed[0]).toMatchObject({ kind: 'table', name: 'Family' })
  })

  it('compares panel fields one by one', () => {
    const t = item('round', 't1')
    expect(samePanelItems([panelFields(t)], [panelFields({ ...t, x: 500, y: -20 })])).toBe(true)
    expect(samePanelItems([panelFields(t)], [panelFields({ ...t, rotation: 15 })])).toBe(false)
    expect(samePanelItems([panelFields(t)], [])).toBe(false)
  })

  it('counts table numbers once per document version', () => {
    const a = item('round', 't1')
    const b = { ...(item('round', 't2', 400) as Table), number: 1 }
    const c = item('bar', 'f1', 800)
    const items = [a, b, c]
    expect(tableNumberCount(items, 1)).toBe(2)
    expect(tableNumberCount(items, 2)).toBe(0)
    // The count is kept for this list of items: documents never change in place, so a new version is a new list.
    items.push({ ...(item('round', 't3', 1200) as Table), number: 1 })
    expect(tableNumberCount(items, 1)).toBe(2)
    expect(tableNumberCount([...items], 1)).toBe(3)

    const editor = setup([a, { ...b, number: 2 }], 'edit', ['t1'])
    expect(render(editor, <PropertiesPanel />)).not.toContain('Another table also has number')
    editor.doc.edit('Number', (canvas) => setTableNumber(canvas, 't2', 1))
    expect(render(editor, <PropertiesPanel />)).toContain('Another table also has number 1.')
  })

  it('lists a table’s seats, read only, in View mode', () => {
    const t = item('round', 't1') as Table
    t.seats[2] = { index: 2, guestId: GUEST_A }
    const html = render(setup([t], 'view', ['t1']), <PropertiesPanel />)
    expect(html).toContain('data-testid="table-seats"')
    expect(html).toContain('1 of 8 seats taken')
    expect(html.match(/data-seat-state="taken"/g)).toHaveLength(1)
    expect(html).not.toContain('<input')
    expect(html).not.toContain('data-testid="snap-switch"')
  })
})

describe('ShapePanel', () => {
  it('offers the five tables, the fixtures and plain shapes', () => {
    const html = render(setup([]), <ShapePanel blank={false} disabled={false} dropTarget={() => null} />)
    for (const name of ['Add round table', 'Add square table', 'Add rectangle table', 'Add long head table', 'Add sweetheart table', 'Add bar', 'Add dance floor', 'Add text']) {
      expect(html).toContain(`aria-label="${name}"`)
    }
    expect(html).not.toContain('Add wall')
  })

  it('lets a finger scroll the tiles up and down: every tile takes touch-action pan-y', () => {
    const html = render(setup([]), <ShapePanel blank={false} disabled={false} dropTarget={() => null} />)
    const tiles = html.match(/<button[^>]*data-preset="[^"]*"[^>]*>/g) ?? []
    expect(tiles.length).toBeGreaterThan(10)
    for (const tile of tiles) expect(tile).toMatch(/class="[^"]*\btouch-pan-y\b/)
  })

  it('starts a finger drag only when the move goes more across than down', () => {
    expect(tileDragStarts(3, 0, 'mouse')).toBe(false)
    expect(tileDragStarts(0, 5, 'mouse')).toBe(true)
    expect(tileDragStarts(0, 12, 'touch')).toBe(false)
    expect(tileDragStarts(6, 6, 'touch')).toBe(false)
    expect(tileDragStarts(10, 4, 'touch')).toBe(true)
    expect(tileDragStarts(-10, 4, 'touch')).toBe(true)
    expect(tileDragStarts(3, 1, 'touch')).toBe(false)
  })

  it('drops a tile on the canvas, off the grid when Alt is held', () => {
    const dropPreset = vi.fn(() => 'new-id')
    expect(dropTile({ dropPreset }, 'round', { x: 400, y: 300, alt: true }, true)).toBe('new-id')
    expect(dropPreset).toHaveBeenLastCalledWith('round', 400, 300, { free: true })
    dropTile({ dropPreset }, 'bar', { x: 10, y: 20, alt: false }, true)
    expect(dropPreset).toHaveBeenLastCalledWith('bar', 10, 20, { free: false })
    expect(dropTile({ dropPreset }, 'bar', { x: 10, y: 20, alt: true }, false)).toBeNull()
    expect(dropPreset).toHaveBeenCalledTimes(2)
  })

  it('adds walls, rooms, doors and windows on a blank canvas', () => {
    const html = render(setup([]), <ShapePanel blank disabled={false} dropTarget={() => null} />)
    for (const name of ['Add wall', 'Add room', 'Add door', 'Add window']) expect(html).toContain(`aria-label="${name}"`)
  })
})

describe('canvasMenu', () => {
  const actions = {
    fitSeats: vi.fn(() => ({ status: 'done' as const })),
    setLocked: vi.fn(() => true),
    copySelection: vi.fn(() => true),
    duplicateSelection: vi.fn(() => true),
    deleteSelection: vi.fn(() => true),
    bringToFront: vi.fn(() => true),
    sendToBack: vi.fn(() => true),
    paste: vi.fn(() => true),
    selectAll: vi.fn(),
    zoomFit: vi.fn(),
    startNoteEdit: vi.fn(() => true),
    toggleNoteDone: vi.fn(() => true),
  } satisfies CanvasMenuInput['actions'] & Partial<EditorActions>

  function menu(patch: Partial<CanvasMenuInput>) {
    return canvasMenu({
      target: { kind: 'empty' },
      selection: [],
      guestCount: 0,
      mode: 'edit',
      phone: false,
      canPaste: false,
      actions,
      onSeatRequest: () => undefined,
      onDetails: () => undefined,
      ...patch,
    })
  }

  it('offers Fit seats, Lock, Copy, Duplicate and Delete for a table', () => {
    const t = item('round', 't1')
    const m = menu({ target: { kind: 'item', itemId: 't1', itemKind: 'table', locked: false }, selection: [t] })
    expect(m?.items.map((i) => i.label)).toEqual(['Fit seats', 'Lock', 'Copy', 'Duplicate', 'Delete'])
    m?.items[0].onSelect()
    expect(actions.fitSeats).toHaveBeenCalledWith('t1')
    actions.copySelection.mockClear()
    m?.items.find((i) => i.id === 'copy')?.onSelect()
    expect(actions.copySelection).toHaveBeenCalledTimes(1)
  })

  it('offers Copy for several items', () => {
    const m = menu({ target: { kind: 'item', itemId: 't1', itemKind: 'table', locked: false }, selection: [item('round', 't1'), item('bar', 'f1', 400)] })
    expect(m?.label).toBe('2 items menu')
    expect(m?.items.map((i) => i.label)).toEqual(['Lock all', 'Copy', 'Duplicate', 'Delete'])
  })

  it('pastes where the menu was opened on empty canvas', () => {
    actions.paste.mockClear()
    menu({ canPaste: true, pasteAt: { x: 120, y: -40 } })?.items[0].onSelect()
    expect(actions.paste).toHaveBeenLastCalledWith({ x: 120, y: -40 })
    menu({ canPaste: true })?.items[0].onSelect()
    expect(actions.paste).toHaveBeenLastCalledWith(null)
  })

  it('adds Details on phones and Unlock for a locked item', () => {
    const f = { ...item('bar', 'f1'), locked: true }
    const m = menu({ target: { kind: 'item', itemId: 'f1', itemKind: 'fixture', locked: true }, selection: [f], phone: true })
    expect(m?.items.map((i) => i.label)).toEqual(['Details', 'Unlock', 'Copy', 'Duplicate', 'To front', 'To back', 'Delete'])
    expect(m?.items.find((i) => i.id === 'delete')?.disabled).toBe(true)
  })

  it('offers Paste, Select all and Fit on empty canvas', () => {
    const m = menu({ canPaste: true })
    expect(m?.items.map((i) => i.label)).toEqual(['Paste', 'Select all', 'Fit to content'])
    expect(m?.items[0].disabled).toBe(false)
  })

  it('is read only in View mode', () => {
    const t = item('round', 't1')
    const m = menu({ mode: 'view', target: { kind: 'item', itemId: 't1', itemKind: 'table', locked: false }, selection: [t] })
    expect(m?.items.map((i) => i.label)).toEqual(['Show seats', 'Fit to content'])
  })

  it('offers Export on the empty canvas in both modes when the editor can export', () => {
    const onExport = vi.fn()
    const edit = menu({ onExport })
    expect(edit?.items.map((i) => i.label)).toEqual(['Paste', 'Select all', 'Fit to content', 'Export'])
    edit?.items.find((i) => i.id === 'export')?.onSelect()
    expect(onExport).toHaveBeenCalledTimes(1)
    expect(menu({ mode: 'view', onExport })?.items.map((i) => i.label)).toEqual(['Fit to content', 'Export'])
    // Not on an item's menu.
    const t = item('round', 't1')
    expect(menu({ onExport, target: { kind: 'item', itemId: 't1', itemKind: 'table', locked: false }, selection: [t] })?.items.some((i) => i.id === 'export')).toBe(false)
  })

  it('leaves seated guests to the guest menu', () => {
    expect(menu({ target: { kind: 'seat', itemId: 't1', seatIndex: 0, guestId: GUEST_A, locked: false }, guestCount: 1 })).toBeNull()
  })
})

describe('the unseat dialog', () => {
  it('asks in plain words, by seat number', () => {
    expect(unseatTitle(1)).toBe('Remove 1 guest from their seat?')
    expect(unseatTitle(2)).toBe('Remove 2 guests from their seats?')
    const t = item('round', 't1') as Table
    t.seats[8 - 1] = { index: 7, guestId: GUEST_A }
    t.seats[6] = { index: 6, guestId: GUEST_B }
    const canvas = { ...emptyCanvas(), items: [t] }
    expect(unseatSeatNumbers(canvas, { tableId: 't1', unseated: [GUEST_A, GUEST_B] })).toEqual([8, 7])
    expect(unseatSeatNumbers(canvas, { tableId: 'nope', unseated: [GUEST_A] })).toEqual([null])
  })

  it('names who loses their seat, lowest seat first (review finding)', () => {
    const t = item('round', 't1') as Table
    t.seats[7] = { index: 7, guestId: GUEST_A }
    t.seats[6] = { index: 6, guestId: GUEST_B }
    const canvas = { ...emptyCanvas(), items: [t] }
    expect(unseatLines(canvas, { tableId: 't1', unseated: [GUEST_A, GUEST_B], names: ['Jane Doe', 'John Roe'] })).toEqual(['Seat 7: John Roe', 'Seat 8: Jane Doe'])
    expect(unseatLines(canvas, { tableId: 'nope', unseated: [GUEST_A], names: ['Jane Doe'] })).toEqual(['Jane Doe'])
  })
})

describe('nearestSnap', () => {
  const sheet = 800
  const strip = 76
  const half = (sheet + SHEET_TOP_GAP_PX) / 2

  it('settles at the nearest height', () => {
    expect(nearestSnap(90, sheet, strip)).toBe('strip')
    expect(nearestSnap(half + 30, sheet, strip)).toBe('half')
    expect(nearestSnap(760, sheet, strip)).toBe('full')
  })

  it('goes one further on a quick flick', () => {
    expect(nearestSnap(half + 10, sheet, strip, -1)).toBe('full')
    expect(nearestSnap(half - 10, sheet, strip, 1)).toBe('strip')
    expect(nearestSnap(strip, sheet, strip, 1)).toBe('strip')
  })
})
