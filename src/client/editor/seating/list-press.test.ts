import { describe, expect, it } from 'vitest'
import type { PointerKind } from '../input/pointer-machine'
import {
  LIST_LONG_PRESS_MS,
  LIST_PRESS_IDLE,
  listPressBusy,
  listPressDragging,
  stepListPress,
  type ListPressInput,
  type ListPressIntent,
  type ListPressState,
} from './list-press'

/** Feeds inputs in turn and collects every intent. */
function run(inputs: ListPressInput[], start: ListPressState = LIST_PRESS_IDLE) {
  let state = start
  const intents: ListPressIntent[] = []
  for (const input of inputs) {
    const step = stepListPress(state, input)
    state = step.state
    intents.push(...step.intents)
  }
  return { state, intents, types: intents.map((i) => i.type) }
}

const down = (pointer: PointerKind, x = 0, y = 0, time = 0, button = 0): ListPressInput => ({ type: 'down', id: 1, pointer, button, guestId: 'g1', at: { x, y }, time })
const move = (x: number, y: number, time = 0): ListPressInput => ({ type: 'move', id: 1, at: { x, y }, time })
const up = (x: number, y: number, time = 0): ListPressInput => ({ type: 'up', id: 1, at: { x, y }, time })

describe('a press on a name in the side list', () => {
  it('never drags when the plan cannot change: a long or slightly moved press is a tap, a longer move nothing (review finding)', () => {
    const still = (pointer: PointerKind): ListPressInput => ({ ...(down(pointer) as Extract<ListPressInput, { type: 'down' }>), canDrag: false })
    // A finger held 600 ms: no timer asked for, no drag, a tap on lift.
    const held = run([still('touch'), { type: 'timer', time: 600 }, up(3, 2, 600)])
    expect(held.types).toEqual(['tap'])
    // A mouse that wobbles 5 px is still a tap; 30 px is nothing, and nothing is refused.
    expect(run([still('mouse'), move(5, 0), up(5, 0)]).types).toEqual(['tap'])
    const moved = run([still('mouse'), move(30, 0), move(200, 0)])
    expect(moved.types).toEqual([])
    expect(listPressDragging(moved.state)).toBe(false)
    expect(run([still('mouse'), move(30, 0), up(30, 0)]).types).toEqual([])
    // A finger that scrolls lets the list have it.
    expect(run([still('touch'), move(0, 20), up(0, 20)]).types).toEqual([])
  })

  it('with a mouse, becomes a drag after 4 px and drops where it lets go', () => {
    const r = run([down('mouse'), move(3, 0), move(5, 1), move(200, 50), up(210, 60)])
    expect(r.types).toEqual(['dragStart', 'dragMove', 'dragMove', 'drop'])
    expect(r.intents[0]).toEqual({ type: 'dragStart', guestId: 'g1', pointer: 'mouse', at: { x: 5, y: 1 } })
    expect(r.intents[3]).toEqual({ type: 'drop', at: { x: 210, y: 60 } })
    expect(r.state).toBe(LIST_PRESS_IDLE)
  })

  it('with a mouse, is a tap when let go within 4 px', () => {
    const r = run([down('mouse'), move(2, 2), up(3, 2)])
    expect(r.intents).toEqual([{ type: 'tap', guestId: 'g1', pointer: 'mouse' }])
  })

  it('ignores other buttons and a second pointer', () => {
    expect(run([down('mouse', 0, 0, 0, 2)]).state).toBe(LIST_PRESS_IDLE)
    const r = run([down('mouse'), { type: 'down', id: 2, pointer: 'touch', button: 0, guestId: 'g2', at: { x: 0, y: 0 }, time: 0 }, move(10, 0)])
    expect(r.intents[0]).toMatchObject({ type: 'dragStart', guestId: 'g1' })
  })

  it('with a finger, starts a drag only after a 450 ms hold within 8 px', () => {
    const first = run([down('touch', 10, 10, 1000)])
    expect(first.intents).toEqual([{ type: 'wantTimer', at: 1000 + LIST_LONG_PRESS_MS }])
    const held = run([move(15, 14, 1200), { type: 'timer', time: 1000 + LIST_LONG_PRESS_MS }], first.state)
    expect(held.intents[0]).toEqual({ type: 'dragStart', guestId: 'g1', pointer: 'touch', at: { x: 15, y: 14 } })
    expect(listPressDragging(held.state)).toBe(true)
    const dropped = run([move(300, 400, 1600), up(300, 400, 1700)], held.state)
    expect(dropped.types).toEqual(['dragMove', 'drop'])
  })

  it('with a finger, lets the list scroll when it moves before the hold', () => {
    const r = run([down('touch', 0, 0, 0), move(0, 9, 100), { type: 'timer', time: LIST_LONG_PRESS_MS }])
    expect(r.types).toEqual(['wantTimer'])
    expect(r.state).toBe(LIST_PRESS_IDLE)
  })

  it('with a finger, is a tap when lifted before the hold (tap-then-tap)', () => {
    const r = run([down('touch', 0, 0, 0), up(2, 3, 200)])
    expect(r.intents).toEqual([
      { type: 'wantTimer', at: LIST_LONG_PRESS_MS },
      { type: 'tap', guestId: 'g1', pointer: 'touch' },
    ])
  })

  it('asks for the timer again when it comes early', () => {
    const r = run([down('touch', 0, 0, 0), { type: 'timer', time: 300 }])
    expect(r.intents[1]).toEqual({ type: 'wantTimer', at: LIST_LONG_PRESS_MS })
    expect(listPressDragging(r.state)).toBe(false)
  })

  it('cancels a drag with no drop on pointercancel or Esc', () => {
    const dragging = run([down('mouse'), move(20, 0)]).state
    expect(run([{ type: 'cancel', id: 1 }], dragging).types).toEqual(['dragCancel'])
    expect(run([{ type: 'escape' }], dragging).types).toEqual(['dragCancel'])
    // A press not yet a drag just ends.
    const pressed = run([down('touch')]).state
    expect(listPressBusy(pressed)).toBe(true)
    const r = run([{ type: 'cancel', id: 1 }], pressed)
    expect(r.types).toEqual([])
    expect(r.state).toBe(LIST_PRESS_IDLE)
  })

  it('ignores moves and ups from other pointers', () => {
    const dragging = run([down('mouse'), move(20, 0)]).state
    const r = run([{ type: 'move', id: 9, at: { x: 0, y: 0 }, time: 0 }, { type: 'up', id: 9, at: { x: 0, y: 0 }, time: 0 }], dragging)
    expect(r.types).toEqual([])
    expect(listPressDragging(r.state)).toBe(true)
  })
})
