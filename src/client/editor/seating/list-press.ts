/**
 * A press on a name in the side list, as a pure state machine (PLAN section
 * 6, "Seating guests" and "Phones"; DECISIONS 57). Pointer events in,
 * intents out; no DOM, no clock of its own.
 *
 *  - Mouse and pen: a press that moves more than 4 px starts a guest drag.
 *    A press let go without moving is a tap (a click).
 *  - Touch: the list must keep scrolling, so rows carry touch-action: pan-y
 *    and a drag starts only after the finger stays within 8 px for 450 ms.
 *    Moving further first is a scroll: the press is dropped and nothing
 *    happens (the browser then sends pointercancel anyway). Lifting before
 *    450 ms is a tap (phones: tap a name, then tap a seat).
 *  - During a drag every move is a dragMove; letting go drops; pointercancel
 *    and Esc cancel with no change.
 *  - When the plan cannot change (View mode, or the page cannot edit yet,
 *    `canDrag` false) no drag ever starts: a press let go within 8 px is a
 *    tap however long it was held, so a slow tap on a seated name still pans
 *    to the seat, and anything further is nothing.
 */
import type { Point } from '@/domain/geometry'
import type { PointerKind } from '../input/pointer-machine'

export const LIST_DRAG_THRESHOLD_PX = 4
export const LIST_TOUCH_SLOP_PX = 8
export const LIST_LONG_PRESS_MS = 450

export type ListPressInput =
  /** canDrag: the plan can change now (Edit mode, page ready); leave out for true. */
  | { type: 'down'; id: number; pointer: PointerKind; button: number; guestId: string; at: Point; time: number; canDrag?: boolean }
  | { type: 'move'; id: number; at: Point; time: number }
  | { type: 'up'; id: number; at: Point; time: number }
  | { type: 'cancel'; id: number }
  /** The timer asked for with wantTimer. */
  | { type: 'timer'; time: number }
  | { type: 'escape' }

export type ListPressIntent =
  /** Send a timer input at this time (the events' clock). */
  | { type: 'wantTimer'; at: number }
  /** The drag begins: `at` is where the pointer is now (client px). */
  | { type: 'dragStart'; guestId: string; pointer: PointerKind; at: Point }
  | { type: 'dragMove'; at: Point }
  | { type: 'drop'; at: Point }
  | { type: 'dragCancel' }
  /** A press let go without dragging. */
  | { type: 'tap'; guestId: string; pointer: PointerKind }

type Press = { id: number; pointer: PointerKind; guestId: string; start: Point; last: Point; startTime: number; canDrag: boolean }

export type ListPressState =
  | { kind: 'idle' }
  | { kind: 'pressed'; press: Press }
  | { kind: 'dragging'; press: Press; last: Point }

export const LIST_PRESS_IDLE: ListPressState = Object.freeze({ kind: 'idle' })

export type ListPressStep = { state: ListPressState; intents: ListPressIntent[] }

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** True while a press or a drag is under way. */
export function listPressBusy(state: ListPressState): boolean {
  return state.kind !== 'idle'
}

/** True once the drag has begun (touch: after the 450 ms hold): the page must stop scrolling. */
export function listPressDragging(state: ListPressState): boolean {
  return state.kind === 'dragging'
}

const stay = (state: ListPressState): ListPressStep => ({ state, intents: [] })

export function stepListPress(state: ListPressState, input: ListPressInput): ListPressStep {
  switch (input.type) {
    case 'down': {
      // One press at a time; a second finger is ignored.
      if (state.kind !== 'idle' || input.button !== 0) return stay(state)
      const canDrag = input.canDrag ?? true
      const press: Press = { id: input.id, pointer: input.pointer, guestId: input.guestId, start: input.at, last: input.at, startTime: input.time, canDrag }
      return {
        state: { kind: 'pressed', press },
        intents: canDrag && input.pointer === 'touch' ? [{ type: 'wantTimer', at: input.time + LIST_LONG_PRESS_MS }] : [],
      }
    }
    case 'move': {
      if (state.kind === 'idle' || state.press.id !== input.id) return stay(state)
      if (state.kind === 'dragging') return { state: { ...state, last: input.at }, intents: [{ type: 'dragMove', at: input.at }] }
      const press = { ...state.press, last: input.at }
      const moved = dist(press.start, input.at)
      if (press.pointer === 'touch') {
        // Moving before the hold is a scroll: let the list have it.
        return moved > LIST_TOUCH_SLOP_PX ? stay(LIST_PRESS_IDLE) : stay({ kind: 'pressed', press })
      }
      // No drags while the plan cannot change: the release decides between a tap and nothing.
      if (!press.canDrag) return stay({ kind: 'pressed', press })
      if (moved <= LIST_DRAG_THRESHOLD_PX) return stay({ kind: 'pressed', press })
      return {
        state: { kind: 'dragging', press, last: input.at },
        intents: [
          { type: 'dragStart', guestId: press.guestId, pointer: press.pointer, at: input.at },
          { type: 'dragMove', at: input.at },
        ],
      }
    }
    case 'timer': {
      if (state.kind !== 'pressed' || state.press.pointer !== 'touch' || !state.press.canDrag) return stay(state)
      const press = state.press
      if (dist(press.start, press.last) > LIST_TOUCH_SLOP_PX) return stay(LIST_PRESS_IDLE)
      if (input.time < press.startTime + LIST_LONG_PRESS_MS) return { state, intents: [{ type: 'wantTimer', at: press.startTime + LIST_LONG_PRESS_MS }] }
      return {
        state: { kind: 'dragging', press, last: press.last },
        intents: [
          { type: 'dragStart', guestId: press.guestId, pointer: press.pointer, at: press.last },
          { type: 'dragMove', at: press.last },
        ],
      }
    }
    case 'up': {
      if (state.kind === 'idle' || state.press.id !== input.id) return stay(state)
      if (state.kind === 'dragging') return { state: LIST_PRESS_IDLE, intents: [{ type: 'drop', at: input.at }] }
      const slop = state.press.pointer === 'touch' || !state.press.canDrag ? LIST_TOUCH_SLOP_PX : LIST_DRAG_THRESHOLD_PX
      if (dist(state.press.start, input.at) > slop) return stay(LIST_PRESS_IDLE)
      return { state: LIST_PRESS_IDLE, intents: [{ type: 'tap', guestId: state.press.guestId, pointer: state.press.pointer }] }
    }
    case 'cancel': {
      if (state.kind === 'idle' || state.press.id !== input.id) return stay(state)
      return { state: LIST_PRESS_IDLE, intents: state.kind === 'dragging' ? [{ type: 'dragCancel' }] : [] }
    }
    case 'escape': {
      if (state.kind === 'idle') return stay(state)
      return { state: LIST_PRESS_IDLE, intents: state.kind === 'dragging' ? [{ type: 'dragCancel' }] : [] }
    }
  }
}
