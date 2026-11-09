import { describe, expect, it, vi } from 'vitest'
import { emptyCanvas, type Canvas, type Item, type Table } from '@/domain/canvas-schema'
import { itemBox } from '@/domain/geometry'
import { makeItem } from '@/domain/presets'
import type { FixedItem } from '@/domain/venue-schema'
import { createClipboard, type ClipboardData } from '../clipboard'
import { clearDroppedSeats, createDocStore } from '../doc-store'
import type { CameraTargets, FrameScheduler } from '../camera/camera-controller'
import { createEditorState, type EditorEvents } from '../state'
import type { StorageLike } from '../state/device-view'
import type { KeyLike } from './keyboard'
import type { PointerKind } from './pointer-machine'

const FT = 30.48

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

type HarnessOptions = {
  items?: Item[]
  mode?: 'edit' | 'view'
  events?: EditorEvents
  clipboardMemory?: { data: ClipboardData | null; pastes: Map<string, number> }
  layoutId?: string
  venue?: FixedItem[]
}

function harness(options: HarnessOptions = {}) {
  const store = createDocStore({ ...emptyCanvas(), items: options.items ?? [] })
  const commits: Canvas[] = []
  let time = 0
  const timers: { at: number; cb: () => void }[] = []
  let n = 0
  const editor = createEditorState({
    layoutId: options.layoutId ?? 'L1',
    store,
    onCommit: (c) => commits.push(c),
    settings: () => ({ unit: 'ft', minGapCm: 152.4 }),
    storage: memoryStorage(),
    newId: () => `new${++n}`,
    scheduler: manualScheduler(),
    traits: () => ({ width: 1440, touchOnly: false, phone: false }),
    clipboard: createClipboard({ memory: options.clipboardMemory ?? { data: null, pastes: new Map() }, now: () => time }),
    venueItems: options.venue ? () => options.venue! : undefined,
    events: options.events,
    now: () => time,
    setTimer: (cb, ms) => void timers.push({ at: time + ms, cb }),
  })
  editor.loadDevice()
  editor.camera.attach(fakeTargets())
  // Screen px equal world cm.
  editor.camera.set({ zoom: 1, x: 0, y: 0 }, { immediate: true })
  if (options.mode) editor.ui.setState({ mode: options.mode })
  const c = editor.controller
  let pointerId = 1
  const mods = (o: { shift?: boolean; alt?: boolean }) => ({ shift: o.shift ?? false, alt: o.alt ?? false })

  return {
    editor,
    store,
    commits,
    canvas: () => store.getState().canvas,
    item: (id: string) => store.getState().canvas.items.find((i) => i.id === id) as Item,
    table: (id: string) => store.getState().canvas.items.find((i) => i.id === id) as Table,
    setTime: (t: number) => {
      time = t
      const due = timers.filter((x) => x.at <= t)
      for (const timer of due) timers.splice(timers.indexOf(timer), 1)
      for (const timer of due) timer.cb()
    },
    /** A whole press: down at the first point, moves through the rest, up at the last. */
    drag(points: [number, number][], o: { shift?: boolean; alt?: boolean; pointer?: PointerKind; button?: number } = {}) {
      const id = pointerId++
      const [x0, y0] = points[0]
      c.pointer({ type: 'down', id, pointer: o.pointer ?? 'mouse', button: o.button ?? 0, at: { x: x0, y: y0 }, time, target: c.targetAt({ x: x0, y: y0 }), ...mods(o) })
      for (const [x, y] of points.slice(1)) c.pointer({ type: 'move', id, at: { x, y }, time, ...mods(o) })
      const [xl, yl] = points[points.length - 1]
      c.pointer({ type: 'up', id, at: { x: xl, y: yl }, time, ...mods(o) })
    },
    down(x: number, y: number, o: { shift?: boolean; alt?: boolean; pointer?: PointerKind; target?: ReturnType<typeof c.targetAt> } = {}) {
      const id = pointerId++
      c.pointer({ type: 'down', id, pointer: o.pointer ?? 'mouse', button: 0, at: { x, y }, time, target: o.target ?? c.targetAt({ x, y }), ...mods(o) })
      return {
        move: (mx: number, my: number, m: { shift?: boolean; alt?: boolean } = {}) => c.pointer({ type: 'move', id, at: { x: mx, y: my }, time, ...mods(m) }),
        up: (ux: number, uy: number, m: { shift?: boolean; alt?: boolean } = {}) => c.pointer({ type: 'up', id, at: { x: ux, y: uy }, time, ...mods(m) }),
      }
    },
    key(key: string, o: Partial<KeyLike> = {}) {
      return c.keyDown({ key, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...o })
    },
  }
}

const round = (id: string, x = 0, y = 0, canvas: Canvas = emptyCanvas()) => makeItem('round', { x, y }, id, canvas) as Table

function onGrid(v: number): boolean {
  const k = v / FT
  return Math.abs(k - Math.round(k)) < 1e-6
}

describe('moving', () => {
  it('drags a table as one undo step, saved once, with an edge or center of its top on the grid', () => {
    const h = harness({ items: [round('a')] })
    h.drag([
      [0, 0],
      [50, 3],
      [100, 7],
    ])
    // The table top, not the chair ring: a 60 in round lands with its center on a line.
    const box = itemBox(h.item('a'))
    expect([box.minX, (box.minX + box.maxX) / 2, box.maxX].some(onGrid)).toBe(true)
    expect([box.minY, (box.minY + box.maxY) / 2, box.maxY].some(onGrid)).toBe(true)
    expect(Math.abs(h.item('a').x - 100)).toBeLessThanOrEqual(FT / 2)
    expect(h.commits).toHaveLength(1)
    expect(h.store.getState().history.past).toHaveLength(1)
    expect(h.key('z', { metaKey: true })).toBe(true)
    expect(h.item('a').x).toBe(0)
  })

  it('places freely with Alt held', () => {
    const h = harness({ items: [round('a')] })
    h.drag(
      [
        [0, 0],
        [100, 7],
      ],
      { alt: true },
    )
    expect(h.item('a')).toMatchObject({ x: 100, y: 7 })
  })

  it('snaps to another table edge with a guide', () => {
    const h = harness({ items: [round('a'), round('b', 600, 300)] })
    h.editor.ui.setSnap(true)
    const p = h.down(0, 0)
    p.move(10, 0)
    // b's top footprint edge is at 300 - 129.2; a's top edge would be 3 cm from it.
    p.move(10, 300 - 129.2 + 129.2 + 3)
    expect(h.editor.interaction.getState().guides.length).toBeGreaterThan(0)
    expect(h.item('a').y).toBeCloseTo(300, 6)
    p.up(10, 303)
    expect(h.editor.interaction.getState().guides).toHaveLength(0)
  })

  it('leaves locked items where they are', () => {
    const h = harness({ items: [{ ...round('a'), locked: true }, round('b', 500)] })
    h.editor.ui.select(['a', 'b'])
    h.drag(
      [
        [500, 0],
        [600, 0],
      ],
      { alt: true },
    )
    expect(h.item('a').x).toBe(0)
    expect(h.item('b').x).toBe(600)
  })

  it('cancels a drag on Esc, with nothing to undo, then Esc clears the selection', () => {
    const h = harness({ items: [round('a')] })
    const p = h.down(0, 0)
    p.move(80, 0, { alt: true })
    expect(h.item('a').x).toBe(80)
    expect(h.key('Escape')).toBe(true)
    expect(h.item('a').x).toBe(0)
    p.up(80, 0)
    expect(h.store.getState().canUndo).toBe(false)
    expect(h.commits).toHaveLength(0)
    expect(h.editor.ui.getState().selection).toEqual(['a'])
    h.key('Escape')
    expect(h.editor.ui.getState().selection).toEqual([])
  })

  it('shows the gap to the nearest table and warns under the minimum, and the move still happens (acceptance 26)', () => {
    const h = harness({ items: [round('a'), round('b', 290)] })
    const p = h.down(0, 0, { alt: true })
    p.move(0, 10, { alt: true })
    const gap = h.editor.interaction.getState().gap!
    expect(gap.otherId).toBe('b')
    // Table edges, chairs not counted: centers about 290 apart, less 76.2 on each side.
    expect(gap.gapCm).toBeCloseTo(Math.hypot(290, 10) - 152.4, 6)
    expect(gap.warn).toBe(true)
    expect(gap.text).toBe('4′ 6″')
    p.move(-200, 10, { alt: true })
    expect(h.editor.interaction.getState().gap?.warn).toBe(false)
    p.up(-200, 10, { alt: true })
    expect(h.editor.interaction.getState().gap).toBeNull()
    expect(h.item('a').x).toBe(-200)
  })
})

describe('clicks, Shift and selection boxes', () => {
  it('selects on a click that moves 4 px or less, changing nothing', () => {
    const h = harness({ items: [round('a')] })
    h.drag([
      [0, 0],
      [3, 2],
    ])
    expect(h.editor.ui.getState().selection).toEqual(['a'])
    expect(h.commits).toHaveLength(0)
  })

  it('resizes a round table about its center on Shift+drag, and Shift+click still toggles (acceptance 11)', () => {
    const h = harness({ items: [round('a'), round('b', 500)] })
    h.drag(
      [
        [50, 0],
        [60, 0],
        [100, 0],
      ],
      { shift: true },
    )
    expect(h.table('a')).toMatchObject({ x: 0, y: 0 })
    // Pressed 50 cm out and let go 100 cm out: the edge followed, 100 cm wider.
    expect(h.table('a').width).toBeCloseTo(252.4, 6)
    expect(h.table('a').height).toBeCloseTo(252.4, 6)
    expect(h.commits).toHaveLength(1)
    h.drag(
      [
        [500, 0],
        [502, 1],
      ],
      { shift: true },
    )
    expect(h.editor.ui.getState().selection).toEqual(['a', 'b'])
    h.drag([[500, 0]], { shift: true })
    expect(h.editor.ui.getState().selection).toEqual(['a'])
  })

  it('draws a selection box on empty canvas, adding with Shift', () => {
    const h = harness({ items: [round('a'), round('b', 1000)] })
    h.drag([
      [-300, -300],
      [300, 300],
    ])
    expect(h.editor.ui.getState().selection).toEqual(['a'])
    expect(h.editor.interaction.getState().marquee).toBeNull()
    h.drag(
      [
        [700, -300],
        [1300, 300],
      ],
      { shift: true },
    )
    expect(h.editor.ui.getState().selection).toEqual(['a', 'b'])
  })

  it('selects every reachable item with Cmd+A, leaving out hidden layers', () => {
    const note = { ...(makeItem('box', { x: 0, y: 0 }, 'n', emptyCanvas()) as Item) }
    const h = harness({ items: [round('a'), note] })
    expect(h.key('a', { ctrlKey: true })).toBe(true)
    expect(h.editor.ui.getState().selection).toEqual(['a', 'n'])
  })
})

describe('handles', () => {
  it('stretches a rectangle from its end handle, and keeps proportions with the switch', () => {
    const rect = makeItem('rect', { x: 0, y: 0 }, 'r', emptyCanvas()) as Table
    const h = harness({ items: [rect] })
    h.editor.ui.select(['r'])
    const east = { kind: 'handle' as const, itemId: 'r', handle: 'e' as const }
    let p = h.down(121.92, 0, { target: east, alt: true })
    p.move(200, 0, { alt: true })
    p.up(250, 0, { alt: true })
    expect(h.table('r').width).toBeCloseTo(250 + 121.92, 6)
    expect(h.table('r').height).toBeCloseTo(76.2, 6)
    h.editor.ui.setKeepProportions(true)
    const w0 = h.table('r').width
    p = h.down(250, 0, { target: east, alt: true })
    p.move(300, 0, { alt: true })
    p.up(300, 0, { alt: true })
    const scale = h.table('r').width / w0
    expect(h.table('r').height).toBeCloseTo(76.2 * scale, 6)
  })

  it('turns in 15 degree steps, freely with Alt', () => {
    const rect = makeItem('rect', { x: 0, y: 0 }, 'r', emptyCanvas()) as Table
    const h = harness({ items: [rect] })
    h.editor.ui.select(['r'])
    const rotate = { kind: 'rotate' as const, itemId: 'r' }
    let p = h.down(0, -80, { target: rotate })
    p.move(100, -6)
    p.up(100, -6)
    expect(h.item('r').rotation).toBe(90)
    p = h.down(100, 0, { target: rotate, alt: true })
    p.move(100, 6, { alt: true })
    p.up(100, 6, { alt: true })
    expect(h.item('r').rotation).toBeGreaterThan(90)
    expect(h.item('r').rotation).toBeLessThan(95)
  })
})

describe('keyboard', () => {
  it('makes a burst of nudges one undo step', () => {
    const h = harness({ items: [round('a')] })
    h.editor.ui.select(['a'])
    for (const t of [0, 100, 200]) {
      h.setTime(t)
      expect(h.key('ArrowRight')).toBe(true)
    }
    expect(h.item('a').x).toBeCloseTo(3 * FT, 6)
    expect(h.store.getState().history.past).toHaveLength(1)
    h.setTime(2000)
    h.key('ArrowDown', { shiftKey: true })
    expect(h.item('a').y).toBeCloseTo(5 * FT, 6)
    expect(h.store.getState().history.past).toHaveLength(2)
    h.key('z', { ctrlKey: true })
    h.key('z', { ctrlKey: true })
    expect(h.item('a')).toMatchObject({ x: 0, y: 0 })
    h.key('y', { ctrlKey: true })
    expect(h.item('a').x).toBeCloseTo(3 * FT, 6)
  })

  it('deletes with Delete or Backspace and leaves keys alone with nothing selected', () => {
    const h = harness({ items: [round('a'), round('b', 500)] })
    expect(h.key('Delete')).toBe(false)
    h.editor.ui.select(['a'])
    expect(h.key('Backspace')).toBe(true)
    expect(h.canvas().items.map((i) => i.id)).toEqual(['b'])
    expect(h.editor.ui.getState().selection).toEqual([])
  })

  it('duplicates with Cmd+D: next number, one grid step away, selected (PLAN change 3)', () => {
    const h = harness({ items: [round('a')] })
    h.editor.ui.select(['a'])
    expect(h.key('d', { metaKey: true })).toBe(true)
    expect(h.editor.ui.getState().selection).toEqual(['new1'])
    expect(h.table('new1')).toMatchObject({ x: FT, y: FT, number: 2, name: 'Table 2' })
  })

  it('copies and pastes a step further each time, and into another layout at its center', () => {
    const memory = { data: null as ClipboardData | null, pastes: new Map<string, number>() }
    const h = harness({ items: [round('a')], clipboardMemory: memory })
    h.editor.ui.select(['a'])
    expect(h.key('v', { metaKey: true })).toBe(false)
    expect(h.key('c', { metaKey: true })).toBe(true)
    h.key('v', { metaKey: true })
    h.key('v', { metaKey: true })
    expect(h.table('new1')).toMatchObject({ x: FT, y: FT, number: 2 })
    expect(h.table('new2')).toMatchObject({ x: 2 * FT, y: 2 * FT, number: 3 })

    const other = harness({ items: [], clipboardMemory: memory, layoutId: 'L2' })
    expect(other.key('v', { metaKey: true })).toBe(true)
    const pasted = other.canvas().items[0] as Table
    expect(pasted.number).toBe(1)
    // The viewport's center is (500, 400), on a 1 ft grid from the copy's center (0, 0).
    expect(pasted.x).toBeCloseTo(Math.round(500 / FT) * FT, 6)
    expect(pasted.y).toBeCloseTo(Math.round(400 / FT) * FT, 6)
  })

  it('zooms with Cmd + = - 0 1', () => {
    const h = harness({ items: [round('a')] })
    h.key('=', { metaKey: true })
    expect(h.editor.camera.get().zoom).toBe(1.5)
    h.key('-', { metaKey: true })
    h.key('-', { metaKey: true })
    expect(h.editor.camera.get().zoom).toBe(0.75)
    h.key('0', { metaKey: true })
    expect(h.editor.camera.get().zoom).toBe(1)
    h.key('1', { metaKey: true })
    expect(h.editor.camera.worldToScreen({ x: 0, y: 0 })).toEqual({ x: 500, y: 400 })
  })

  it('pans with Space held', () => {
    const h = harness({ items: [round('a')] })
    expect(h.key(' ', { code: 'Space' })).toBe(true)
    h.drag([
      [0, 0],
      [40, 30],
    ])
    expect(h.editor.camera.get()).toMatchObject({ x: 40, y: 30 })
    expect(h.item('a').x).toBe(0)
    h.editor.controller.keyUp({ key: ' ', code: 'Space', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false })
    expect(h.editor.interaction.getState().spacePan).toBe(false)
  })
})

describe('View mode', () => {
  it('pans on a drag and refuses every change', () => {
    const onRefused = vi.fn()
    const h = harness({ items: [round('a')], mode: 'view', events: { onRefused } })
    h.drag([
      [0, 0],
      [60, 0],
    ])
    expect(h.item('a').x).toBe(0)
    expect(h.editor.camera.get().x).toBe(60)
    h.editor.ui.select(['a'])
    expect(h.key('Delete')).toBe(true)
    h.key('ArrowLeft')
    h.key('d', { metaKey: true })
    expect(h.editor.actions.addSeat('a')).toEqual({ status: 'refused' })
    expect(h.editor.actions.addPreset('round')).toBeNull()
    expect(h.canvas().items).toHaveLength(1)
    expect(h.commits).toHaveLength(0)
    expect(onRefused).toHaveBeenCalled()
  })

  it('cancels a drag when the mode switches to View', () => {
    const h = harness({ items: [round('a')] })
    const p = h.down(0, 0, { alt: true })
    p.move(50, 0, { alt: true })
    h.editor.actions.setMode('view')
    expect(h.item('a').x).toBe(0)
    p.move(80, 0, { alt: true })
    p.up(80, 0, { alt: true })
    expect(h.item('a').x).toBe(0)
    expect(h.commits).toHaveLength(0)
  })
})

describe('seats from the editor', () => {
  it('asks before − unseats a guest, then does it on confirm', () => {
    const t = round('a')
    const full = { ...t, seats: t.seats.map((s, i) => ({ ...s, guestId: `00000000-0000-4000-8000-00000000000${i}` })) }
    const h = harness({ items: [full] })
    const r = h.editor.actions.removeSeat('a')
    expect(r.status).toBe('confirm')
    if (r.status !== 'confirm') return
    expect(r.unseated).toEqual(['00000000-0000-4000-8000-000000000007'])
    expect(h.table('a').seatCount).toBe(8)
    expect(r.confirm()).toBe(true)
    expect(h.table('a').seatCount).toBe(7)
    expect(h.editor.actions.addSeat('a')).toEqual({ status: 'done' })
    expect(h.table('a').seatCount).toBe(8)
  })
})

describe('touch', () => {
  it('opens the menu after a 450 ms hold and lift', () => {
    const onContextMenu = vi.fn()
    const h = harness({ items: [round('a')], events: { onContextMenu } })
    const p = h.down(0, 0, { pointer: 'touch' })
    h.setTime(449)
    expect(h.editor.interaction.getState().longPress).toBeNull()
    h.setTime(450)
    expect(h.editor.interaction.getState().longPress).toEqual({ x: 0, y: 0 })
    p.up(0, 0)
    expect(onContextMenu).toHaveBeenCalledWith({ at: { x: 0, y: 0 }, target: expect.objectContaining({ itemId: 'a' }), pointer: 'touch' })
    expect(h.editor.ui.getState().selection).toEqual(['a'])
    expect(h.editor.interaction.getState().longPress).toBeNull()
  })

  it('pans with one finger and zooms with two', () => {
    const h = harness({ items: [round('a')] })
    h.drag(
      [
        [0, 0],
        [30, 0],
      ],
      { pointer: 'touch' },
    )
    expect(h.editor.camera.get().x).toBe(30)
    expect(h.item('a').x).toBe(0)
    const c = h.editor.controller
    c.pointer({ type: 'down', id: 90, pointer: 'touch', button: 0, at: { x: 100, y: 100 }, time: 0, target: { kind: 'empty' }, shift: false, alt: false })
    c.pointer({ type: 'down', id: 91, pointer: 'touch', button: 0, at: { x: 300, y: 100 }, time: 0, target: { kind: 'empty' }, shift: false, alt: false })
    c.pointer({ type: 'move', id: 91, at: { x: 500, y: 100 }, time: 0, shift: false, alt: false })
    expect(h.editor.camera.get().zoom).toBeCloseTo(2, 9)
  })
})

describe('the wheel (PLAN change 11)', () => {
  it('zooms toward the pointer for a mouse wheel and pans for a trackpad', () => {
    const h = harness()
    const c = h.editor.controller
    c.wheel({ deltaX: 0, deltaY: -100, deltaMode: 0, ctrlKey: false, wheelDeltaY: 120, timeStamp: 0, at: { x: 200, y: 100 } })
    const cam = h.editor.camera.get()
    expect(cam.zoom).toBeGreaterThan(1)
    expect((200 - cam.x) / cam.zoom).toBeCloseTo(200, 9)
    c.wheel({ deltaX: 2, deltaY: 3.5, deltaMode: 0, ctrlKey: false, timeStamp: 1000, at: { x: 200, y: 100 } })
    expect(h.editor.camera.get().zoom).toBe(cam.zoom)
    expect(h.editor.camera.get().x).toBeCloseTo(cam.x - 2, 9)
  })

  it('pans every wheel event with the setting on pan, but a pinch still zooms', () => {
    const h = harness()
    h.editor.view.setWheel('pan')
    const c = h.editor.controller
    c.wheel({ deltaX: 0, deltaY: -100, deltaMode: 0, ctrlKey: false, wheelDeltaY: 120, timeStamp: 0, at: { x: 0, y: 0 } })
    expect(h.editor.camera.get()).toMatchObject({ zoom: 1, y: 100 })
    c.wheel({ deltaX: 0, deltaY: -10, deltaMode: 0, ctrlKey: true, timeStamp: 1000, at: { x: 0, y: 0 } })
    expect(h.editor.camera.get().zoom).toBeGreaterThan(1)
  })
})

describe('the place tool', () => {
  it('adds the preset where you click, on the grid, then goes back to select', () => {
    const h = harness()
    h.editor.ui.setTool({ kind: 'place', presetId: 'round' })
    h.drag([[100, 100]])
    const t = h.canvas().items[0] as Table
    expect(t).toMatchObject({ kind: 'table', x: 3 * FT, y: 3 * FT, number: 1 })
    expect(h.editor.ui.getState().tool.kind).toBe('select')
    expect(h.editor.ui.getState().selection).toEqual([t.id])
  })

  it('does not stack repeated adds at the viewport center', () => {
    const h = harness()
    const a = h.editor.actions.addPreset('round')!
    const b = h.editor.actions.addPreset('round')!
    expect(h.item(a).x).not.toBe(h.item(b).x)
  })
})

const GUEST = '66666666-6666-4666-8666-666666666666'

/** A 60 in round with GUEST in seat 0. */
function seatedRound(id: string, x = 0, y = 0): Table {
  const t = round(id, x, y)
  return { ...t, seats: t.seats.map((seat, i) => (i === 0 ? { ...seat, guestId: GUEST } : seat)) }
}

describe('the space check while dragging (A1)', () => {
  it('reads two 60 in rounds 5 ft apart edge to edge as 5′ 0″, with no warning', () => {
    const h = harness({ items: [round('a'), round('b', 609.6)] })
    const p = h.down(0, 0)
    // Snapping puts a's center on the 10 ft line: 304.8 cm between centers.
    p.move(300, 0)
    expect(h.item('a').x).toBeCloseTo(304.8, 6)
    const gap = h.editor.interaction.getState().gap!
    expect(gap.gapCm).toBeCloseTo(152.4, 6)
    expect(gap.text).toBe('5′ 0″')
    expect(gap.warn).toBe(false)
    p.up(300, 0)
  })
})

describe('the right-click menu (A2)', () => {
  function setup() {
    const onContextMenu = vi.fn()
    const onTap = vi.fn()
    const h = harness({ items: [round('a'), round('b', 500)], events: { onContextMenu, onTap } })
    const c = h.editor.controller
    const at = (x: number, y: number) => ({ x, y })
    const press = (id: number, x: number, y: number, button: number) =>
      c.pointer({ type: 'down', id, pointer: 'mouse', button, at: at(x, y), time: 0, target: c.targetAt(at(x, y)), shift: false, alt: false })
    const release = (id: number, x: number, y: number) => c.pointer({ type: 'up', id, at: at(x, y), time: 0, shift: false, alt: false })
    const menu = (x: number, y: number) => c.contextMenu(at(x, y), c.targetAt(at(x, y)), 'mouse')
    return { h, c, onContextMenu, onTap, press, release, menu }
  }

  it('opens while the right button is still down (macOS, Linux), and the release is no click', () => {
    const { h, c, onContextMenu, onTap, press, release, menu } = setup()
    press(1, 500, 0, 2)
    menu(500, 0)
    release(1, 500, 0)
    expect(onContextMenu).toHaveBeenCalledTimes(1)
    expect(onContextMenu).toHaveBeenCalledWith({ at: { x: 500, y: 0 }, target: expect.objectContaining({ itemId: 'b' }), pointer: 'mouse' })
    expect(h.editor.ui.getState().selection).toEqual(['b'])
    expect(onTap).not.toHaveBeenCalled()
    expect(c.isBusy()).toBe(false)
    // The next click works as usual.
    h.drag([[0, 0]])
    expect(h.editor.ui.getState().selection).toEqual(['a'])
    expect(onTap).toHaveBeenCalledTimes(1)
  })

  it('opens on Ctrl+click on a Mac, and the left release does not click', () => {
    const { h, c, onContextMenu, onTap, press, release, menu } = setup()
    h.editor.ui.select(['a'])
    // On empty canvas: a click there would clear the selection.
    press(1, 250, 400, 0)
    menu(250, 400)
    release(1, 250, 400)
    expect(onContextMenu).toHaveBeenCalledTimes(1)
    expect(onContextMenu.mock.calls[0][0].target).toEqual({ kind: 'empty' })
    expect(h.editor.ui.getState().selection).toEqual(['a'])
    expect(onTap).not.toHaveBeenCalled()
    expect(c.isBusy()).toBe(false)
    // On a table: the menu selects it, and nothing moved.
    press(2, 500, 0, 0)
    menu(500, 0)
    c.pointer({ type: 'move', id: 2, at: { x: 560, y: 0 }, time: 0, shift: false, alt: false })
    release(2, 560, 0)
    expect(onContextMenu).toHaveBeenCalledTimes(2)
    expect(h.editor.ui.getState().selection).toEqual(['b'])
    expect(h.item('b').x).toBe(500)
    expect(h.commits).toHaveLength(0)
  })

  it('opens on Windows, where the menu comes after the release', () => {
    const { h, c, onContextMenu, onTap, press, release, menu } = setup()
    press(1, 500, 0, 2)
    release(1, 500, 0)
    menu(500, 0)
    expect(onContextMenu).toHaveBeenCalledTimes(1)
    expect(h.editor.ui.getState().selection).toEqual(['b'])
    expect(onTap).not.toHaveBeenCalled()
    expect(c.isBusy()).toBe(false)
  })

  it('does not open over a drag under way', () => {
    const { h, c, onContextMenu, press, release, menu } = setup()
    press(1, 0, 0, 0)
    c.pointer({ type: 'move', id: 1, at: { x: 60, y: 0 }, time: 0, shift: false, alt: true })
    menu(60, 0)
    expect(onContextMenu).not.toHaveBeenCalled()
    release(1, 60, 0)
    expect(h.commits).toHaveLength(1)
  })
})

describe('handles on the grid (A4)', () => {
  it('reaches 36, 48 and 72 in with a snapped corner drag of a 60 in round', () => {
    for (const inches of [36, 48, 72]) {
      const h = harness({ items: [round('a')] })
      h.editor.ui.select(['a'])
      const se = { kind: 'handle' as const, itemId: 'a', handle: 'se' as const }
      const want = inches * 2.54
      // Grabbed a little off the handle's center; the far corner is at (-76.2, -76.2).
      const p = h.down(76.2 + 3, 76.2 - 2, { target: se })
      p.move(-76.2 + want + 3 + 5, -76.2 + want - 2 - 4)
      p.up(-76.2 + want + 3 + 5, -76.2 + want - 2 - 4)
      expect(h.table('a').width, `${inches} in`).toBeCloseTo(want, 6)
      expect(h.table('a').x - h.table('a').width / 2).toBeCloseTo(-76.2, 6)
    }
  })

  it('keeps the grab offset, so a press off the handle center does not jump (C6)', () => {
    const rect = makeItem('rect', { x: 0, y: 0 }, 'r', emptyCanvas()) as Table
    const h = harness({ items: [rect] })
    h.editor.ui.select(['r'])
    const east = { kind: 'handle' as const, itemId: 'r', handle: 'e' as const }
    // 15 cm right of the end handle, then 6 cm further, freely.
    let p = h.down(121.92 + 15, 10, { target: east, alt: true })
    p.move(121.92 + 21, 10, { alt: true })
    p.up(121.92 + 21, 10, { alt: true })
    expect(h.table('r').width).toBeCloseTo(243.84 + 6, 6)
    // Snapped, a small move off the center keeps the size on the grid it had.
    h.key('z', { metaKey: true })
    p = h.down(121.92 + 15, 10, { target: east })
    p.move(121.92 + 21, 10)
    p.up(121.92 + 21, 10)
    expect(h.table('r').width).toBeCloseTo(243.84, 6)
  })
})

describe('adding from the shape panel (A5)', () => {
  it('drops a preset on the grid, or exactly where it lands with { free: true } (Alt)', () => {
    const h = harness()
    const a = h.editor.actions.dropPreset('round', 100, 100)!
    expect(h.item(a)).toMatchObject({ x: 3 * FT, y: 3 * FT })
    const b = h.editor.actions.dropPreset('round', 412, 230, { free: true })!
    expect(h.item(b)).toMatchObject({ x: 412, y: 230 })
    const c = h.editor.actions.addPreset('square', { x: 17, y: 33 }, { free: true })!
    expect(h.item(c)).toMatchObject({ x: 17, y: 33 })
    const d = h.editor.actions.addPreset('square', { x: 17, y: 33 })!
    expect(h.item(d)).toMatchObject({ x: FT, y: FT })
  })
})

describe('server seat patches during a drag (A6)', () => {
  const dropped = [{ itemId: 'a', seatIndex: 0, guestId: GUEST, reason: 'removed-guest' as const }]

  it('keeps a move going: one undo step and one save, with the seat emptied', () => {
    const h = harness({ items: [seatedRound('a')] })
    const p = h.down(0, 0, { alt: true })
    p.move(50, 0, { alt: true })
    h.store.patchFromServer((c) => clearDroppedSeats(c, dropped))
    expect(h.table('a')).toMatchObject({ x: 50 })
    expect(h.table('a').seats[0].guestId).toBeNull()
    expect(h.editor.controller.isBusy()).toBe(true)
    p.move(80, 0, { alt: true })
    p.up(80, 0, { alt: true })
    expect(h.table('a').x).toBe(80)
    expect(h.commits).toHaveLength(1)
    expect((h.commits[0].items[0] as Table).seats[0].guestId).toBeNull()
    expect(h.store.getState().history.past).toHaveLength(1)
    h.key('z', { metaKey: true })
    expect(h.table('a').x).toBe(0)
    expect(h.table('a').seats[0].guestId).toBeNull()
  })

  it('keeps a resize going without bringing the guest back', () => {
    const h = harness({ items: [seatedRound('a')] })
    h.editor.ui.select(['a'])
    const se = { kind: 'handle' as const, itemId: 'a', handle: 'se' as const }
    const p = h.down(76.2, 76.2, { target: se, alt: true })
    p.move(100, 100, { alt: true })
    h.store.patchFromServer((c) => clearDroppedSeats(c, dropped))
    p.move(120, 120, { alt: true })
    p.up(120, 120, { alt: true })
    expect(h.table('a').width).toBeCloseTo(196.2, 6)
    expect(h.table('a').seats.every((s) => s.guestId === null)).toBe(true)
    expect(h.commits).toHaveLength(1)
  })
})

describe('Esc during a selection box (A9)', () => {
  it('puts back the selection from before the box, guests included', () => {
    const h = harness({ items: [seatedRound('a'), round('b', 1000)] })
    h.editor.ui.selectSeat({ itemId: 'a', seatIndex: 0 })
    let p = h.down(-400, -400)
    p.move(-300, -300)
    p.move(300, 300)
    expect(h.editor.ui.getState().selection).toEqual(['a'])
    expect(h.key('Escape')).toBe(true)
    expect(h.editor.ui.getState().guestSeats).toEqual([{ itemId: 'a', seatIndex: 0 }])
    expect(h.editor.ui.getState().selection).toEqual([])
    expect(h.editor.interaction.getState().marquee).toBeNull()
    p.up(300, 300)
    expect(h.editor.ui.getState().guestSeats).toEqual([{ itemId: 'a', seatIndex: 0 }])

    h.editor.ui.select(['b'])
    p = h.down(-400, -400)
    p.move(300, 300)
    h.key('Escape')
    p.up(300, 300)
    expect(h.editor.ui.getState().selection).toEqual(['b'])
  })
})

describe('fit to content with a venue (A10)', () => {
  const wall: FixedItem = { id: 'w', type: 'wall', points: [{ x: -2000, y: 0 }, { x: 3000, y: 0 }], thickness: 20, unsure: false, unsureNote: '' }

  it('takes in the venue while its layer shows', () => {
    const h = harness({ items: [round('a')], venue: [wall] })
    h.editor.actions.zoomFit()
    const left = h.editor.camera.worldToScreen({ x: -2000, y: 0 })
    const right = h.editor.camera.worldToScreen({ x: 3000, y: 0 })
    expect(left.x).toBeGreaterThanOrEqual(0)
    expect(right.x).toBeLessThanOrEqual(1000)
    h.editor.view.setLayer('venue', { visible: false })
    h.editor.actions.zoomFit()
    expect(h.editor.camera.worldToScreen({ x: 3000, y: 0 }).x).toBeGreaterThan(1000)
  })

  it('takes in the venue on the first fit when mounted', () => {
    vi.stubGlobal('window', new EventTarget())
    vi.stubGlobal('document', { activeElement: null, querySelector: () => null })
    try {
      const store = createDocStore({ ...emptyCanvas(), items: [round('a')] })
      const editor = createEditorState({
        layoutId: 'L1',
        store,
        onCommit: () => undefined,
        settings: () => ({ unit: 'ft', minGapCm: 152.4 }),
        storage: memoryStorage(),
        scheduler: manualScheduler(),
        traits: () => ({ width: 1440, touchOnly: false, phone: false }),
        venueItems: () => [wall],
      })
      const t = fakeTargets()
      const viewport = Object.assign(new EventTarget(), t.viewport, {
        style: { ...t.viewport.style, touchAction: '', userSelect: '', overscrollBehavior: '', getPropertyValue: () => '' },
        hasAttribute: () => true,
        focus: () => undefined,
        contains: () => true,
      })
      const cleanup = editor.mount({ viewport: viewport as unknown as HTMLElement, wrapper: t.wrapper as unknown as HTMLElement, world: t.world as unknown as SVGGElement })
      expect(editor.camera.worldToScreen({ x: -2000, y: 0 }).x).toBeGreaterThanOrEqual(0)
      expect(editor.camera.worldToScreen({ x: 3000, y: 0 }).x).toBeLessThanOrEqual(1000)
      cleanup()
      editor.destroy()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('copy and paste at a point (A11)', () => {
  it('copies the selection and pastes it centered on a world point', () => {
    const memory = { data: null as ClipboardData | null, pastes: new Map<string, number>() }
    const head = makeItem('head', { x: 0, y: 0 }, 'h', emptyCanvas()) as Table
    const h = harness({ items: [head], clipboardMemory: memory })
    expect(h.editor.actions.copySelection()).toBe(false)
    h.editor.ui.select(['h'])
    expect(h.editor.actions.copySelection()).toBe(true)
    h.editor.ui.setSnap(false)
    expect(h.editor.actions.paste({ x: 412.3, y: -95.1 })).toBe(true)
    // The table top's center, not its one-sided chair ring's.
    const exact = h.table(h.editor.ui.getState().selection[0])
    expect(exact).toMatchObject({ x: 412.3, y: -95.1, number: 2 })
    h.editor.ui.setSnap(true)
    expect(h.editor.actions.paste({ x: 412.3, y: -95.1 })).toBe(true)
    const snapped = h.table(h.editor.ui.getState().selection[0])
    expect(snapped.x).toBeCloseTo(14 * FT, 6)
    expect(snapped.y).toBeCloseTo(-3 * FT, 6)
  })
})
