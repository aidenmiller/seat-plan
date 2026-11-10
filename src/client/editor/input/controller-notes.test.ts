import { describe, expect, it } from 'vitest'
import { emptyCanvas, type Author, type Canvas, type ChairRow, type Item, type Note, type Table } from '@/domain/canvas-schema'
import { resolveArrow, storedEnds, withEnds } from '@/domain/arrows'
import { distance } from '@/domain/geometry'
import { makeNote } from '@/domain/notes'
import { makeItem } from '@/domain/presets'
import { chairRowSeatCenters } from '@/domain/seating'
import { seatLayout } from '@/domain/seats'
import { createClipboard, type ClipboardData } from '../clipboard'
import { createDocStore } from '../doc-store'
import type { CameraTargets, FrameScheduler } from '../camera/camera-controller'
import { createEditorState, type EditorEvents } from '../state'
import type { StorageLike } from '../state/device-view'
import type { Target } from './hit-test'
import type { KeyLike } from './keyboard'
import type { PointerKind } from './pointer-machine'

const FT = 30.48
const NOW = Date.UTC(2026, 10, 10, 20, 15, 0)
/** The chair ring of a 60 in round table with seats. */
const RING = 76.2 + 53

function memoryStorage(): StorageLike {
  const data = new Map<string, string>()
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) }
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

type Options = {
  items?: Item[]
  mode?: 'edit' | 'view'
  author?: Author | null
  events?: EditorEvents
}

function harness(options: Options = {}) {
  const store = createDocStore({ ...emptyCanvas(), items: options.items ?? [] })
  const commits: Canvas[] = []
  const refusals: (string | undefined)[] = []
  let n = 0
  let time = 0
  const memory: { data: ClipboardData | null; pastes: Map<string, number> } = { data: null, pastes: new Map() }
  const editor = createEditorState({
    layoutId: 'L1',
    store,
    onCommit: (c) => commits.push(c),
    settings: () => ({ unit: 'ft', minGapCm: 152.4 }),
    storage: memoryStorage(),
    newId: () => `new${++n}`,
    scheduler: manualScheduler(),
    traits: () => ({ width: 1440, touchOnly: false, phone: false }),
    clipboard: createClipboard({ memory, now: () => time }),
    author: () => (options.author === undefined ? 'Aiden' : options.author),
    wallClock: () => NOW,
    now: () => time,
    setTimer: () => undefined,
    events: { ...options.events, onRefused: (reason) => void refusals.push(reason) },
  })
  editor.loadDevice()
  editor.camera.attach(fakeTargets())
  // Screen px equal world cm.
  editor.camera.set({ zoom: 1, x: 0, y: 0 }, { immediate: true })
  editor.ui.setState({ mode: options.mode ?? 'edit' })
  const c = editor.controller
  let pointerId = 1
  const mods = (o: { shift?: boolean; alt?: boolean }) => ({ shift: o.shift ?? false, alt: o.alt ?? false })
  type PressOptions = { shift?: boolean; alt?: boolean; pointer?: PointerKind; target?: Target }

  const h = {
    editor,
    store,
    commits,
    refusals,
    memory,
    canvas: () => store.getState().canvas,
    item: (id: string) => store.getState().canvas.items.find((i) => i.id === id) as Item,
    note: (id: string) => store.getState().canvas.items.find((i) => i.id === id) as Note,
    ui: () => editor.ui.getState(),
    tick: (ms: number) => void (time += ms),
    down(x: number, y: number, o: PressOptions = {}) {
      const id = pointerId++
      c.pointer({ type: 'down', id, pointer: o.pointer ?? 'mouse', button: 0, at: { x, y }, time, target: o.target ?? c.targetAt({ x, y }), ...mods(o) })
      return {
        move: (mx: number, my: number, m: { shift?: boolean; alt?: boolean } = o) => c.pointer({ type: 'move', id, at: { x: mx, y: my }, time, ...mods(m) }),
        up: (ux: number, uy: number, m: { shift?: boolean; alt?: boolean } = o) => c.pointer({ type: 'up', id, at: { x: ux, y: uy }, time, ...mods(m) }),
      }
    },
    /** A whole press: down at the first point, moves through the rest, up at the last. */
    drag(points: [number, number][], o: PressOptions = {}) {
      const p = h.down(points[0][0], points[0][1], o)
      for (const [x, y] of points.slice(1)) p.move(x, y)
      const [xl, yl] = points[points.length - 1]
      p.up(xl, yl)
    },
    click(x: number, y: number, o: PressOptions = {}) {
      h.drag([[x, y]], o)
    },
    key(key: string, o: Partial<KeyLike> = {}, target?: unknown) {
      return c.keyDown({ key, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...o }, target)
    },
    undoSteps: () => store.getState().history.past.length,
  }
  return h
}

const round = (id: string, x = 0, y = 0): Table => makeItem('round', { x, y }, id, emptyCanvas()) as Table
const sticky = (id: string, x = 0, y = 0, text = 'Bob'): Note => ({ ...makeNote('sticky', { x, y }, 'Noa', 'yellow', 0, id), text })
const arrowNote = (id: string, start: { x: number; y: number }, end: { x: number; y: number }, attachedTo: Note['attachedTo'] = { start: null, end: null }): Note =>
  withEnds({ ...makeNote('arrow', { x: 0, y: 0 }, 'Noa', 'blue', 0, id), attachedTo }, start, end)

function expectAt(p: { x: number; y: number }, x: number, y: number) {
  expect(p.x).toBeCloseTo(x, 6)
  expect(p.y).toBeCloseTo(y, 6)
}

describe('placing notes', () => {
  it('places a sticky note with a click: the author, the color picked last, one undo step, then typing', () => {
    const h = harness()
    h.editor.actions.setNoteColor('pink')
    h.editor.actions.setNoteTool('sticky')
    expect(h.ui().tool).toEqual({ kind: 'note', noteType: 'sticky' })
    h.click(100, 50)
    const id = 'new1'
    // Snapped to the 1 ft grid.
    expect(h.note(id)).toMatchObject({ type: 'sticky', x: 3 * FT, y: 2 * FT, author: 'Aiden', color: 'pink', createdAt: '2026-11-10T20:15:00.000Z' })
    expect(h.ui().selection).toEqual([id])
    expect(h.ui().tool.kind).toBe('select')
    expect(h.ui().noteEdit).toEqual({ id, text: '', original: '' })
    expect(h.commits).toHaveLength(1)
    expect(h.undoSteps()).toBe(1)
  })

  it('places with Alt exactly at the click, and an arrow 200 cm long', () => {
    const h = harness()
    h.editor.actions.setNoteTool('arrow')
    h.click(100, 50, { alt: true })
    const arrow = h.note('new1')
    expect(storedEnds(arrow)).toEqual({ start: { x: 0, y: 50 }, end: { x: 200, y: 50 } })
    expect(h.ui().noteEdit).toBeNull()
  })

  it('adds a note from a button at the viewport center', () => {
    const h = harness()
    const id = h.editor.actions.addNote('box', null, { color: 'green', edit: false })!
    expect(h.note(id)).toMatchObject({ type: 'box', color: 'green', author: 'Aiden' })
    expect(distance(h.note(id), { x: 500, y: 400 })).toBeLessThan(FT)
    expect(h.ui().noteEdit).toBeNull()
  })

  it('draws an arrow from one table to another, attached at both ends, as one undo step', () => {
    const h = harness({ items: [round('a'), round('b', 600, 0)] })
    h.editor.actions.setNoteTool('arrow')
    const p = h.down(10, 10)
    p.move(300, 0)
    expect(h.editor.interaction.getState().attachTarget).toBeNull()
    p.move(590, 20)
    expect(h.editor.interaction.getState().attachTarget).toBe('b')
    p.up(590, 20)
    const arrow = h.note('new1')
    expect(arrow.attachedTo).toEqual({ start: 'a', end: 'b' })
    const ends = resolveArrow(arrow, h.canvas())
    expectAt(ends.start, RING, 0)
    expectAt(ends.end, 600 - RING, 0)
    expect(h.commits).toHaveLength(1)
    expect(h.undoSteps()).toBe(1)
    expect(h.ui().selection).toEqual(['new1'])
    expect(h.ui().tool.kind).toBe('select')
    expect(h.editor.interaction.getState()).toMatchObject({ attachTarget: null, gesture: null })
    h.editor.actions.undo()
    expect(h.canvas().items).toHaveLength(2)
  })

  it('draws free ends with Alt, exactly where the drag went', () => {
    const h = harness({ items: [round('a'), round('b', 600, 0)] })
    h.editor.actions.setNoteTool('line')
    h.drag(
      [
        [10, 10],
        [300, 5],
        [590, 20],
      ],
      { alt: true },
    )
    const line = h.note('new1')
    expect(line).toMatchObject({ type: 'line', attachedTo: { start: null, end: null } })
    expect(storedEnds(line)).toEqual({ start: { x: 10, y: 10 }, end: { x: 590, y: 20 } })
  })

  it('snaps free ends to the grid', () => {
    const h = harness()
    h.editor.actions.setNoteTool('arrow')
    h.drag([
      [10, 10],
      [200, 95],
    ])
    const ends = storedEnds(h.note('new1'))
    expectAt(ends.start, 0, 0)
    expectAt(ends.end, 7 * FT, 3 * FT)
  })

  it('draws a box from corner to corner, and a sticky note that then takes typing', () => {
    const h = harness()
    h.editor.actions.setNoteTool('box')
    h.drag([
      [0, 0],
      [200, 100],
      [6 * FT, 4 * FT],
    ])
    expect(h.note('new1')).toMatchObject({ type: 'box', x: 3 * FT, y: 2 * FT, width: 6 * FT, height: 4 * FT })
    h.editor.actions.setNoteTool('sticky')
    h.drag([
      [600, 0],
      [600 + 4 * FT, 4 * FT],
    ])
    expect(h.note('new2')).toMatchObject({ type: 'sticky' })
    expect(h.ui().noteEdit?.id).toBe('new2')
  })

  it('draws with one finger on a phone instead of panning', () => {
    const h = harness()
    h.editor.actions.setNoteTool('arrow')
    const before = h.editor.camera.get()
    h.drag(
      [
        [0, 0],
        [100, 0],
        [300, 0],
      ],
      { pointer: 'touch' },
    )
    expect(h.editor.camera.get()).toEqual(before)
    expect(h.note('new1').type).toBe('arrow')
  })

  it('cancels a drawing with Esc, then Esc drops the tool', () => {
    const h = harness()
    h.editor.actions.setNoteTool('arrow')
    const p = h.down(0, 0)
    p.move(300, 0)
    expect(h.canvas().items).toHaveLength(1)
    expect(h.key('Escape')).toBe(true)
    expect(h.canvas().items).toHaveLength(0)
    p.up(300, 0)
    expect(h.commits).toHaveLength(0)
    expect(h.ui().tool.kind).toBe('note')
    h.key('Escape')
    expect(h.ui().tool.kind).toBe('select')
  })

  it('refuses a note when nobody has picked Noa or Aiden', () => {
    const options: Options = { author: null }
    const h = harness(options)
    expect(h.editor.actions.addNote('sticky')).toBeNull()
    expect(h.editor.actions.setNoteTool('arrow')).toBe(false)
    expect(h.ui().tool.kind).toBe('select')
    // Armed while someone was picked, then the choice was cleared on this device.
    options.author = 'Noa'
    expect(h.editor.actions.setNoteTool('arrow')).toBe(true)
    options.author = null
    h.drag([
      [0, 0],
      [300, 0],
    ])
    h.click(500, 500)
    expect(h.canvas().items).toHaveLength(0)
    expect(h.commits).toHaveLength(0)
    expect(h.refusals).toEqual(['noAuthor', 'noAuthor', 'noAuthor', 'noAuthor'])
  })

  it('gives a drag that snaps back to its start the default 200 cm arrow', () => {
    const h = harness()
    h.editor.actions.setNoteTool('arrow')
    h.drag([
      [0, 0],
      [8, 6],
    ])
    expect(storedEnds(h.note('new1'))).toEqual({ start: { x: 0, y: 0 }, end: { x: 200, y: 0 } })
    expect(h.undoSteps()).toBe(1)
  })
})

describe('arrow ends', () => {
  const vertex = (index: number): Target => ({ kind: 'vertex', itemId: 'n', index })

  it('attaches an end dropped on a table, and Alt drops it free', () => {
    const h = harness({ items: [round('a'), arrowNote('n', { x: -300, y: 400 }, { x: 300, y: 400 })] })
    h.editor.ui.select(['n'])
    const p = h.down(300, 400, { target: vertex(1) })
    p.move(100, 200)
    p.move(20, 30)
    expect(h.editor.interaction.getState().attachTarget).toBe('a')
    p.up(20, 30)
    expect(h.note('n').attachedTo).toEqual({ start: null, end: 'a' })
    expect(distance(resolveArrow(h.note('n'), h.canvas()).end, { x: 0, y: 0 })).toBeCloseTo(RING, 6)
    expect(h.undoSteps()).toBe(1)
    expect(h.commits).toHaveLength(1)

    const q = h.down(0, 0, { target: vertex(1), alt: true })
    q.move(15, 10, { alt: true })
    q.up(15, 10, { alt: true })
    expect(h.note('n').attachedTo.end).toBeNull()
    expectAt(storedEnds(h.note('n')).end, 15, 10)
    expect(h.undoSteps()).toBe(2)
  })

  it('never attaches both ends to one table', () => {
    const h = harness({ items: [round('a'), arrowNote('n', { x: 0, y: 0 }, { x: 400, y: 400 }, { start: 'a', end: null })] })
    h.editor.ui.select(['n'])
    const p = h.down(400, 400, { target: vertex(1) })
    p.move(30, 30)
    expect(h.editor.interaction.getState().attachTarget).toBeNull()
    p.up(30, 30)
    expect(h.note('n').attachedTo).toEqual({ start: 'a', end: null })
  })

  it('attaches and detaches from the panel', () => {
    const h = harness({ items: [round('a'), arrowNote('n', { x: 200, y: 400 }, { x: 600, y: 400 })] })
    expect(h.editor.actions.attachArrowEnd('n', 'start', 'a')).toBe(true)
    expect(h.note('n').attachedTo.start).toBe('a')
    expect(h.editor.actions.detachArrowEnd('n', 'start')).toBe(true)
    expect(h.note('n').attachedTo.start).toBeNull()
    expect(h.undoSteps()).toBe(2)
  })

  it('follows a table dragged and turned, with no edit to the arrow', () => {
    const arrow = arrowNote('n', { x: 0, y: 0 }, { x: 800, y: 0 }, { start: 't', end: null })
    const t = makeItem('rect', { x: 0, y: 0 }, 't', emptyCanvas()) as Table
    const h = harness({ items: [t, arrow] })
    h.drag(
      [
        [0, 0],
        [0, 150],
        [0, 300],
      ],
      { alt: true },
    )
    h.editor.ui.select(['t'])
    h.editor.actions.setItemBox('t', { rotation: 90 })
    expect(h.note('n')).toBe(arrow)
    expect(h.item('t')).toMatchObject({ x: 0, y: 300, rotation: 90 })
    const start = resolveArrow(h.note('n'), h.canvas()).start
    expect(start.x).toBeCloseTo(38.1 + 53, 6)
    expect((start.y - 300) / start.x).toBeCloseTo(-300 / 800, 6)
  })

  it('leaves an end where it was drawn when its table is deleted, and undo brings both back', () => {
    const h = harness({ items: [round('a', 0, 0), arrowNote('n', { x: 0, y: 0 }, { x: 600, y: 0 }, { start: 'a', end: null })] })
    h.click(0, 0)
    expect(h.ui().selection).toEqual(['a'])
    expect(h.key('Delete')).toBe(true)
    expect(h.note('n').attachedTo.start).toBeNull()
    expectAt(storedEnds(h.note('n')).start, RING, 0)
    expect(h.undoSteps()).toBe(1)
    h.key('z', { metaKey: true })
    expect(h.note('n').attachedTo.start).toBe('a')
  })

  it('copies an arrow alone as a free arrow', () => {
    const h = harness({ items: [round('a'), arrowNote('n', { x: 0, y: 0 }, { x: 600, y: 0 }, { start: 'a', end: null })] })
    h.editor.ui.select(['n'])
    expect(h.key('c', { metaKey: true })).toBe(true)
    const copied = h.memory.data!.items[0] as Note
    expect(copied.attachedTo).toEqual({ start: null, end: null })
    expectAt(storedEnds(copied).start, RING, 0)
  })
})

describe('typing into a note', () => {
  it('starts on Enter, keeps a draft, and saves it on Esc as one undo step and one save', () => {
    const h = harness({ items: [sticky('s', 0, 0, 'Bob')] })
    h.editor.ui.select(['s'])
    expect(h.key('Enter')).toBe(true)
    expect(h.ui().noteEdit).toEqual({ id: 's', text: 'Bob', original: 'Bob' })
    h.editor.ui.setNoteDraft('Bob not')
    h.editor.ui.setNoteDraft('Bob not near the bar')
    expect(h.note('s').text).toBe('Bob')
    expect(h.key('Escape')).toBe(true)
    expect(h.ui().noteEdit).toBeNull()
    expect(h.note('s').text).toBe('Bob not near the bar')
    expect(h.commits).toHaveLength(1)
    expect(h.undoSteps()).toBe(1)
    // Esc again clears the selection as usual.
    h.key('Escape')
    expect(h.ui().selection).toEqual([])
  })

  it('saves nothing when the text did not change', () => {
    const h = harness({ items: [sticky('s')] })
    h.editor.ui.select(['s'])
    h.key('Enter')
    expect(h.editor.actions.finishNoteEdit()).toBe(false)
    expect(h.commits).toHaveLength(0)
  })

  it('ends with Cmd+Enter, and drops the draft on cancel', () => {
    const h = harness({ items: [sticky('s')] })
    h.editor.actions.startNoteEdit('s')
    expect(h.ui().selection).toEqual(['s'])
    h.editor.ui.setNoteDraft('One')
    expect(h.key('Enter', { metaKey: true })).toBe(true)
    expect(h.note('s').text).toBe('One')
    h.editor.actions.startNoteEdit('s')
    h.editor.ui.setNoteDraft('Two')
    h.editor.actions.cancelNoteEdit()
    expect(h.note('s').text).toBe('One')
    expect(h.ui().noteEdit).toBeNull()
  })

  it('leaves Enter alone on other notes, on a focused button, and with no single text note selected', () => {
    const h = harness({ items: [sticky('s'), makeNote('box', { x: 500, y: 0 }, 'Noa', 'grey', 0, 'b'), round('t', 0, 500)] })
    h.editor.ui.select(['b'])
    expect(h.key('Enter')).toBe(false)
    h.editor.ui.select(['t'])
    expect(h.key('Enter')).toBe(false)
    h.editor.ui.select(['s', 'b'])
    expect(h.key('Enter')).toBe(false)
    h.editor.ui.select(['s'])
    expect(h.key('Enter', {}, { tagName: 'BUTTON' })).toBe(false)
    expect(h.key('Enter', { shiftKey: true })).toBe(false)
    expect(h.ui().noteEdit).toBeNull()
  })

  it('saves the draft when the canvas is pressed', () => {
    const h = harness({ items: [sticky('s'), round('t', 600, 0)] })
    h.editor.actions.startNoteEdit('s')
    h.editor.ui.setNoteDraft('Seen')
    h.click(600, 0)
    expect(h.note('s').text).toBe('Seen')
    expect(h.ui().noteEdit).toBeNull()
    expect(h.ui().selection).toEqual(['t'])
  })

  it('saves the draft before switching to View mode', () => {
    const h = harness({ items: [sticky('s')] })
    h.editor.actions.startNoteEdit('s')
    h.editor.ui.setNoteDraft('Kept')
    h.editor.actions.setMode('view')
    expect(h.note('s').text).toBe('Kept')
    expect(h.ui().mode).toBe('view')
    expect(h.ui().noteEdit).toBeNull()
  })

  it('starts on a second tap on the selected note, not the first', () => {
    const h = harness({ items: [sticky('s', 0, 0)] })
    h.click(10, 10, { pointer: 'touch' })
    expect(h.ui().selection).toEqual(['s'])
    expect(h.ui().noteEdit).toBeNull()
    h.click(10, 10, { pointer: 'touch' })
    expect(h.ui().noteEdit?.id).toBe('s')
  })

  it('types into a locked note too, which still cannot move', () => {
    const h = harness({ items: [{ ...sticky('s', 0, 0), locked: true }] })
    h.click(10, 10)
    h.click(10, 10)
    expect(h.ui().noteEdit?.id).toBe('s')
    h.editor.ui.setNoteDraft('Locked but kept')
    h.key('Escape')
    expect(h.note('s')).toMatchObject({ text: 'Locked but kept', x: 0, y: 0, locked: true })
    expect(h.editor.actions.nudge('right')).toBe(false)
    expect(h.note('s').x).toBe(0)
  })

  it('drops the draft when the note goes away', () => {
    const h = harness({ items: [sticky('s')] })
    h.editor.actions.startNoteEdit('s')
    // The other person's version loaded, without the note.
    h.store.replace({ ...emptyCanvas(), items: [] })
    expect(h.ui().noteEdit).toBeNull()
  })
})

describe('note changes', () => {
  it('colors the selected notes, and remembers the color with nothing selected', () => {
    const h = harness({ items: [sticky('s'), sticky('u', 300), round('t', 0, 600)] })
    h.editor.ui.select(['s', 'u', 't'])
    expect(h.editor.actions.setNoteColor('blue')).toBe(true)
    expect([h.note('s').color, h.note('u').color]).toEqual(['blue', 'blue'])
    expect(h.undoSteps()).toBe(1)
    h.editor.ui.clearSelection()
    expect(h.editor.actions.setNoteColor('green')).toBe(true)
    expect(h.ui().noteColor).toBe('green')
    expect(h.undoSteps()).toBe(1)
  })

  it('edits text and marks done, each one undo step and one save', () => {
    const h = harness({ items: [sticky('s')] })
    expect(h.editor.actions.setNoteText('s', 'Call DJ')).toBe(true)
    expect(h.editor.actions.toggleNoteDone('s')).toBe(true)
    expect(h.note('s')).toMatchObject({ text: 'Call DJ', done: true })
    expect(h.editor.actions.setNoteDone(['s'], false)).toBe(true)
    expect(h.note('s').done).toBe(false)
    expect(h.undoSteps()).toBe(3)
    expect(h.commits).toHaveLength(3)
    expect(h.editor.actions.setNoteText('missing', 'x')).toBe(false)
  })

  it('pans to a note from the Notes tab, showing hidden notes, in View mode too', () => {
    const h = harness({ items: [sticky('s', 2000, 1000)], mode: 'view' })
    h.editor.view.setLayer('notes', { visible: false })
    expect(h.editor.actions.focusNote('s')).toBe(true)
    expect(h.editor.view.getState().layers.notes.visible).toBe(true)
    expect(h.ui().selection).toEqual(['s'])
    const center = h.editor.camera.worldToScreen({ x: 2000, y: 1000 })
    expectAt(center, 500, 400)
    expect(h.editor.actions.focusNote('missing')).toBe(false)
  })
})

describe('View mode', () => {
  it('refuses every note change, with nothing saved', () => {
    const h = harness({ items: [round('a'), sticky('s', 0, 600), arrowNote('n', { x: 300, y: 0 }, { x: 600, y: 0 })], mode: 'view' })
    const actions = h.editor.actions
    expect(actions.addNote('sticky')).toBeNull()
    expect(actions.setNoteText('s', 'x')).toBe(false)
    h.editor.ui.select(['s'])
    expect(actions.setNoteColor('pink')).toBe(false)
    expect(actions.toggleNoteDone('s')).toBe(false)
    expect(actions.setNoteDone('s', true)).toBe(false)
    expect(actions.attachArrowEnd('n', 'start', 'a')).toBe(false)
    expect(actions.detachArrowEnd('n', 'start')).toBe(false)
    expect(actions.startNoteEdit('s')).toBe(false)
    expect(h.key('Enter')).toBe(true)
    expect(h.ui().noteEdit).toBeNull()
    // Every drag pans in View mode, the end handle's too.
    h.drag(
      [
        [600, 0],
        [500, 300],
      ],
      { target: { kind: 'vertex', itemId: 'n', index: 1 } },
    )
    expect(h.commits).toHaveLength(0)
    expect(h.undoSteps()).toBe(0)
    expect(h.refusals.length).toBeGreaterThanOrEqual(8)
    expect(h.refusals.every((r) => r === undefined)).toBe(true)
  })

  it('has no note tool', () => {
    const h = harness()
    h.editor.actions.setNoteTool('sticky')
    h.editor.actions.setMode('view')
    expect(h.ui().tool.kind).toBe('select')
    h.click(100, 100)
    expect(h.canvas().items).toHaveLength(0)
    expect(h.editor.actions.setNoteTool('arrow')).toBe(false)
    expect(h.ui().tool.kind).toBe('select')
    expect(h.refusals).toEqual([undefined])
  })
})

describe('the notes layer', () => {
  it('when hidden: notes cannot be hit or selected, leave the selection, and refuse changes', () => {
    const h = harness({ items: [round('t'), sticky('s', 0, 0)] })
    h.editor.ui.select(['s'])
    h.editor.actions.startNoteEdit('s')
    h.editor.ui.setNoteDraft('Saved first')
    h.editor.view.setLayer('notes', { visible: false })
    // Typing was saved, and the hidden note left the selection.
    expect(h.note('s').text).toBe('Saved first')
    expect(h.ui().noteEdit).toBeNull()
    expect(h.ui().selection).toEqual([])
    // A click lands on the table under the note.
    h.click(10, 10)
    expect(h.ui().selection).toEqual(['t'])
    h.key('a', { metaKey: true })
    expect(h.ui().selection).toEqual(['t'])
    h.drag([
      [-400, -400],
      [400, 400],
    ])
    expect(h.ui().selection).toEqual(['t'])
    expect(h.editor.actions.addNote('sticky')).toBeNull()
    expect(h.editor.actions.setNoteText('s', 'x')).toBe(false)
    h.editor.actions.setNoteTool('box')
    h.click(500, 500)
    expect(h.canvas().items).toHaveLength(2)
    expect(h.refusals).toEqual(['notesHidden', 'notesHidden', 'notesHidden'])
  })

  it('when locked: a click goes through notes, the Notes tab still selects one to read, and nothing changes', () => {
    const h = harness({ items: [sticky('s', 0, 0), arrowNote('n', { x: 300, y: 300 }, { x: 600, y: 300 }), round('t', 0, 800)] })
    h.editor.view.setLayer('notes', { locked: true })
    const before = h.canvas()
    h.click(10, 10)
    expect(h.ui().selection).toEqual([])
    h.click(450, 300)
    expect(h.ui().selection).toEqual([])
    // A drag on it draws a selection box instead of moving it.
    h.drag(
      [
        [10, 10],
        [200, 200],
      ],
      { alt: true },
    )
    expect(h.note('s')).toBe(before.items[0])
    expect(h.ui().selection).toEqual([])
    // View mode changes nothing, so a tap there still reads the note.
    h.editor.ui.setState({ mode: 'view' })
    h.click(10, 10)
    expect(h.ui().selection).toEqual(['s'])
    h.editor.ui.setState({ mode: 'edit' })
    h.editor.ui.clearSelection()
    expect(h.editor.actions.focusNote('s')).toBe(true)
    expect(h.ui().selection).toEqual(['s'])
    expect(h.key('Delete')).toBe(true)
    expect(h.key('ArrowRight')).toBe(true)
    expect(h.key('d', { metaKey: true })).toBe(true)
    expect(h.key('Enter')).toBe(true)
    expect(h.ui().noteEdit).toBeNull()
    expect(h.editor.actions.setNoteColor('grey')).toBe(false)
    expect(h.editor.actions.setNoteText('s', 'x')).toBe(false)
    expect(h.editor.actions.toggleNoteDone('s')).toBe(false)
    expect(h.editor.actions.setItemBox('s', { x: 50 })).toBe(false)
    expect(h.editor.actions.setLocked(true)).toBe(false)
    expect(h.editor.actions.addNote('sticky')).toBeNull()
    expect(h.editor.actions.setNoteTool('sticky')).toBe(false)
    expect(h.ui().tool.kind).toBe('select')
    // The arrow's end handle does nothing either.
    h.editor.ui.select(['n'])
    h.drag(
      [
        [600, 300],
        [0, 800],
      ],
      { target: { kind: 'vertex', itemId: 'n', index: 1 } },
    )
    expect(h.canvas()).toBe(before)
    expect(h.commits).toHaveLength(0)
    expect(h.refusals.every((r) => r === 'notesLocked')).toBe(true)
    expect(h.refusals.length).toBeGreaterThanOrEqual(9)
  })

  it('when locked: a press goes through a note to the ceremony chair or seated guest under it', () => {
    const G = '00000000-0000-4000-8000-000000000001'
    const row: ChairRow = {
      id: 'r',
      kind: 'chairRow',
      x: 400,
      y: 400,
      rotation: 0,
      locked: false,
      chairCount: 3,
      spacing: 50.8,
      blockId: null,
      blockLabel: null,
      rowNumber: 1,
      rowLabel: '',
      reservedFor: null,
      seats: Array.from({ length: 3 }, (_, index) => ({ index, guestId: index === 2 ? G : null })),
    }
    const t = round('t', 400, 900)
    const table: Table = { ...t, seats: t.seats.map((seat, i) => (i === 0 ? { ...seat, guestId: G } : seat)) }
    const chair = chairRowSeatCenters(row)[0]
    const seat = seatLayout(table)[0]
    const h = harness({ items: [sticky('nc', chair.x, chair.y), sticky('ns', seat.x, seat.y), row, table] })
    // Open: the note on top takes the click.
    h.click(chair.x, chair.y)
    expect(h.ui().selection).toEqual(['nc'])
    h.editor.ui.clearSelection()
    h.editor.view.setLayer('notes', { locked: true })
    // Locked: the first click on a chair picks its row, as with no note there.
    h.click(chair.x, chair.y)
    expect(h.ui().selection).toEqual(['r'])
    // And the seated guest under the other note is picked, then dragged off by the seating controller.
    h.click(seat.x, seat.y)
    expect(h.ui().guestSeats).toEqual([{ itemId: 't', seatIndex: 0 }])
    const press = h.down(seat.x, seat.y)
    press.move(seat.x + 40, seat.y + 40)
    expect(h.editor.seating.store.getState().drag).not.toBeNull()
    press.up(seat.x + 40, seat.y + 40)
    expect(h.refusals).toEqual([])
  })

  it('when locked: a selection with furniture still changes the furniture', () => {
    const h = harness({ items: [sticky('s', 0, 0), round('t', 600, 0)] })
    h.editor.view.setLayer('notes', { locked: true })
    h.editor.ui.select(['s', 't'])
    expect(h.editor.actions.nudge('right')).toBe(true)
    expect(h.item('t').x).toBe(600 + FT)
    expect(h.item('s').x).toBe(0)
    expect(h.editor.actions.deleteSelection()).toBe(true)
    expect(h.canvas().items.map((i) => i.id)).toEqual(['s'])
  })

  it('leaves notes out of a paste while locked', () => {
    const h = harness({ items: [sticky('s', 0, 0), round('t', 600, 0)] })
    h.editor.ui.select(['s', 't'])
    h.editor.actions.copySelection()
    h.editor.view.setLayer('notes', { locked: true })
    expect(h.editor.actions.paste()).toBe(true)
    expect(h.canvas().items.filter((i) => i.kind === 'note')).toHaveLength(1)
    expect(h.canvas().items.filter((i) => i.kind === 'table')).toHaveLength(2)
    h.editor.ui.select(['s'])
    h.editor.view.setLayer('notes', { locked: false })
    h.editor.actions.copySelection()
    h.editor.view.setLayer('notes', { locked: true })
    expect(h.editor.actions.paste()).toBe(false)
    expect(h.refusals).toEqual(['notesLocked'])
  })
})
