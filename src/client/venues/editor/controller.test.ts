import { describe, expect, it } from 'vitest'
import type { CameraTargets, FrameScheduler } from '@/client/editor/camera/camera-controller'
import { createDocStore } from '@/client/editor/doc-store'
import type { StorageLike } from '@/client/editor/state/device-view'
import type { KeyLike } from '@/client/editor/input/keyboard'
import type { PointerKind } from '@/client/editor/input/pointer-machine'
import type { Target } from '@/client/editor/input/hit-test'
import { makeAtPoint, type TemplateDoc } from '@/domain/template-commands'
import type { FixedItem } from '@/domain/venue-schema'
import { createTemplateEditor } from './state'

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

const flags = { unsure: false, unsureNote: '' }
const wall = (id: string, points: [number, number][]): FixedItem => ({ id, type: 'wall', points: points.map(([x, y]) => ({ x, y })), thickness: 20, ...flags })

function harness(items: FixedItem[] = [], mode: 'edit' | 'view' = 'edit') {
  const store = createDocStore<TemplateDoc>({ items, reference: null })
  const commits: TemplateDoc[] = []
  let time = 1000
  let n = 0
  const editor = createTemplateEditor({
    templateId: 'T1',
    store,
    onCommit: (d) => commits.push(d),
    unit: () => 'ft',
    storage: memoryStorage(),
    newId: () => `new${++n}`,
    scheduler: manualScheduler(),
    traits: () => ({ width: 1440, touchOnly: false, phone: false }),
    now: () => time,
    setTimer: () => undefined,
  })
  editor.loadDevice()
  editor.camera.attach(fakeTargets())
  editor.camera.set({ zoom: 1, x: 0, y: 0 }, { immediate: true })
  editor.ui.setState({ mode })
  const c = editor.controller
  let pointerId = 1

  function press(points: [number, number][], o: { shift?: boolean; pointer?: PointerKind; target?: Target } = {}) {
    const id = pointerId++
    const pointer = o.pointer ?? 'mouse'
    const [x0, y0] = points[0]
    const mods = { shift: o.shift ?? false, alt: false }
    c.pointer({ type: 'down', id, pointer, button: 0, at: { x: x0, y: y0 }, time, target: o.target ?? c.targetAt({ x: x0, y: y0 }), ...mods })
    for (const [x, y] of points.slice(1)) c.pointer({ type: 'move', id, at: { x, y }, time, ...mods })
    const [xe, ye] = points[points.length - 1]
    c.pointer({ type: 'up', id, at: { x: xe, y: ye }, time, ...mods })
  }

  const key = (k: string, o: Partial<KeyLike> = {}) => c.keyDown({ key: k, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...o })

  return {
    editor,
    store,
    commits,
    doc: () => store.getState().canvas,
    item: (id: string) => store.getState().canvas.items.find((i) => i.id === id) as FixedItem,
    click: (x: number, y: number, o: { shift?: boolean; pointer?: PointerKind } = {}) => press([[x, y]], o),
    drag: press,
    key,
    advance: (ms: number) => {
      time += ms
    },
  }
}

describe('template controller: drawing', () => {
  it('places wall points with clicks and finishes on a double-click', () => {
    const h = harness()
    h.editor.ui.setTool({ kind: 'draw', draw: 'wall' })
    h.click(0, 0)
    h.advance(600)
    h.click(10 * FT, 0)
    h.advance(600)
    h.click(10 * FT, 8 * FT)
    h.advance(100)
    h.click(10 * FT + 2, 8 * FT + 1)
    const doc = h.doc()
    expect(doc.items).toHaveLength(1)
    expect(doc.items[0]).toMatchObject({ type: 'wall', points: [{ x: 0, y: 0 }, { x: 10 * FT, y: 0 }, { x: 10 * FT, y: 8 * FT }] })
    expect(h.editor.ui.getState().tool.kind).toBe('select')
    expect(h.editor.ui.getState().selection).toEqual(['new1'])
    expect(h.commits).toHaveLength(1)
  })

  it('finishes with Enter, takes a point back with Backspace and cancels with Esc', () => {
    const h = harness()
    h.editor.ui.setTool({ kind: 'draw', draw: 'patioEdge' })
    h.click(0, 0)
    h.advance(600)
    h.click(100, 0)
    h.advance(600)
    h.click(200, 0)
    expect(h.key('Backspace')).toBe(true)
    expect(h.editor.ui.getState().drawing?.points).toHaveLength(2)
    expect(h.key('Enter')).toBe(true)
    expect(h.doc().items[0]).toMatchObject({ type: 'patioEdge' })
    expect((h.doc().items[0] as Extract<FixedItem, { type: 'patioEdge' }>).points).toHaveLength(2)

    h.editor.ui.setTool({ kind: 'draw', draw: 'wall' })
    h.advance(600)
    h.click(500, 500)
    expect(h.key('Escape')).toBe(true)
    expect(h.editor.ui.getState().drawing).toBeNull()
    expect(h.doc().items).toHaveLength(1)
  })

  it('starts a draw tool with nothing selected, so Delete takes back a point', () => {
    const h = harness([wall('a', [[0, 0], [100, 0]])])
    h.click(50, 0)
    expect(h.editor.ui.getState().selection).toEqual(['a'])
    h.editor.ui.setTool({ kind: 'draw', draw: 'wall' })
    expect(h.editor.ui.getState().selection).toEqual([])
    h.click(0, 300)
    h.advance(600)
    h.click(300, 300)
    expect(h.key('Delete')).toBe(true)
    expect(h.editor.ui.getState().drawing?.points).toHaveLength(1)
    expect(h.doc().items.map((i) => i.id)).toEqual(['a'])
  })

  it('drags a room as a rectangle, snapped to the grid', () => {
    const h = harness()
    h.editor.ui.setTool({ kind: 'draw', draw: 'room' })
    h.drag([
      [3, 2],
      [100, 100],
      [20 * FT + 4, 10 * FT - 3],
    ])
    const room = h.doc().items[0]
    expect(room).toMatchObject({ type: 'room', points: [{ x: 0, y: 0 }, { x: 20 * FT, y: 0 }, { x: 20 * FT, y: 10 * FT }, { x: 0, y: 10 * FT }] })
  })

  it('closes a room drawn point by point when the first point is clicked again', () => {
    const h = harness()
    h.editor.ui.setTool({ kind: 'draw', draw: 'zone' })
    for (const [x, y] of [
      [0, 0],
      [10 * FT, 0],
      [10 * FT, 10 * FT],
      [2, 3],
    ]) {
      h.advance(600)
      h.click(x, y)
    }
    expect(h.doc().items[0]).toMatchObject({ type: 'zone' })
    expect((h.doc().items[0] as Extract<FixedItem, { type: 'zone' }>).points).toHaveLength(3)
  })

  it('snaps a door dropped near a wall onto it', () => {
    const h = harness([wall('w', [[0, 0], [20 * FT, 0]])])
    h.editor.ui.setTool({ kind: 'draw', draw: 'door' })
    h.click(300, 40)
    expect(h.doc().items[1]).toMatchObject({ type: 'door', wallId: 'w', x: 300, y: 0 })
  })

  it('places a column on a touch tap, and draws stairs with one finger', () => {
    const h = harness()
    h.editor.ui.setTool({ kind: 'draw', draw: 'roundColumn' })
    h.click(5 * FT, 5 * FT, { pointer: 'touch' })
    expect(h.doc().items[0]).toMatchObject({ type: 'column', shape: 'round', x: 5 * FT, y: 5 * FT })
    h.editor.ui.setTool({ kind: 'draw', draw: 'stairs' })
    h.drag(
      [
        [0, 0],
        [50, 50],
        [4 * FT, 10 * FT],
      ],
      { pointer: 'touch' },
    )
    expect(h.doc().items[1]).toMatchObject({ type: 'stairs', width: 4 * FT, height: 10 * FT })
  })

  it('refuses to draw in View mode', () => {
    const h = harness([], 'view')
    h.editor.ui.setState({ tool: { kind: 'draw', draw: 'label' } })
    h.click(10, 10)
    expect(h.doc().items).toHaveLength(0)
  })
})

describe('template controller: selecting and editing', () => {
  it('selects a wall and the side nearest the click', () => {
    const h = harness([wall('w', [[0, 0], [600, 0], [600, 400]])])
    h.click(300, 2)
    expect(h.editor.ui.getState().selection).toEqual(['w'])
    h.click(598, 300)
    expect(h.editor.ui.getState().segment).toEqual({ itemId: 'w', index: 1 })
  })

  it('moves the selection by whole grid steps, with the door on the wall', () => {
    const items = [wall('w', [[0, 0], [600, 0]])]
    const door = makeAtPoint('door', { x: 300, y: 0 }, items, 'd')!
    const h = harness([...items, door])
    h.drag([
      [100, 0],
      [110, 10],
      [100 + FT + 3, 2 * FT - 4],
    ])
    expect(h.item('w')).toMatchObject({ points: [{ x: FT, y: 2 * FT }, { x: 600 + FT, y: 2 * FT }] })
    expect(h.item('d')).toMatchObject({ x: 300 + FT, y: 2 * FT })
    expect(h.commits).toHaveLength(1)
  })

  it('drags a wall point by its handle', () => {
    const h = harness([wall('w', [[0, 0], [600, 0]])])
    h.drag(
      [
        [600, 0],
        [620, 20],
        [20 * FT, 3 * FT],
      ],
      { target: { kind: 'vertex', itemId: 'w', index: 1 } },
    )
    expect(h.item('w')).toMatchObject({ points: [{ x: 0, y: 0 }, { x: 20 * FT, y: 3 * FT }] })
  })

  it('draws a selection box around whole items', () => {
    const h = harness([wall('a', [[0, 0], [100, 0]]), wall('b', [[0, 300], [2000, 300]])])
    h.drag([
      [-50, -50],
      [-40, -40],
      [200, 100],
    ])
    expect(h.editor.ui.getState().selection).toEqual(['a'])
  })

  it('deletes, duplicates and undoes from the keyboard', () => {
    const h = harness([wall('a', [[0, 0], [100, 0]])])
    h.click(50, 0)
    expect(h.key('d', { ctrlKey: true })).toBe(true)
    expect(h.doc().items).toHaveLength(2)
    expect(h.key('Delete')).toBe(true)
    expect(h.doc().items).toHaveLength(1)
    expect(h.key('z', { ctrlKey: true })).toBe(true)
    expect(h.doc().items).toHaveLength(2)
    h.click(50, 0)
    expect(h.key('ArrowRight')).toBe(true)
    expect(h.item('a')).toMatchObject({ points: [{ x: FT, y: 0 }, { x: 100 + FT, y: 0 }] })
  })

  it('picks two points in the measure tool, starting again on a third', () => {
    const h = harness()
    h.editor.ui.setTool({ kind: 'measure' })
    h.click(0, 0)
    h.click(100, 0)
    expect(h.editor.ui.getState().measure).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ])
    h.click(50, 50)
    expect(h.editor.ui.getState().measure).toEqual([{ x: 50, y: 50 }])
    expect(h.doc().items).toHaveLength(0)
  })
})
