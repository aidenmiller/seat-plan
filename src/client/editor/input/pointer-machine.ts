/**
 * The pointer controller as a pure state machine (PLAN section 6, "Input" and
 * "Selection"): pointer events in, intents out. No DOM, no stores, no clock:
 * the DOM adapter feeds it, and the editor controller turns intents into
 * selection changes, document edits and camera moves.
 *
 * Mouse and pen:
 *  - A press that moves more than 4 px is a drag; otherwise a click.
 *  - Click selects an item, or a seated guest; Shift+click adds or removes.
 *    Click on empty canvas clears the selection (not with Shift).
 *  - Drag on an unlocked item moves the selection (selecting the item first
 *    if it was not selected). Shift+drag on a table resizes it about its
 *    center. Drag on a handle resizes, on the rotate handle turns. Drag from
 *    a seated guest starts a guest drag, on a locked table too (DECISIONS
 *    56: seats on locked items still change). Drag on empty canvas or a
 *    locked item draws a selection box.
 *  - Middle button, Space+drag and the hand tool pan.
 *  - A vertex (a wall's point in the template editor, an arrow's end in a
 *    layout) drags like a handle.
 *  - With a note tool, a click places the note and a drag anywhere draws it
 *    (an arrow from start to end, or a note's box), on touch too.
 *
 * Touch (PLAN change 12):
 *  - Taps work as clicks; with the phone Select switch on, taps toggle.
 *  - A press must move more than 8 px to be a drag.
 *  - One finger pans, unless it starts on a handle, on a selected unlocked
 *    item (moves it) or, with Select on, on empty canvas (selection box).
 *  - Holding 450 ms within 8 px arms a long press: letting go opens the menu
 *    right click opens; moving then drags the item (or the guest).
 *  - Two fingers pinch and pan. A second finger ends a one-finger drag where
 *    it is (kept, one undo step) and starts the pinch; a guest drag is
 *    cancelled instead, since a guest is only dropped where the finger lifts.
 *
 * View mode: clicks and taps still select (to list a table's guests), every
 * drag pans, and long press still opens the (read-only) menu.
 *
 * Seating (milestone 5): while a name waits for a seat (tap-then-tap,
 * `picking`), a click or tap selects nothing and only reports the tap. In
 * Edit mode a click on an empty seat's + (a seat target marked plus) opens
 * its guest picker instead of selecting the table, unless Shift or the phone
 * Select switch makes it a toggle.
 */
import type { Point } from '@/domain/geometry'
import { isTableTarget, type Target } from './hit-test'

export const DRAG_THRESHOLD_PX = 4
export const TOUCH_SLOP_PX = 8
export const LONG_PRESS_MS = 450

export type PointerKind = 'mouse' | 'pen' | 'touch'
export type Modifiers = { shift: boolean; alt: boolean }

export type PointerInput =
  | ({ type: 'down'; id: number; pointer: PointerKind; button: number; at: Point; time: number; target: Target } & Modifiers)
  | ({ type: 'move'; id: number; at: Point; time: number } & Modifiers)
  | ({ type: 'up'; id: number; at: Point; time: number } & Modifiers)
  | { type: 'cancel'; id: number }
  /** The long-press timer the machine asked for with a wantTimer intent. */
  | { type: 'timer'; time: number }
  /** Shift or Alt went down or up during a drag. */
  | ({ type: 'modifiers' } & Modifiers)
  | { type: 'escape' }

export type MachineContext = {
  mode: 'edit' | 'view'
  tool: 'select' | 'hand' | 'place' | 'note'
  phoneSelect: boolean
  spaceHeld: boolean
  isSelected(itemId: string): boolean
  /** A name waits for a seat (tap-then-tap): taps select nothing. */
  picking?: boolean
}

/** draw: a note tool drag. */
export type DragKind = 'move' | 'resize' | 'rotate' | 'centerResize' | 'marquee' | 'guest' | 'draw'

export type DragInfo = {
  drag: DragKind
  target: Target
  pointer: PointerKind
  /** Screen points: where the press began and where the pointer is now. */
  start: Point
  at: Point
  /** Held now. */
  shift: boolean
  alt: boolean
  /** Shift was held when the press began (a selection box then adds). */
  pressShift: boolean
}

export type Intent =
  | { type: 'select'; ids: string[] }
  | { type: 'toggleSelect'; id: string }
  | { type: 'clearSelection' }
  | { type: 'selectGuest'; itemId: string; seatIndex: number; toggle: boolean }
  /** The place or note tool: add its preset or note here (alt: Alt was held, place it off the grid). */
  | { type: 'place'; at: Point; alt: boolean }
  /** A finished click or tap, after its selection change (hover cards, View mode taps). */
  | { type: 'tap'; target: Target; at: Point; pointer: PointerKind }
  | ({ type: 'dragStart' } & DragInfo)
  | ({ type: 'dragMove' } & DragInfo)
  | ({ type: 'dragEnd' } & DragInfo)
  | { type: 'dragCancel'; drag: DragKind }
  | { type: 'panStart'; pointer: PointerKind }
  /** Screen px; content follows the pointer. */
  | { type: 'pan'; dx: number; dy: number }
  | { type: 'panEnd' }
  | { type: 'pinchStart' }
  /** Pan by dx, dy, then zoom by `scale` about `center` (screen px). */
  | { type: 'pinch'; center: Point; scale: number; dx: number; dy: number }
  | { type: 'pinchEnd' }
  /** A touch was held 450 ms: show it (the menu opens when the finger lifts). */
  | { type: 'longPress'; at: Point; target: Target }
  | { type: 'contextMenu'; at: Point; target: Target; pointer: PointerKind }
  /** Send a timer input at this time (ms, the events' clock). */
  | { type: 'wantTimer'; at: number }

export type Press = {
  id: number
  pointer: PointerKind
  start: Point
  last: Point
  startTime: number
  shift: boolean
  alt: boolean
  target: Target
  longPressed: boolean
}

export type Phase =
  | { kind: 'idle' }
  | { kind: 'pressed'; press: Press }
  | { kind: 'dragging'; press: Press; drag: DragKind; last: Point; shift: boolean; alt: boolean }
  | { kind: 'panning'; press: Press; last: Point }
  | { kind: 'pinching'; a: number; b: number; center: Point; dist: number }
  /** Ignore everything until every pointer is up, or a new one comes down. */
  | { kind: 'draining' }

export type TrackedPointer = { at: Point; pointer: PointerKind }

export type MachineState = {
  phase: Phase
  pointers: ReadonlyMap<number, TrackedPointer>
}

export const initialMachineState: MachineState = Object.freeze({ phase: { kind: 'idle' }, pointers: new Map() })

export type Step = { state: MachineState; intents: Intent[] }

/** True while a press, drag, pan or pinch is under way. */
export function isBusy(state: MachineState): boolean {
  return state.phase.kind !== 'idle'
}

/** True while something on the canvas is being dragged (not a pan or pinch). */
export function isDragging(state: MachineState): boolean {
  return state.phase.kind === 'dragging'
}

/**
 * The pointer whose press a right click's menu can take over, or null. On
 * macOS and Linux the browser sends contextmenu while the button is still
 * down (a right press, or Ctrl+click on a Mac), so the machine is busy with
 * that press. When it is the only pointer down, a mouse or pen, and has not
 * turned into a drag or pan, the controller cancels it and opens the menu,
 * and its release is then no click.
 */
export function menuPress(state: MachineState): number | null {
  if (state.pointers.size !== 1) return null
  const [[id, p]] = [...state.pointers]
  if (p.pointer === 'touch') return null
  const phase = state.phase
  if (phase.kind === 'draining') return id
  if (phase.kind === 'pressed' && phase.press.id === id) return id
  return null
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function mid(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function withPointer(pointers: ReadonlyMap<number, TrackedPointer>, id: number, p: TrackedPointer | null): Map<number, TrackedPointer> {
  const next = new Map(pointers)
  if (p) next.set(id, p)
  else next.delete(id)
  return next
}

function touchIds(pointers: ReadonlyMap<number, TrackedPointer>): number[] {
  return [...pointers].filter(([, p]) => p.pointer === 'touch').map(([id]) => id)
}

/** Idle when no pointer is left down, else wait for them. */
function rest(pointers: ReadonlyMap<number, TrackedPointer>): Phase {
  return pointers.size === 0 ? { kind: 'idle' } : { kind: 'draining' }
}

function dragInfo(press: Press, drag: DragKind, at: Point, shift: boolean, alt: boolean): DragInfo {
  return { drag, target: press.target, pointer: press.pointer, start: press.start, at, shift, alt, pressShift: press.shift }
}

/** What a press that turned into a drag does. */
export function chooseDrag(press: Press, ctx: MachineContext): DragKind | 'pan' {
  const t = press.target
  if (ctx.mode !== 'edit' || ctx.tool === 'hand') return 'pan'
  if (t.kind === 'handle' || t.kind === 'vertex') return 'resize'
  if (t.kind === 'rotate') return 'rotate'
  if (ctx.tool === 'note') return 'draw'
  const touch = press.pointer === 'touch'
  // Seats on a locked table still take guests (DECISIONS 56).
  if (t.kind === 'seat' && t.guestId !== null && (!touch || press.longPressed)) return 'guest'
  if ((t.kind === 'item' || t.kind === 'seat') && !t.locked) {
    if (touch && !press.longPressed && !ctx.isSelected(t.itemId)) return 'pan'
    if (press.shift && !touch && isTableTarget(t)) return 'centerResize'
    return 'move'
  }
  if (touch) return ctx.phoneSelect && !press.longPressed ? 'marquee' : 'pan'
  return 'marquee'
}

/** The selection change a click or tap makes, then the tap itself. */
function clickIntents(press: Press, ctx: MachineContext): Intent[] {
  const t = press.target
  const edit = ctx.mode === 'edit'
  const tap: Intent = { type: 'tap', target: t, at: press.start, pointer: press.pointer }
  if (t.kind === 'handle' || t.kind === 'rotate' || t.kind === 'vertex') return []
  if (ctx.picking) return [tap]
  if (edit && (ctx.tool === 'place' || ctx.tool === 'note')) return [{ type: 'place', at: press.start, alt: press.alt }]
  const toggle = press.shift || (press.pointer === 'touch' && ctx.phoneSelect && edit)
  if (edit && !toggle && t.kind === 'seat' && t.plus === true) return [tap]
  if (t.kind === 'seat' && t.guestId !== null) return [{ type: 'selectGuest', itemId: t.itemId, seatIndex: t.seatIndex, toggle }, tap]
  if (t.kind === 'seat' || t.kind === 'item') return [toggle ? { type: 'toggleSelect', id: t.itemId } : { type: 'select', ids: [t.itemId] }, tap]
  return toggle ? [tap] : [{ type: 'clearSelection' }, tap]
}

/** Selects what a long press or right click landed on, unless it is already selected. */
export function menuSelection(target: Target, ctx: Pick<MachineContext, 'isSelected'>): Intent[] {
  if (target.kind === 'seat' && target.guestId !== null) return [{ type: 'selectGuest', itemId: target.itemId, seatIndex: target.seatIndex, toggle: false }]
  if ((target.kind === 'seat' || target.kind === 'item') && !ctx.isSelected(target.itemId)) return [{ type: 'select', ids: [target.itemId] }]
  return []
}

function startDrag(state: MachineState, press: Press, at: Point, mods: { shift: boolean; alt: boolean }, ctx: MachineContext): Step {
  const kind = chooseDrag(press, ctx)
  if (kind === 'pan') {
    return {
      state: { ...state, phase: { kind: 'panning', press, last: at } },
      intents: [
        { type: 'panStart', pointer: press.pointer },
        { type: 'pan', dx: at.x - press.start.x, dy: at.y - press.start.y },
      ],
    }
  }
  const intents: Intent[] = []
  const t = press.target
  if ((kind === 'move' || kind === 'centerResize') && (t.kind === 'item' || t.kind === 'seat') && !ctx.isSelected(t.itemId)) {
    intents.push(kind === 'move' && press.shift ? { type: 'toggleSelect', id: t.itemId } : { type: 'select', ids: [t.itemId] })
  }
  const info = dragInfo(press, kind, at, mods.shift, mods.alt)
  intents.push({ type: 'dragStart', ...info }, { type: 'dragMove', ...info })
  return { state: { ...state, phase: { kind: 'dragging', press, drag: kind, last: at, shift: mods.shift, alt: mods.alt } }, intents }
}

function startPinch(pointers: ReadonlyMap<number, TrackedPointer>, a: number, b: number): Phase {
  const pa = pointers.get(a)!.at
  const pb = pointers.get(b)!.at
  return { kind: 'pinching', a, b, center: mid(pa, pb), dist: dist(pa, pb) }
}

function onDown(state: MachineState, input: Extract<PointerInput, { type: 'down' }>, ctx: MachineContext): Step {
  // A new pointer while waiting for the others to lift: their release went
  // missing (the window lost focus mid-press), so start afresh.
  if (state.phase.kind === 'draining' && !state.pointers.has(input.id)) return onDown(initialMachineState, input, ctx)
  const pointers = withPointer(state.pointers, input.id, { at: input.at, pointer: input.pointer })
  const phase = state.phase
  const next = (p: Phase, intents: Intent[] = []): Step => ({ state: { phase: p, pointers }, intents })

  if (phase.kind !== 'idle') {
    const touches = touchIds(pointers)
    const singleTouch =
      input.pointer === 'touch' &&
      touches.length === 2 &&
      (phase.kind === 'pressed' || phase.kind === 'dragging' || phase.kind === 'panning') &&
      phase.press.pointer === 'touch'
    if (!singleTouch) return next(phase)
    const intents: Intent[] = []
    if (phase.kind === 'dragging') {
      // A guest is dropped only where the finger lifts: a second finger cancels the guest drag, so pinch to look further.
      if (phase.drag === 'guest') intents.push({ type: 'dragCancel', drag: 'guest' })
      else intents.push({ type: 'dragEnd', ...dragInfo(phase.press, phase.drag, phase.last, phase.shift, phase.alt) })
    }
    if (phase.kind === 'panning') intents.push({ type: 'panEnd' })
    intents.push({ type: 'pinchStart' })
    return next(startPinch(pointers, phase.press.id, input.id), intents)
  }

  // Right button: the browser's contextmenu event opens the menu (the DOM adapter sends it).
  if (input.button === 2) return next({ kind: 'draining' })
  const press: Press = {
    id: input.id,
    pointer: input.pointer,
    start: input.at,
    last: input.at,
    startTime: input.time,
    shift: input.shift,
    alt: input.alt,
    target: input.target,
    longPressed: false,
  }
  if (input.button === 1 || (input.button === 0 && (ctx.spaceHeld || ctx.tool === 'hand'))) {
    return next({ kind: 'panning', press, last: input.at }, [{ type: 'panStart', pointer: input.pointer }])
  }
  if (input.button !== 0) return next({ kind: 'draining' })
  return next({ kind: 'pressed', press }, input.pointer === 'touch' ? [{ type: 'wantTimer', at: input.time + LONG_PRESS_MS }] : [])
}

function onMove(state: MachineState, input: Extract<PointerInput, { type: 'move' }>, ctx: MachineContext): Step {
  const known = state.pointers.get(input.id)
  if (!known) return { state, intents: [] }
  const pointers = withPointer(state.pointers, input.id, { at: input.at, pointer: known.pointer })
  const s: MachineState = { ...state, pointers }
  const phase = state.phase
  switch (phase.kind) {
    case 'pressed': {
      if (phase.press.id !== input.id) return { state: s, intents: [] }
      const press = { ...phase.press, last: input.at }
      const slop = press.pointer === 'touch' ? TOUCH_SLOP_PX : DRAG_THRESHOLD_PX
      if (dist(press.start, input.at) <= slop) return { state: { ...s, phase: { kind: 'pressed', press } }, intents: [] }
      return startDrag(s, press, input.at, input, ctx)
    }
    case 'dragging': {
      if (phase.press.id !== input.id) return { state: s, intents: [] }
      const info = dragInfo(phase.press, phase.drag, input.at, input.shift, input.alt)
      return { state: { ...s, phase: { ...phase, last: input.at, shift: input.shift, alt: input.alt } }, intents: [{ type: 'dragMove', ...info }] }
    }
    case 'panning': {
      if (phase.press.id !== input.id) return { state: s, intents: [] }
      const dx = input.at.x - phase.last.x
      const dy = input.at.y - phase.last.y
      return { state: { ...s, phase: { ...phase, last: input.at } }, intents: dx === 0 && dy === 0 ? [] : [{ type: 'pan', dx, dy }] }
    }
    case 'pinching': {
      if (input.id !== phase.a && input.id !== phase.b) return { state: s, intents: [] }
      const next = startPinch(pointers, phase.a, phase.b) as Extract<Phase, { kind: 'pinching' }>
      const scale = phase.dist > 0 && next.dist > 0 ? next.dist / phase.dist : 1
      return {
        state: { ...s, phase: next },
        intents: [{ type: 'pinch', center: next.center, scale, dx: next.center.x - phase.center.x, dy: next.center.y - phase.center.y }],
      }
    }
    default:
      return { state: s, intents: [] }
  }
}

function onUp(state: MachineState, input: Extract<PointerInput, { type: 'up' }>, ctx: MachineContext): Step {
  const pointers = withPointer(state.pointers, input.id, null)
  const phase = state.phase
  const done = (intents: Intent[]): Step => ({ state: { phase: rest(pointers), pointers }, intents })
  switch (phase.kind) {
    case 'pressed': {
      if (phase.press.id !== input.id) return { state: { phase, pointers }, intents: [] }
      if (phase.press.longPressed) {
        const t = phase.press.target
        return done([...menuSelection(t, ctx), { type: 'contextMenu', at: phase.press.start, target: t, pointer: phase.press.pointer }])
      }
      return done(clickIntents(phase.press, ctx))
    }
    case 'dragging':
      if (phase.press.id !== input.id) return { state: { phase, pointers }, intents: [] }
      return done([{ type: 'dragEnd', ...dragInfo(phase.press, phase.drag, input.at, input.shift, input.alt) }])
    case 'panning':
      if (phase.press.id !== input.id) return { state: { phase, pointers }, intents: [] }
      return done([{ type: 'panEnd' }])
    case 'pinching':
      if (input.id !== phase.a && input.id !== phase.b) return { state: { phase, pointers }, intents: [] }
      return done([{ type: 'pinchEnd' }])
    default:
      return { state: { phase: rest(pointers), pointers }, intents: [] }
  }
}

function onCancel(state: MachineState, id: number): Step {
  const pointers = withPointer(state.pointers, id, null)
  const phase = state.phase
  const done = (intents: Intent[]): Step => ({ state: { phase: rest(pointers), pointers }, intents })
  switch (phase.kind) {
    case 'pressed':
      return phase.press.id === id ? done([]) : { state: { phase, pointers }, intents: [] }
    case 'dragging':
      return phase.press.id === id ? done([{ type: 'dragCancel', drag: phase.drag }]) : { state: { phase, pointers }, intents: [] }
    case 'panning':
      return phase.press.id === id ? done([{ type: 'panEnd' }]) : { state: { phase, pointers }, intents: [] }
    case 'pinching':
      return id === phase.a || id === phase.b ? done([{ type: 'pinchEnd' }]) : { state: { phase, pointers }, intents: [] }
    default:
      return { state: { phase: rest(pointers), pointers }, intents: [] }
  }
}

/** One input: the next state and what the editor should do. */
export function stepPointer(state: MachineState, input: PointerInput, ctx: MachineContext): Step {
  switch (input.type) {
    case 'down':
      return onDown(state, input, ctx)
    case 'move':
      return onMove(state, input, ctx)
    case 'up':
      return onUp(state, input, ctx)
    case 'cancel':
      return onCancel(state, input.id)
    case 'timer': {
      const phase = state.phase
      if (phase.kind !== 'pressed' || phase.press.pointer !== 'touch' || phase.press.longPressed) return { state, intents: [] }
      const press = phase.press
      if (dist(press.start, press.last) > TOUCH_SLOP_PX) return { state, intents: [] }
      if (input.time < press.startTime + LONG_PRESS_MS) return { state, intents: [{ type: 'wantTimer', at: press.startTime + LONG_PRESS_MS }] }
      return {
        state: { ...state, phase: { kind: 'pressed', press: { ...press, longPressed: true } } },
        intents: [{ type: 'longPress', at: press.start, target: press.target }],
      }
    }
    case 'modifiers': {
      const phase = state.phase
      if (phase.kind !== 'dragging' || (phase.shift === input.shift && phase.alt === input.alt)) return { state, intents: [] }
      const info = dragInfo(phase.press, phase.drag, phase.last, input.shift, input.alt)
      return { state: { ...state, phase: { ...phase, shift: input.shift, alt: input.alt } }, intents: [{ type: 'dragMove', ...info }] }
    }
    case 'escape': {
      const phase = state.phase
      const drain = (intents: Intent[]): Step => ({ state: { ...state, phase: rest(state.pointers) }, intents })
      switch (phase.kind) {
        case 'dragging':
          return drain([{ type: 'dragCancel', drag: phase.drag }])
        case 'panning':
          return drain([{ type: 'panEnd' }])
        case 'pinching':
          return drain([{ type: 'pinchEnd' }])
        case 'pressed':
          return drain([])
        default:
          return { state, intents: [] }
      }
    }
  }
}
