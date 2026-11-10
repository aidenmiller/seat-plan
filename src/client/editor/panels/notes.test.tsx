import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { emptyCanvas, type Item, type Note, type Table } from '@/domain/canvas-schema'
import { withEnds } from '@/domain/arrows'
import { makeNote, listNotes, NOTE_TYPES, type NoteType } from '@/domain/notes'
import { makeItem } from '@/domain/presets'
import type { CameraTargets, FrameScheduler } from '../camera/camera-controller'
import { createDocStore } from '../doc-store'
import { createEditorState, EditorStateProvider, type EditorState } from '../state'
import { CanvasToolbar, NotesLayerControls, noteToolHint, switchNotesLayer } from './CanvasToolbar'
import { canvasMenu, type CanvasMenuInput } from './canvas-menu'
import { EditorUiProvider, type EditorUi } from './editor-ui'
import { itemName } from './names'
import { NoteProperties, NoteSummary, type NoteFields } from './NoteProperties'
import { NotesPanel } from './NotesPanel'
import { emptyListText, focusNoteOnPlan, noteCounts, noteFocusCamera, visibleNotes } from './notes-list'
import { PropertiesPanel } from './PropertiesPanel'
import { dropNote, NOTE_TOOL_NAMES, noteToolsBlocked, ShapePanel, toggleNoteTool } from './ShapePanel'

const T0 = Date.UTC(2026, 10, 10, 15, 0, 0)

function note(type: NoteType, id: string, patch: Partial<Note> = {}, at = { x: 0, y: 0 }, minutes = 0): Note {
  return { ...makeNote(type, at, 'Noa', 'yellow', T0 + minutes * 60_000, id), ...patch }
}

function table(id: string, x = 0, y = 0): Table {
  return makeItem('round', { x, y }, id, emptyCanvas()) as Table
}

function manualScheduler(): FrameScheduler {
  let id = 0
  return { requestFrame: () => ++id, cancelFrame: () => undefined, setTimer: () => ++id, clearTimer: () => undefined }
}

function fakeTargets(): CameraTargets {
  const style = { transform: '', transformOrigin: '', setProperty: () => undefined }
  return {
    viewport: { style, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 800 }), setAttribute: () => undefined },
    wrapper: { style: { ...style } },
    world: { setAttribute: () => undefined },
  }
}

type SetupOptions = { mode?: 'edit' | 'view'; select?: string[]; notes?: { visible?: boolean; locked?: boolean } }

function setup(items: Item[], options: SetupOptions = {}): EditorState {
  const editor = createEditorState({
    layoutId: 'L1',
    store: createDocStore({ ...emptyCanvas(), items }),
    onCommit: () => undefined,
    settings: () => ({ unit: 'ft', minGapCm: 152.4 }),
    storage: null,
    scheduler: manualScheduler(),
    traits: () => ({ width: 1440, touchOnly: false, phone: false }),
    author: () => 'Aiden',
    wallClock: () => T0,
  })
  editor.loadDevice()
  editor.camera.attach(fakeTargets())
  editor.camera.set({ zoom: 1, x: 0, y: 0 }, { immediate: true })
  editor.ui.setMode(options.mode ?? 'edit')
  editor.ui.select(options.select ?? [])
  if (options.notes) editor.view.setLayer('notes', options.notes)
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

/** The markup of each Notes tab row, in order. */
function rows(html: string): string[] {
  return html.split('<li ').slice(1)
}

describe('the Notes tab', () => {
  const items = [
    note('sticky', 'n1', { text: 'Keep Uncle Bob away from the bar' }, { x: 0, y: 0 }, 0),
    note('arrow', 'n2', { done: true, color: 'blue', author: 'Aiden' }, { x: 300, y: 0 }, 5),
    note('text', 'n3', { text: 'Photo spot', color: 'green' }, { x: 600, y: 0 }, 10),
  ]

  it('lists every note newest first, with its color, type, text, author and a Done box', () => {
    const html = render(setup(items), <NotesPanel />)
    const list = rows(html)
    expect(list).toHaveLength(3)
    expect(list.map((r) => /data-note-id="([^"]+)"/.exec(r)![1])).toEqual(['n3', 'n2', 'n1'])
    expect(list[2]).toContain('Keep Uncle Bob away from the bar')
    expect(list[2]).toContain('<span class="sr-only">Sticky note: </span>')
    expect(list[2]).toContain('data-note-chip="yellow"')
    expect(list[2]).toMatch(/>Noa · <time/)
    // An arrow with no text goes by its type.
    expect(list[1]).toContain('Arrow')
    expect(list[1]).toContain('data-note-chip="blue"')
    expect(list[1]).toMatch(/data-done="true"/)
    expect(list[1]).toMatch(/<input type="checkbox"[^>]*aria-label="Done: Arrow"[^>]*checked=""/)
    expect(list[0]).not.toMatch(/checked=""/)
    expect(html).not.toMatch(/data-testid="note-done"[^>]*disabled/)
    expect(html).not.toMatch(/type="checkbox"[^>]*disabled=""/)
  })

  it('offers All, Open and Done with their counts', () => {
    const html = render(setup(items), <NotesPanel />)
    expect(html).toMatch(/role="radio" aria-checked="true"[^>]*>All \(3\)</)
    expect(html).toContain('>Open (2)</button>')
    expect(html).toContain('>Done (1)</button>')
  })

  it('reads in View mode: the Done boxes are off', () => {
    const html = render(setup(items, { mode: 'view' }), <NotesPanel />)
    expect(rows(html)).toHaveLength(3)
    expect(html.match(/type="checkbox"[^>]*disabled=""/g)).toHaveLength(3)
  })

  it('shows hidden notes greyed under "Notes hidden", with Show, and nothing to tick', () => {
    const html = render(setup(items, { notes: { visible: false } }), <NotesPanel />)
    expect(html).toContain('data-testid="notes-hidden"')
    expect(html).toContain('Notes hidden')
    expect(html).toContain('>Show</button>')
    expect(html).toMatch(/class="opacity-60" data-testid="notes-list"/)
    expect(html.match(/type="checkbox"[^>]*disabled=""/g)).toHaveLength(3)
  })

  it('says when notes are locked, with Unlock, and nothing to tick', () => {
    const html = render(setup(items, { notes: { locked: true } }), <NotesPanel />)
    expect(html).toContain('data-testid="notes-locked"')
    expect(html).toContain('>Unlock</button>')
    expect(html.match(/type="checkbox"[^>]*disabled=""/g)).toHaveLength(3)
  })

  it('marks the selected note', () => {
    const html = render(setup(items, { select: ['n1'] }), <NotesPanel />)
    expect(rows(html)[2]).toMatch(/bg-blue-50[^>]*data-note-id="n1"[^>]*data-selected="true"/)
  })

  it('says plainly when there are no notes', () => {
    expect(render(setup([]), <NotesPanel />)).toContain('No notes yet. Add one with the Notes tools.')
    expect(render(setup([], { mode: 'view' }), <NotesPanel />)).toContain('No notes on this plan.')
  })
})

describe('the Notes tab list', () => {
  const canvas = {
    items: [
      note('sticky', 'a', {}, undefined, 0),
      note('box', 'b', { done: true }, undefined, 20),
      note('line', 'c', {}, undefined, 10),
      note('circle', 'd', {}, undefined, 10),
    ],
  }
  const notes = listNotes(canvas)

  it('counts open and done notes', () => {
    expect(noteCounts(notes)).toEqual({ all: 4, open: 3, done: 1 })
  })

  it('filters, newest first, the top one first among notes added together', () => {
    expect(visibleNotes(notes, 'all').map((n) => n.id)).toEqual(['b', 'd', 'c', 'a'])
    expect(visibleNotes(notes, 'open').map((n) => n.id)).toEqual(['d', 'c', 'a'])
    expect(visibleNotes(notes, 'done').map((n) => n.id)).toEqual(['b'])
  })

  it('says why a filter is empty', () => {
    expect(emptyListText('open', 2, true)).toBe('No open notes.')
    expect(emptyListText('done', 2, false)).toBe('No done notes.')
    expect(emptyListText('all', 0, false)).toBe('No notes on this plan.')
  })
})

describe('bringing a note into view', () => {
  const viewport = { width: 1000, height: 800 }

  it('centers the note in the free part of the view, keeping a readable zoom', () => {
    const cam = noteFocusCamera({ minX: 940, minY: -60, maxX: 1060, maxY: 60 }, { zoom: 1, x: 0, y: 0 }, viewport, { top: 100, right: 0, bottom: 100, left: 0 })
    expect(cam.zoom).toBe(1)
    expect(cam.x).toBeCloseTo(500 - 1000, 6)
    expect(cam.y).toBeCloseTo(400, 6)
  })

  it('zooms in on a note that would show too small, never past 200%', () => {
    const far = noteFocusCamera({ minX: 0, minY: 0, maxX: 200, maxY: 200 }, { zoom: 0.1, x: 0, y: 0 }, viewport)
    expect(far.zoom).toBeCloseTo((0.35 * 800) / 200, 6)
    const tiny = noteFocusCamera({ minX: 0, minY: 0, maxX: 2, maxY: 2 }, { zoom: 0.1, x: 0, y: 0 }, viewport)
    expect(tiny.zoom).toBeLessThanOrEqual(2)
  })

  it('zooms out from a note that would fill the view', () => {
    const cam = noteFocusCamera({ minX: 0, minY: 0, maxX: 2000, maxY: 1000 }, { zoom: 1, x: 0, y: 0 }, viewport)
    expect(cam.zoom).toBeCloseTo((0.35 * 800) / 2000, 6)
  })

  it('selects the note, shows hidden notes and moves the camera, in View mode too', () => {
    const editor = setup([table('t1'), note('sticky', 'n1', {}, { x: 2000, y: 1000 })], { mode: 'view', notes: { visible: false } })
    expect(focusNoteOnPlan(editor, 'n1')).toBe(true)
    expect(editor.ui.getState().selection).toEqual(['n1'])
    expect(editor.view.getState().layers.notes.visible).toBe(true)
    const center = editor.camera.worldToScreen({ x: 2000, y: 1000 })
    expect(center.x).toBeCloseTo(500, 6)
    expect(center.y).toBeCloseTo(400, 6)
    expect(focusNoteOnPlan(editor, 'nope')).toBe(false)
  })
})

describe('a note in the Properties tab', () => {
  it('edits a sticky note: text, Edit on the plan, color, Done, size, who added it', () => {
    const editor = setup([note('sticky', 'n1', { text: 'Cake here' })], { select: ['n1'] })
    const html = render(editor, <PropertiesPanel />)
    expect(html).toContain('data-testid="note-properties"')
    expect(html).toContain('Sticky note')
    expect(html).toMatch(/<textarea[^>]*data-testid="note-text"[^>]*>Cake here<\/textarea>/)
    expect(html).toContain('data-testid="note-edit-on-plan"')
    expect(html).toMatch(/role="radio" aria-checked="true" aria-label="Yellow"/)
    expect(html.match(/data-color="/g)).toHaveLength(6)
    expect(html).toContain('data-testid="note-done-switch"')
    expect(html).toContain('data-testid="note-width"')
    expect(html).toContain('Added by Noa')
    // Lock, Duplicate and Delete as for any item.
    expect(html).toContain('data-testid="lock-switch"')
    expect(html).toContain('>Delete</button>')
    expect(html).not.toContain('data-testid="note-layer-locked"')
  })

  it('shows what each arrow end holds, with Detach', () => {
    const t = table('t1', 1000, 0)
    const arrow = withEnds(note('arrow', 'a1', { attachedTo: { start: null, end: 't1' } }), { x: 0, y: 0 }, { x: 800, y: 0 })
    const html = render(setup([t, arrow], { select: ['a1'] }), <PropertiesPanel />)
    expect(html).toMatch(/data-arrow-end="start" data-attached="false"/)
    expect(html).toContain('Start:</span> free')
    expect(html).toMatch(/data-arrow-end="end" data-attached="true"/)
    expect(html).toContain('End:</span> attached to Table 1')
    expect(html).toContain('aria-label="Detach end"')
    expect(html).not.toContain('aria-label="Detach start"')
    expect(html).not.toContain('data-testid="note-width"')
    expect(html).not.toContain('data-testid="note-text"')
  })

  it('reads only while the notes layer is locked', () => {
    const html = render(setup([note('sticky', 'n1', { text: 'Cake here' })], { select: ['n1'], notes: { locked: true } }), <PropertiesPanel />)
    expect(html).toContain('Notes are locked. Unlock them to change this note.')
    expect(html).toMatch(/<textarea[^>]*disabled=""/)
    expect(html).toMatch(/disabled=""[^>]*data-testid="note-edit-on-plan"/)
    expect(html).toMatch(/aria-label="Yellow"[^>]*disabled=""[^>]*data-color="yellow"/)
    expect(html).toMatch(/disabled=""[^>]*data-testid="note-done-switch"/)
  })

  it('reads in View mode, with the Done box off and nothing to edit', () => {
    const t = table('t1', 1000, 0)
    const done = note('sticky', 'n1', { text: 'Order flowers\nfor the arch', done: true })
    const html = render(setup([t, done], { mode: 'view', select: ['n1'] }), <PropertiesPanel />)
    expect(html).toContain('data-testid="note-summary"')
    expect(html).toContain('Order flowers\nfor the arch')
    expect(html).toMatch(/<input type="checkbox"[^>]*disabled=""[^>]*checked=""/)
    expect(html).not.toContain('<textarea')
    expect(html).not.toContain('data-testid="note-properties"')
    expect(html).toContain('Added by Noa')
  })

  it('renders straight from the panel fields', () => {
    const fields = { ...note('box', 'b1') } as NoteFields
    const editor = setup([note('box', 'b1')], { select: ['b1'] })
    expect(render(editor, <NoteProperties note={fields} />)).toContain('Box')
    expect(render(editor, <NoteSummary note={fields} />)).toContain('Box')
  })

  it('names a note by its first words, or by its type', () => {
    expect(itemName(note('sticky', 'n1', { text: '  Bob\n\nby the bar ' }))).toBe('Bob by the bar')
    expect(itemName(note('circle', 'n2'))).toBe('Circle')
  })
})

describe('the Notes tools in the shape panel', () => {
  it('offers the six note tools and the six colors', () => {
    const html = render(setup([]), <ShapePanel blank={false} disabled={false} dropTarget={() => null} />)
    expect(html).toContain('data-testid="note-tools"')
    for (const type of NOTE_TYPES) expect(html).toContain(`aria-label="${NOTE_TOOL_NAMES[type]}"`)
    expect(html.match(/data-note-tool="/g)).toHaveLength(6)
    expect(html.match(/data-color="/g)).toHaveLength(6)
    expect(html).toContain('aria-label="Color for new notes"')
    expect(html).toContain('Pick a tool, then click or drag on the plan.')
  })

  it('offers the same note tools on a ceremony layout, beside the seating block tool', () => {
    const html = render(setup([]), <ShapePanel blank={false} ceremony disabled={false} dropTarget={() => null} />)
    expect(html).toContain('data-testid="seating-block-tool"')
    expect(html).not.toContain('aria-label="Add round table"')
    expect(html.match(/data-note-tool="/g)).toHaveLength(6)
    expect(html.match(/data-color="/g)).toHaveLength(6)
  })

  it('says tap in the phone drawer', () => {
    const html = render(setup([]), <ShapePanel blank={false} disabled={false} dropTarget={() => null} columns={3} phone />)
    expect(html).toContain('Tap a tool, then tap or drag on the plan.')
  })

  it('shows the armed tool pressed, and the color new notes take', () => {
    const editor = setup([])
    editor.actions.setNoteTool('arrow')
    editor.ui.setNoteColor('purple')
    const html = render(editor, <ShapePanel blank={false} disabled={false} dropTarget={() => null} />)
    expect(html).toMatch(/aria-label="Arrow note" aria-pressed="true"/)
    expect(html).toMatch(/aria-label="Sticky note" aria-pressed="false"/)
    expect(html).toMatch(/aria-checked="true" aria-label="Purple"/)
  })

  it('turns the tools off while notes are hidden or locked, and says why', () => {
    const hidden = render(setup([], { notes: { visible: false } }), <ShapePanel blank={false} disabled={false} dropTarget={() => null} />)
    expect(hidden).toContain('Notes are hidden. Show them to add notes.')
    expect(hidden.match(/disabled=""[^>]*data-note-tool=/g)).toHaveLength(6)
    expect(noteToolsBlocked({ visible: true, locked: true })).toBe('Notes are locked. Unlock them to add notes.')
    expect(noteToolsBlocked({ visible: true, locked: false })).toBeNull()
  })

  it('arms a tool with a click and puts it down with a second', () => {
    const setNoteTool = vi.fn(() => true)
    expect(toggleNoteTool({ setNoteTool }, null, 'sticky')).toBe(true)
    expect(setNoteTool).toHaveBeenLastCalledWith('sticky')
    expect(toggleNoteTool({ setNoteTool }, 'sticky', 'sticky')).toBe(false)
    expect(setNoteTool).toHaveBeenLastCalledWith(null)
  })

  it('drops a dragged note tool where it lands, and only over the canvas', () => {
    const addNote = vi.fn(() => 'new1')
    const toWorld = (x: number, y: number) => ({ x: x * 2, y: y * 2 })
    expect(dropNote({ addNote }, 'box', { x: 10, y: 20, alt: true }, true, toWorld)).toBe('new1')
    expect(addNote).toHaveBeenCalledWith('box', { x: 20, y: 40 }, { free: true })
    expect(dropNote({ addNote }, 'box', { x: 10, y: 20, alt: false }, false, toWorld)).toBeNull()
    expect(addNote).toHaveBeenCalledTimes(1)
  })

  it('really arms the tool on the editor and refuses it in View mode', () => {
    const editor = setup([])
    expect(toggleNoteTool(editor.actions, null, 'line')).toBe(true)
    expect(editor.ui.getState().tool).toEqual({ kind: 'note', noteType: 'line' })
    expect(toggleNoteTool(editor.actions, 'line', 'line')).toBe(false)
    expect(editor.ui.getState().tool.kind).toBe('select')
    const view = setup([], { mode: 'view' })
    expect(toggleNoteTool(view.actions, null, 'sticky')).toBe(false)
  })
})

describe('the notes layer switches in the toolbar', () => {
  it('shows Show on and Lock off by default, with tooltips', () => {
    const html = render(setup([]), <NotesLayerControls phone={false} edit />)
    expect(html).toMatch(/aria-pressed="true" aria-label="Show notes" title="Notes show\. Click to hide all notes\." data-testid="notes-show" data-state="on"/)
    expect(html).toMatch(/aria-pressed="false" aria-label="Lock notes" title="Click to lock all notes, so they cannot change and clicks go through them\." data-testid="notes-lock" data-state="off"/)
    expect(html).toContain('>Notes</span>')
  })

  it('shows hidden and locked notes as Show off and Lock on', () => {
    const html = render(setup([], { notes: { visible: false, locked: true } }), <NotesLayerControls phone edit />)
    expect(html).toMatch(/aria-pressed="false" aria-label="Show notes" title="Notes are hidden\. Click to show all notes\."[^>]*data-state="off"/)
    expect(html).toMatch(/aria-pressed="true" aria-label="Lock notes" title="Notes are locked\. Click to unlock them\."[^>]*data-state="on"/)
    expect(html).not.toContain('>Notes</span>')
  })

  it('flips the switches on this device, and puts a note tool down when notes hide or lock', () => {
    const editor = setup([])
    editor.actions.setNoteTool('sticky')
    switchNotesLayer(editor, { locked: true })
    expect(editor.view.getState().layers.notes).toEqual({ visible: true, locked: true })
    expect(editor.ui.getState().tool.kind).toBe('select')
    switchNotesLayer(editor, { locked: false })
    editor.actions.setNoteTool('box')
    switchNotesLayer(editor, { visible: false })
    expect(editor.view.getState().layers.notes).toEqual({ visible: false, locked: false })
    expect(editor.ui.getState().tool.kind).toBe('select')
    switchNotesLayer(editor, { visible: true })
    editor.actions.setNoteTool('box')
    switchNotesLayer(editor, { locked: false })
    expect(editor.ui.getState().tool).toEqual({ kind: 'note', noteType: 'box' })
    // Nothing on the canvas changed.
    expect(editor.store.getState().history.past).toHaveLength(0)
  })

  it('keeps Show in View mode and leaves Lock out', () => {
    const html = render(setup([], { mode: 'view' }), <CanvasToolbar phone={false} canEdit={false} onOpenShapes={() => undefined} hint={null} />)
    expect(html).toContain('data-testid="notes-show"')
    expect(html).not.toContain('data-testid="notes-lock"')
    expect(html).not.toContain('data-testid="canvas-toolbar"')
  })

  it('says what a click or drag does while a note tool is armed, with Cancel', () => {
    const editor = setup([])
    editor.actions.setNoteTool('sticky')
    const html = render(editor, <CanvasToolbar phone={false} canEdit onOpenShapes={() => undefined} hint={null} />)
    expect(html).toContain('data-testid="note-tool-hint"')
    expect(html).toContain('Click the plan to add a sticky note, or drag to draw it. Esc cancels.')
    expect(html).toContain('data-testid="note-tool-cancel"')
    expect(noteToolHint('arrow', true)).toBe('Drag on the plan to draw an arrow.')
    expect(noteToolHint('text', true)).toBe('Tap the plan to add text, or drag to draw it.')
  })
})

describe('the canvas menu for a note', () => {
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
  } satisfies CanvasMenuInput['actions']

  function menu(selection: Item[], patch: Partial<CanvasMenuInput> = {}) {
    return canvasMenu({
      target: { kind: 'item', itemId: selection[0].id, itemKind: 'note', locked: false },
      selection,
      guestCount: 0,
      mode: 'edit',
      phone: true,
      canPaste: false,
      actions,
      onSeatRequest: () => undefined,
      onDetails: () => undefined,
      ...patch,
    })
  }

  it('offers Edit text and Mark done for a sticky note, and lowers the phone sheet when typing starts', () => {
    const onEditNote = vi.fn()
    const m = menu([note('sticky', 'n1')], { onEditNote })!
    expect(m.label).toBe('Note menu')
    expect(m.items.map((i) => i.label)).toEqual(['Details', 'Edit text', 'Mark done', 'Lock', 'Copy', 'Duplicate', 'To front', 'To back', 'Delete'])
    m.items.find((i) => i.id === 'editText')!.onSelect()
    expect(actions.startNoteEdit).toHaveBeenCalledWith('n1')
    expect(onEditNote).toHaveBeenCalled()
    m.items.find((i) => i.id === 'done')!.onSelect()
    expect(actions.toggleNoteDone).toHaveBeenCalledWith('n1')
  })

  it('offers Mark not done, and no Edit text, for a done arrow', () => {
    const m = menu([note('arrow', 'a1', { done: true })], { phone: false })!
    expect(m.items.map((i) => i.label)).toEqual(['Mark not done', 'Lock', 'Copy', 'Duplicate', 'To front', 'To back', 'Delete'])
  })

  it('leaves note changes out of View mode', () => {
    const m = menu([note('sticky', 'n1')], { mode: 'view', phone: false })!
    expect(m.items.map((i) => i.label)).toEqual(['Fit to content'])
  })
})
