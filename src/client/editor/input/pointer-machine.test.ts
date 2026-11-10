import { describe, expect, it } from 'vitest'
import type { Target } from './hit-test'
import {
  chooseDrag,
  initialMachineState,
  isBusy,
  LONG_PRESS_MS,
  menuPress,
  stepPointer,
  type Intent,
  type MachineContext,
  type MachineState,
  type PointerInput,
  type PointerKind,
} from './pointer-machine'

const table: Target = { kind: 'item', itemId: 't1', itemKind: 'table', locked: false }
const fixture: Target = { kind: 'item', itemId: 'f1', itemKind: 'fixture', locked: false }
const lockedItem: Target = { kind: 'item', itemId: 'L', itemKind: 'shape', locked: true }
const empty: Target = { kind: 'empty' }
const takenSeat: Target = { kind: 'seat', itemId: 't1', seatIndex: 2, guestId: 'g1', locked: false }
const emptySeat: Target = { kind: 'seat', itemId: 't1', seatIndex: 3, guestId: null, locked: false }
const handle: Target = { kind: 'handle', itemId: 't1', handle: 'se' }

function ctx(overrides: Partial<MachineContext> & { selected?: string[] } = {}): MachineContext {
  const selected = new Set(overrides.selected ?? [])
  return { mode: 'edit', tool: 'select', phoneSelect: false, spaceHeld: false, isSelected: (id) => selected.has(id), ...overrides }
}

type Mods = { shift?: boolean; alt?: boolean }

const down = (target: Target, x: number, y: number, o: Mods & { id?: number; pointer?: PointerKind; button?: number; time?: number } = {}): PointerInput => ({
  type: 'down',
  id: o.id ?? 1,
  pointer: o.pointer ?? 'mouse',
  button: o.button ?? 0,
  at: { x, y },
  time: o.time ?? 0,
  target,
  shift: o.shift ?? false,
  alt: o.alt ?? false,
})
const move = (x: number, y: number, o: Mods & { id?: number; time?: number } = {}): PointerInput => ({
  type: 'move',
  id: o.id ?? 1,
  at: { x, y },
  time: o.time ?? 0,
  shift: o.shift ?? false,
  alt: o.alt ?? false,
})
const up = (x: number, y: number, o: Mods & { id?: number; time?: number } = {}): PointerInput => ({
  type: 'up',
  id: o.id ?? 1,
  at: { x, y },
  time: o.time ?? 0,
  shift: o.shift ?? false,
  alt: o.alt ?? false,
})

function run(inputs: PointerInput[], c: MachineContext = ctx(), from: MachineState = initialMachineState): { state: MachineState; intents: Intent[] } {
  let state = from
  const intents: Intent[] = []
  for (const input of inputs) {
    const step = stepPointer(state, input, c)
    state = step.state
    intents.push(...step.intents)
  }
  return { state, intents }
}

const types = (intents: Intent[]) => intents.map((i) => i.type)

describe('click or drag (mouse)', () => {
  it('counts a press that moves 4 px or less as a click', () => {
    const { state, intents } = run([down(table, 100, 100), move(103, 102), move(104, 100), up(104, 100)])
    expect(intents).toEqual([
      { type: 'select', ids: ['t1'] },
      { type: 'tap', target: table, at: { x: 100, y: 100 }, pointer: 'mouse' },
    ])
    expect(isBusy(state)).toBe(false)
  })

  it('starts a drag once the press moves more than 4 px, and moves the selection', () => {
    const { intents } = run([down(table, 100, 100), move(104.5, 100), move(120, 110), up(130, 110)], ctx({ selected: ['t1', 'f1'] }))
    expect(types(intents)).toEqual(['dragStart', 'dragMove', 'dragMove', 'dragEnd'])
    const start = intents[0] as Extract<Intent, { type: 'dragStart' }>
    expect(start).toMatchObject({ drag: 'move', start: { x: 100, y: 100 }, at: { x: 104.5, y: 100 } })
    expect(intents[3]).toMatchObject({ type: 'dragEnd', at: { x: 130, y: 110 } })
  })

  it('selects an unselected item before dragging it', () => {
    const { intents } = run([down(fixture, 0, 0), move(20, 0)], ctx({ selected: ['t1'] }))
    expect(intents[0]).toEqual({ type: 'select', ids: ['f1'] })
    expect(intents[1]).toMatchObject({ type: 'dragStart', drag: 'move' })
  })

  it('clears the selection on a click on empty canvas, and draws a box on a drag there', () => {
    expect(types(run([down(empty, 0, 0), up(0, 0)]).intents)).toEqual(['clearSelection', 'tap'])
    const box = run([down(empty, 0, 0), move(50, 50), up(60, 60)]).intents
    expect(types(box)).toEqual(['dragStart', 'dragMove', 'dragEnd'])
    expect(box[0]).toMatchObject({ drag: 'marquee', pressShift: false })
  })

  it('treats a drag on a locked item like empty canvas, and a click selects it', () => {
    expect(run([down(lockedItem, 0, 0), move(30, 0)]).intents[0]).toMatchObject({ type: 'dragStart', drag: 'marquee' })
    expect(run([down(lockedItem, 0, 0), up(0, 0)]).intents[0]).toEqual({ type: 'select', ids: ['L'] })
  })
})

describe('Shift+click and Shift+drag (acceptance 11)', () => {
  it('toggles the selection on Shift+click', () => {
    const { intents } = run([down(table, 100, 100, { shift: true }), move(102, 101, { shift: true }), up(102, 101, { shift: true })], ctx({ selected: ['f1'] }))
    expect(intents[0]).toEqual({ type: 'toggleSelect', id: 't1' })
  })

  it('resizes a table about its center on Shift+drag past 4 px', () => {
    const { intents } = run([down(table, 100, 100, { shift: true }), move(110, 100, { shift: true }), up(120, 100, { shift: true })], ctx({ selected: ['t1'] }))
    expect(types(intents)).toEqual(['dragStart', 'dragMove', 'dragEnd'])
    expect(intents[0]).toMatchObject({ drag: 'centerResize', target: table })
  })

  it('also resizes from a seat on the table, and selects the table first', () => {
    const { intents } = run([down(emptySeat, 0, 0, { shift: true }), move(10, 0, { shift: true })])
    expect(intents[0]).toEqual({ type: 'select', ids: ['t1'] })
    expect(intents[1]).toMatchObject({ type: 'dragStart', drag: 'centerResize' })
  })

  it('moves other items on Shift+drag, adding them to the selection', () => {
    const { intents } = run([down(fixture, 0, 0, { shift: true }), move(10, 0, { shift: true })], ctx({ selected: ['t1'] }))
    expect(intents[0]).toEqual({ type: 'toggleSelect', id: 'f1' })
    expect(intents[1]).toMatchObject({ type: 'dragStart', drag: 'move' })
  })

  it('adds to the selection with a Shift+drag box', () => {
    const { intents } = run([down(empty, 0, 0, { shift: true }), move(30, 30, { shift: true })])
    expect(intents[0]).toMatchObject({ type: 'dragStart', drag: 'marquee', pressShift: true })
  })
})

describe('handles, seats and panning', () => {
  it('resizes from a handle and re-sends the drag when Shift or Alt changes', () => {
    const { intents } = run([down(handle, 0, 0), move(10, 10), { type: 'modifiers', shift: true, alt: false }, up(12, 12, { shift: true })])
    expect(types(intents)).toEqual(['dragStart', 'dragMove', 'dragMove', 'dragEnd'])
    expect(intents[0]).toMatchObject({ drag: 'resize' })
    expect(intents[2]).toMatchObject({ at: { x: 10, y: 10 }, shift: true })
  })

  it('does nothing for a click on a handle', () => {
    expect(run([down(handle, 0, 0), up(0, 0)]).intents).toEqual([])
  })

  it('selects a seated guest on click, and starts a guest drag on a drag', () => {
    expect(run([down(takenSeat, 0, 0, { shift: true }), up(0, 0)]).intents[0]).toEqual({ type: 'selectGuest', itemId: 't1', seatIndex: 2, toggle: true })
    expect(run([down(takenSeat, 0, 0), move(20, 0)]).intents[0]).toMatchObject({ type: 'dragStart', drag: 'guest' })
  })

  it('pans with the middle button, Space+drag and the hand tool', () => {
    for (const [input, c] of [
      [down(table, 0, 0, { button: 1 }), ctx()],
      [down(table, 0, 0), ctx({ spaceHeld: true })],
      [down(table, 0, 0), ctx({ tool: 'hand' })],
    ] as const) {
      const { intents } = run([input, move(5, 7), move(6, 9), up(6, 9)], c)
      expect(intents).toEqual([{ type: 'panStart', pointer: 'mouse' }, { type: 'pan', dx: 5, dy: 7 }, { type: 'pan', dx: 1, dy: 2 }, { type: 'panEnd' }])
    }
  })

  it('leaves the right button to the browser context menu event', () => {
    const { state, intents } = run([down(table, 0, 0, { button: 2 }), move(50, 50)])
    expect(intents).toEqual([])
    expect(run([up(50, 50)], ctx(), state).state.phase.kind).toBe('idle')
  })

  it('places the place tool preset on a click', () => {
    expect(run([down(empty, 40, 50), up(40, 50)], ctx({ tool: 'place' })).intents).toEqual([{ type: 'place', at: { x: 40, y: 50 }, alt: false }])
  })

  it('places a note with a click and draws one with a drag, from anywhere, Alt passed on', () => {
    const note = ctx({ tool: 'note' })
    expect(run([down(table, 40, 50, { alt: true }), up(40, 50)], note).intents).toEqual([{ type: 'place', at: { x: 40, y: 50 }, alt: true }])
    for (const target of [empty, table, lockedItem, takenSeat]) {
      const { intents } = run([down(target, 0, 0), move(30, 0), up(30, 0)], note)
      expect(types(intents)).toEqual(['dragStart', 'dragMove', 'dragEnd'])
      expect(intents[0]).toMatchObject({ drag: 'draw', target })
    }
    // A handle still resizes, and a touch draws instead of panning.
    expect(chooseDrag({ id: 1, pointer: 'mouse', start: { x: 0, y: 0 }, last: { x: 0, y: 0 }, startTime: 0, shift: false, alt: false, target: handle, longPressed: false }, note)).toBe('resize')
    expect(types(run([down(empty, 0, 0, { pointer: 'touch' }), move(30, 0), up(30, 0)], note).intents)).toEqual(['wantTimer', 'dragStart', 'dragMove', 'dragEnd'])
    // View mode pans.
    expect(types(run([down(empty, 0, 0), move(30, 0), up(30, 0)], ctx({ tool: 'note', mode: 'view' })).intents)).toEqual(['panStart', 'pan', 'panEnd'])
  })

  it('drags an arrow end (a vertex) like a handle', () => {
    const end: Target = { kind: 'vertex', itemId: 'n', index: 1 }
    expect(run([down(end, 0, 0), move(30, 0)]).intents[0]).toMatchObject({ type: 'dragStart', drag: 'resize', target: end })
    expect(run([down(end, 0, 0), up(0, 0)]).intents).toEqual([])
  })

  it('cancels a drag on Esc and ignores the pointer until it lifts', () => {
    const { state, intents } = run([down(table, 0, 0), move(20, 0), { type: 'escape' }, move(40, 0), up(40, 0)], ctx({ selected: ['t1'] }))
    expect(types(intents)).toEqual(['dragStart', 'dragMove', 'dragCancel'])
    expect(state.phase.kind).toBe('idle')
  })

  it('reports a lost pointer as a cancelled drag', () => {
    expect(types(run([down(table, 0, 0), move(20, 0), { type: 'cancel', id: 1 }], ctx({ selected: ['t1'] })).intents)).toEqual(['dragStart', 'dragMove', 'dragCancel'])
  })
})

describe('touch', () => {
  const touch = { pointer: 'touch' as const }

  it('asks for the long-press timer and opens the menu on a hold and lift (PLAN section 6)', () => {
    const { intents } = run([
      down(table, 100, 100, { ...touch, time: 1000 }),
      move(105, 103, { time: 1200 }),
      { type: 'timer', time: 1000 + LONG_PRESS_MS },
      up(105, 103, { time: 1600 }),
    ])
    expect(intents).toEqual([
      { type: 'wantTimer', at: 1000 + LONG_PRESS_MS },
      { type: 'longPress', at: { x: 100, y: 100 }, target: table },
      { type: 'select', ids: ['t1'] },
      { type: 'contextMenu', at: { x: 100, y: 100 }, target: table, pointer: 'touch' },
    ])
  })

  it('does not long-press once the finger moved more than 8 px', () => {
    const { intents } = run([down(empty, 0, 0, { ...touch, time: 0 }), move(9, 0), { type: 'timer', time: LONG_PRESS_MS }, up(9, 0)])
    expect(types(intents)).toEqual(['wantTimer', 'panStart', 'pan', 'panEnd'])
  })

  it('waits for the full hold when the timer comes early', () => {
    const { intents } = run([down(table, 0, 0, { ...touch, time: 0 }), { type: 'timer', time: 300 }])
    expect(intents[1]).toEqual({ type: 'wantTimer', at: LONG_PRESS_MS })
  })

  it('drags a table after a hold, then moving', () => {
    const { intents } = run([down(table, 0, 0, { ...touch, time: 0 }), { type: 'timer', time: LONG_PRESS_MS }, move(30, 0), up(40, 0)])
    expect(types(intents)).toEqual(['wantTimer', 'longPress', 'select', 'dragStart', 'dragMove', 'dragEnd'])
    expect(intents[3]).toMatchObject({ drag: 'move' })
  })

  it('taps with an 8 px slop', () => {
    expect(types(run([down(table, 0, 0, touch), move(7, 0), up(7, 0)]).intents)).toEqual(['wantTimer', 'select', 'tap'])
  })

  it('pans with one finger on empty canvas, and draws a box when Select is on (PLAN change 12)', () => {
    expect(run([down(empty, 0, 0, touch), move(20, 0)]).intents[1]).toEqual({ type: 'panStart', pointer: 'touch' })
    expect(run([down(empty, 0, 0, touch), move(20, 0)], ctx({ phoneSelect: true })).intents[1]).toMatchObject({ type: 'dragStart', drag: 'marquee' })
  })

  it('pans over an unselected table and moves a selected one', () => {
    expect(run([down(table, 0, 0, touch), move(20, 0)]).intents[1]).toMatchObject({ type: 'panStart' })
    expect(run([down(table, 0, 0, touch), move(20, 0)], ctx({ selected: ['t1'] })).intents[1]).toMatchObject({ type: 'dragStart', drag: 'move' })
  })

  it('toggles on tap when Select is on', () => {
    expect(run([down(table, 0, 0, touch), up(0, 0)], ctx({ phoneSelect: true })).intents[1]).toEqual({ type: 'toggleSelect', id: 't1' })
  })

  it('pinches and pans with two fingers', () => {
    const { intents, state } = run([
      down(empty, 100, 100, { ...touch, id: 1 }),
      down(empty, 200, 100, { ...touch, id: 2 }),
      move(250, 100, { id: 2 }),
      move(110, 100, { id: 1 }),
      up(110, 100, { id: 1 }),
      move(300, 300, { id: 2 }),
      up(300, 300, { id: 2 }),
    ])
    expect(intents[1]).toEqual({ type: 'pinchStart' })
    expect(intents[2]).toEqual({ type: 'pinch', center: { x: 175, y: 100 }, scale: 1.5, dx: 25, dy: 0 })
    const second = intents[3] as Extract<Intent, { type: 'pinch' }>
    expect(second.center).toEqual({ x: 180, y: 100 })
    expect(second.scale).toBeCloseTo(140 / 150, 9)
    expect(types(intents).slice(4)).toEqual(['pinchEnd'])
    expect(state.phase.kind).toBe('idle')
  })

  it('ends a one-finger drag where it is when a second finger lands', () => {
    const { intents } = run([down(table, 0, 0, { ...touch, id: 1 }), move(30, 0, { id: 1 }), down(empty, 300, 0, { ...touch, id: 2 })], ctx({ selected: ['t1'] }))
    expect(types(intents)).toEqual(['wantTimer', 'dragStart', 'dragMove', 'dragEnd', 'pinchStart'])
    expect(intents[3]).toMatchObject({ at: { x: 30, y: 0 } })
  })
})

describe('View mode', () => {
  const view = ctx({ mode: 'view' })

  it('pans on every drag and changes nothing', () => {
    for (const target of [table, empty, handle, takenSeat]) {
      const { intents } = run([down(target, 0, 0), move(20, 0), up(20, 0)], view)
      expect(types(intents)).toEqual(['panStart', 'pan', 'panEnd'])
    }
  })

  it('still selects on a click, to list a table guests', () => {
    expect(run([down(table, 0, 0), up(0, 0)], view).intents[0]).toEqual({ type: 'select', ids: ['t1'] })
  })

  it('never places with the place tool', () => {
    expect(run([down(empty, 0, 0), up(0, 0)], ctx({ mode: 'view', tool: 'place' })).intents[0]).toEqual({ type: 'clearSelection' })
  })
})

describe('chooseDrag', () => {
  it('needs a hold before a guest drag on touch', () => {
    const press = { id: 1, pointer: 'touch' as const, start: { x: 0, y: 0 }, last: { x: 0, y: 0 }, startTime: 0, shift: false, alt: false, target: takenSeat, longPressed: false }
    expect(chooseDrag(press, ctx())).toBe('pan')
    expect(chooseDrag({ ...press, longPressed: true }, ctx())).toBe('guest')
  })
})

describe('a press the right-click menu takes over (A2)', () => {
  it('names the only mouse press, pressed or waiting to lift, and nothing else', () => {
    // Right button: waiting for the release.
    expect(menuPress(run([down(table, 0, 0, { button: 2, id: 7 })]).state)).toBe(7)
    // Ctrl+left on a Mac: still a press.
    expect(menuPress(run([down(table, 0, 0, { id: 3 })]).state)).toBe(3)
    expect(menuPress(initialMachineState)).toBeNull()
    // Not once it is a drag, not for touch, not with two pointers down.
    expect(menuPress(run([down(table, 0, 0), move(30, 0)]).state)).toBeNull()
    expect(menuPress(run([down(table, 0, 0, { pointer: 'touch' })]).state)).toBeNull()
    expect(menuPress(run([down(table, 0, 0), down(empty, 5, 5, { id: 2, pointer: 'pen' })]).state)).toBeNull()
  })

  it('cancelling that press leaves its release with nothing to do', () => {
    const { state } = run([down(empty, 0, 0, { button: 2 }), { type: 'cancel', id: 1 }])
    expect(isBusy(state)).toBe(false)
    expect(run([up(0, 0)], ctx(), state).intents).toEqual([])
  })
})

describe('a release that never came (A7)', () => {
  it('starts afresh when a new pointer comes down while waiting for the old one to lift', () => {
    // A touch held, then Esc (the window lost focus): waiting for it to lift.
    let { state } = run([down(table, 0, 0, { pointer: 'touch', id: 4 }), { type: 'escape' }])
    expect(state.phase.kind).toBe('draining')
    // Its release went elsewhere; the next tap must still select.
    const next = run([down(table, 10, 10, { pointer: 'touch', id: 5 }), up(10, 10, { id: 5 })], ctx(), state)
    expect(next.intents).toContainEqual({ type: 'select', ids: ['t1'] })
    expect(isBusy(next.state)).toBe(false)
    expect(next.state.pointers.size).toBe(0)
    // The same pointer coming down again while waiting still waits.
    state = run([down(empty, 0, 0, { button: 2 })]).state
    expect(stepPointer(state, down(table, 0, 0), ctx()).state.phase.kind).toBe('draining')
  })
})
