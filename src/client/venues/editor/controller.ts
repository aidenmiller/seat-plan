/**
 * The template editor's controller: pointer, wheel, gesture and keyboard
 * input become selection changes, fixed item edits and camera moves. It runs
 * on the layout editor's pointer machine (pointer-machine.ts) and DOM adapter,
 * so camera, grid, selection, handles, undo and the keyboard behave the same.
 *
 * Tools (spec section 5, "Venue templates"):
 *  - select: click selects (the side nearest the click is the one the length
 *    field sets), Shift+click adds, drag moves, a drag on empty canvas draws
 *    a selection box, a wall's points and a box's handles drag.
 *  - wall and patio edge: click to place points; double-click or Enter
 *    finishes; Esc cancels; Backspace takes the last point back.
 *  - room and zone: drag a rectangle, or click points and finish as a wall
 *    (or click the first point again).
 *  - door and window: click near a wall and they snap onto it.
 *  - column, round column, stairs, built-in bar: click for the usual size, or
 *    drag a rectangle. label: click.
 *  - measure: clicks pick the two points of the import's scale step.
 * After a new item is made it is selected and the tool goes back to select.
 */
import { boxFromCorners, distance, type Box, type Point } from '@/domain/geometry'
import { fixedItemAt } from '@/domain/fixed-items'
import { gridStepCm, snapToGrid } from '@/domain/snapping'
import {
  addFixedItem,
  deleteFixedItems,
  drawsPoints,
  drawsRectangle,
  duplicateFixedItems,
  findItem,
  fixedItemsInBox,
  isBoxItem,
  isOpening,
  isPolyItem,
  makeAtPoint,
  makeFromRect,
  makePolyItem,
  moveFixedItems,
  nearestSegment,
  resizeBoxItem,
  rotateFixedItem,
  setVertex,
  snapOpening,
  templateBox,
  FIXED_KIND_LABEL,
  type TemplateDoc,
} from '@/domain/template-commands'
import type { LengthUnit } from '@/domain/units'
import type { FixedItem } from '@/domain/venue-schema'
import { classifyWheel, rememberWheel, wheelPanDelta, wheelZoomFactor, type WheelHistory } from '@/domain/wheel'
import { handlePoint, type Handle } from '@/domain/resize'
import type { CameraController } from '@/client/editor/camera/camera-controller'
import type { WheelInput } from '@/client/editor/input/controller'
import { EMPTY_TARGET, type Target } from '@/client/editor/input/hit-test'
import { isPressable, isSpaceKey, keyCommand, type KeyLike } from '@/client/editor/input/keyboard'
import {
  initialMachineState,
  isBusy,
  isDragging,
  menuPress,
  stepPointer,
  type DragInfo,
  type Intent,
  type MachineContext,
  type MachineState,
  type PointerInput,
  type PointerKind,
} from '@/client/editor/input/pointer-machine'
import type { NudgeDirection } from '@/client/editor/commands'
import type { DocGesture, EditorDoc } from '@/client/editor/state/editor-doc'
import type { ViewStore } from '@/client/editor/state/device-view'
import type { EditorMode } from '@/client/editor/state/ui-store'
import { SELECT, type TemplateInteractionStore, type TemplateUiStore } from './ui-store'

/** Pointer reach, screen px. */
export const HIT_TOLERANCE_PX = 6
/** Two clicks this close in time (ms) and space (px) are a double-click. */
export const DOUBLE_CLICK_MS = 400
export const DOUBLE_CLICK_PX = 8
/** A click this close (px) to a room's first point closes it. */
export const CLOSE_OUTLINE_PX = 12
export const NUDGE_BURST_MS = 1000

export type TemplateMenuRequest = { at: Point; itemId: string | null; pointer: PointerKind }

export type TemplateEvents = {
  /** Right click or a long press on an item (already selected). */
  onContextMenu?(request: TemplateMenuRequest): void
  /** A change was refused (View mode, or the page cannot edit). */
  onRefused?(): void
  /** A new item was drawn and selected. */
  onCreated?(item: FixedItem): void
}

export type TemplateControllerDeps = {
  doc: EditorDoc<TemplateDoc>
  ui: TemplateUiStore
  interaction: TemplateInteractionStore
  view: ViewStore
  camera: CameraController
  unit: () => LengthUnit
  newId: () => string
  setMode: (mode: EditorMode) => void
  /** The reference image's size in pixels while it shows (null while hidden), for fit to content. */
  imageSize?: () => { width: number; height: number } | null
  events?: TemplateEvents
  now?: () => number
  setTimer?: (callback: () => void, ms: number) => unknown
}

export type TemplateActions = {
  undo(): boolean
  redo(): boolean
  deleteSelection(): boolean
  duplicateSelection(): boolean
  selectAll(): void
  nudge(direction: NudgeDirection, big?: boolean): boolean
  /** Any change, as one undo step. Merges with the last step of the same mergeKey (a slider's drag). */
  run(label: string, recipe: (doc: TemplateDoc) => TemplateDoc, mergeKey?: string): boolean
  /** Finishes the wall or outline being drawn. */
  finishDrawing(): boolean
  cancelDrawing(): void
  /** Takes the last placed point back. */
  undoPoint(): void
  /** Phones: makes a fixed item of the usual size at the viewport's center (doors and windows snap to a wall). */
  addAtCenter(kind: Parameters<typeof makeAtPoint>[0]): string | null
  zoomIn(): void
  zoomOut(): void
  zoomReset(): void
  zoomFit(): void
  /** Centers the view on an item. */
  showItem(id: string): void
  setMode(mode: EditorMode): void
}

export type TemplateController = {
  pointer(input: PointerInput): void
  targetAt(screen: Point): Target
  hover(screen: Point | null): void
  contextMenu(screen: Point, target: Target, pointer: PointerKind): void
  wheel(e: WheelInput): void
  gesture(phase: 'start' | 'change' | 'end', scale: number, at: Point): void
  keyDown(e: KeyLike, target?: unknown): boolean
  keyUp(e: KeyLike): boolean
  blur(): void
  isBusy(): boolean
  actions: TemplateActions
  destroy(): void
}

type ActiveDrag =
  | { kind: 'move'; gesture: DocGesture<TemplateDoc>; ids: string[]; startWorld: Point; opening: string | null }
  | { kind: 'vertex'; gesture: DocGesture<TemplateDoc>; id: string; index: number }
  | { kind: 'resize'; gesture: DocGesture<TemplateDoc>; id: string; handle: Handle; grab: Point }
  | { kind: 'rotate'; gesture: DocGesture<TemplateDoc>; id: string }
  | { kind: 'marquee'; startWorld: Point; base: readonly string[]; before: readonly string[] }
  | { kind: 'rect'; startWorld: Point; draw: Parameters<typeof makeFromRect>[0] }
  | { kind: 'pan'; last: Point }

function defaultNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

export function createTemplateController(deps: TemplateControllerDeps): TemplateController {
  const { doc, ui, interaction, view, camera } = deps
  const events = deps.events ?? {}
  const now = deps.now ?? defaultNow
  const setTimer = deps.setTimer ?? ((cb: () => void, ms: number) => setTimeout(cb, ms))

  let machine: MachineState = initialMachineState
  let active: ActiveDrag | null = null
  let spaceHeld = false
  let wheelHistory: WheelHistory = []
  let gestureScale = 1
  let nudgeBurst = { at: -Infinity, key: '', id: 0 }
  let lastPlace: { at: Point; time: number } | null = null
  let destroyed = false

  const gridStep = () => gridStepCm(deps.unit())
  const toWorld = (screen: Point) => camera.screenToWorld(screen)
  const items = () => doc.canvas().items

  function snapped(p: Point, alt = false): Point {
    if (!ui.getState().snap || alt) return p
    const step = gridStep()
    return { x: snapToGrid(p.x, step), y: snapToGrid(p.y, step) }
  }

  function refused() {
    events.onRefused?.()
  }

  function machineContext(): MachineContext {
    const s = ui.getState()
    const selected = new Set(s.selection)
    const drawing = s.tool.kind === 'draw' || s.tool.kind === 'measure'
    // A rectangle tool: one finger drags the rectangle out, as a mouse does.
    const rect = s.tool.kind === 'draw' && drawsRectangle(s.tool.draw) && s.drawing === null
    return {
      mode: s.mode,
      tool: s.tool.kind === 'hand' ? 'hand' : drawing ? 'place' : 'select',
      phoneSelect: s.phoneSelect || rect,
      spaceHeld,
      isSelected: (id) => selected.has(id),
    }
  }

  function edit(label: string, recipe: (d: TemplateDoc) => TemplateDoc, mergeKey?: string): TemplateDoc | null {
    if (!doc.canEdit()) {
      refused()
      return null
    }
    const out = doc.edit(label, recipe, mergeKey ? { mergeKey } : undefined)
    if (out) ui.prune(out)
    return out
  }

  function created(item: FixedItem) {
    const out = edit(`Add ${FIXED_KIND_LABEL[item.type === 'column' && item.shape === 'round' ? 'roundColumn' : item.type].toLowerCase()}`, (d) =>
      addFixedItem(d, item),
    )
    if (!out) return false
    ui.setState({ tool: SELECT, drawing: null, cursor: null })
    ui.select([item.id], isPolyItem(item) ? { itemId: item.id, index: 0 } : null)
    events.onCreated?.(item)
    return true
  }

  // ---------------------------------------------------------------- drawing

  function finishDrawing(): boolean {
    const d = ui.getState().drawing
    if (!d) return false
    const item = makePolyItem(d.kind, d.points, deps.newId())
    if (!item) {
      ui.setState({ drawing: null, cursor: null })
      return false
    }
    return created(item)
  }

  function place(screen: Point) {
    const s = ui.getState()
    const tool = s.tool
    const raw = toWorld(screen)
    if (tool.kind === 'measure') {
      const measure = s.measure.length >= 2 ? [raw] : [...s.measure, raw]
      ui.setState({ measure })
      return
    }
    if (tool.kind !== 'draw') return
    if (!doc.canEdit()) return refused()
    const kind = tool.draw
    const t = now()
    if (drawsPoints(kind)) {
      const d = s.drawing
      const double = lastPlace !== null && t - lastPlace.time <= DOUBLE_CLICK_MS && distance(lastPlace.at, screen) <= DOUBLE_CLICK_PX
      lastPlace = { at: screen, time: t }
      if (d && double) {
        finishDrawing()
        lastPlace = null
        return
      }
      if (d && (kind === 'room' || kind === 'zone') && d.points.length >= 3 && distance(camera.worldToScreen(d.points[0]), screen) <= CLOSE_OUTLINE_PX) {
        finishDrawing()
        return
      }
      const p = snapped(raw)
      ui.setState({ drawing: { kind, points: [...(d?.points ?? []), p] }, cursor: p })
      return
    }
    // Doors and windows go onto the wall nearest the click itself.
    const at = kind === 'door' || kind === 'window' ? raw : snapped(raw)
    const item = makeAtPoint(kind, at, items(), deps.newId())
    if (item) created(item)
  }

  // ---------------------------------------------------------------- drags

  function startDrag(info: DragInfo) {
    endActive('cancel')
    const startWorld = toWorld(info.start)
    const t = info.target
    const s = ui.getState()
    switch (info.drag) {
      case 'move': {
        const ids = s.selection.filter((id) => findItem(doc.canvas(), id))
        if (ids.length === 0) return
        const gesture = doc.begin('Move')
        if (!gesture) return refused()
        const only = ids.length === 1 ? findItem(doc.canvas(), ids[0]) : undefined
        active = { kind: 'move', gesture, ids, startWorld, opening: only && isOpening(only) ? only.id : null }
        interaction.setState({ gesture: 'move' })
        return
      }
      case 'resize': {
        if (t.kind === 'vertex') {
          const item = findItem(doc.canvas(), t.itemId)
          if (!item || !isPolyItem(item)) return
          const gesture = doc.begin('Move point')
          if (!gesture) return refused()
          active = { kind: 'vertex', gesture, id: t.itemId, index: t.index }
          ui.setSegment(null)
          interaction.setState({ gesture: 'vertex' })
          return
        }
        if (t.kind !== 'handle') return
        const item = findItem(doc.canvas(), t.itemId)
        if (!item || !isBoxItem(item)) return
        const gesture = doc.begin('Resize')
        if (!gesture) return refused()
        const h = handlePoint({ ...item, kind: 'shape', type: 'rect', locked: false, style: { stroke: '', fill: '', strokeWidth: 0 } }, t.handle)
        active = { kind: 'resize', gesture, id: item.id, handle: t.handle, grab: { x: startWorld.x - h.x, y: startWorld.y - h.y } }
        interaction.setState({ gesture: 'resize' })
        return
      }
      case 'rotate': {
        if (t.kind !== 'rotate') return
        const gesture = doc.begin('Rotate')
        if (!gesture) return refused()
        active = { kind: 'rotate', gesture, id: t.itemId }
        interaction.setState({ gesture: 'rotate' })
        return
      }
      case 'marquee': {
        const tool = s.tool
        if (tool.kind === 'draw' && drawsRectangle(tool.draw) && s.drawing === null) {
          if (!doc.canEdit()) return refused()
          active = { kind: 'rect', startWorld: snapped(startWorld, info.alt), draw: tool.draw }
          interaction.setState({ gesture: 'rect' })
          return
        }
        if (tool.kind === 'draw' || tool.kind === 'measure') {
          // Drawing point by point: a drag pans, so the far end can be reached.
          active = { kind: 'pan', last: info.start }
          interaction.setState({ gesture: 'pan' })
          return
        }
        const base = info.pressShift ? s.selection : []
        if (!info.pressShift) ui.clearSelection()
        active = { kind: 'marquee', startWorld, base, before: s.selection }
        interaction.setState({ gesture: 'marquee' })
        return
      }
      default:
        return
    }
  }

  function moveDrag(info: DragInfo) {
    const a = active
    if (!a) return
    const world = toWorld(info.at)
    const snap = ui.getState().snap && !info.alt
    switch (a.kind) {
      case 'move': {
        const step = gridStep()
        const rawX = world.x - a.startWorld.x
        const rawY = world.y - a.startWorld.y
        const opening = a.opening
        const dx = snap && !opening ? snapToGrid(rawX, step) : rawX
        const dy = snap && !opening ? snapToGrid(rawY, step) : rawY
        const ok = a.gesture.preview((start) => {
          const moved = moveFixedItems(start, a.ids, dx, dy)
          if (!opening) return moved
          // A door or window dragged along slides on the walls.
          const item = findItem(moved, opening)
          if (!item || !isOpening(item)) return moved
          const on = snap ? snapOpening(item, moved.items) : item
          return on === item ? moved : { ...moved, items: moved.items.map((i) => (i.id === opening ? on : i)) }
        })
        if (!ok) return lost()
        return
      }
      case 'vertex': {
        const p = snap ? snapped(world) : world
        if (!a.gesture.preview((start) => setVertex(start, a.id, a.index, p))) return lost()
        return
      }
      case 'resize': {
        const p = { x: world.x - a.grab.x, y: world.y - a.grab.y }
        const ok = a.gesture.preview((start) => {
          const item = findItem(start, a.id)
          if (!item || !isBoxItem(item)) return start
          const keepRatio = info.shift || (item.type === 'column' && item.shape === 'round' && item.width === item.height)
          const next = resizeBoxItem(item, a.handle, p, { keepRatio, gridStep: snap ? gridStep() : 0 })
          return next === item ? start : { ...start, items: start.items.map((i) => (i.id === a.id ? next : i)) }
        })
        if (!ok) return lost()
        return
      }
      case 'rotate': {
        const ok = a.gesture.preview((start) => {
          const item = findItem(start, a.id)
          if (!item || !(isBoxItem(item) || item.type === 'label')) return start
          const next = rotateFixedItem(item, world, snap ? 15 : null)
          return next === item ? start : { ...start, items: start.items.map((i) => (i.id === a.id ? next : i)) }
        })
        if (!ok) return lost()
        return
      }
      case 'marquee': {
        const box = boxFromCorners(a.startWorld, world)
        ui.select([...a.base, ...fixedItemsInBox(items(), box)])
        interaction.setState({ marquee: box })
        return
      }
      case 'rect': {
        const end = snap ? snapped(world) : world
        interaction.setState({ rect: boxFromCorners(a.startWorld, end) })
        return
      }
      case 'pan': {
        camera.panBy(info.at.x - a.last.x, info.at.y - a.last.y)
        a.last = info.at
        return
      }
    }
  }

  function lost() {
    active = null
    interaction.endGesture()
  }

  function endActive(how: 'commit' | 'cancel') {
    const a = active
    active = null
    if (!a) return
    switch (a.kind) {
      case 'marquee':
        if (how === 'cancel') ui.select(a.before)
        break
      case 'rect': {
        const box: Box | null = interaction.getState().rect
        if (how === 'commit' && box) {
          const item = makeFromRect(a.draw, { x: box.minX, y: box.minY }, { x: box.maxX, y: box.maxY }, deps.newId())
          if (item) created(item)
        }
        break
      }
      case 'pan':
        break
      default:
        if (how === 'commit') a.gesture.commit()
        else a.gesture.cancel()
    }
    interaction.endGesture()
  }

  // ---------------------------------------------------------------- intents

  function apply(intent: Intent) {
    switch (intent.type) {
      case 'select':
        ui.select(intent.ids)
        return
      case 'toggleSelect':
        ui.toggle(intent.id)
        return
      case 'clearSelection':
        ui.clearSelection()
        return
      case 'selectGuest':
        return
      case 'place':
        place(intent.at)
        return
      case 'tap': {
        const t = intent.target
        if (t.kind !== 'item') return
        const item = findItem(doc.canvas(), t.itemId)
        const s = ui.getState()
        if (item && isPolyItem(item) && s.selection.length === 1 && s.selection[0] === item.id) {
          ui.setSegment({ itemId: item.id, index: nearestSegment(item, toWorld(intent.at)) })
        }
        return
      }
      case 'dragStart':
        if (interaction.getState().longPress) interaction.setState({ longPress: null })
        startDrag(intent)
        return
      case 'dragMove':
        moveDrag(intent)
        return
      case 'dragEnd':
        moveDrag(intent)
        endActive('commit')
        return
      case 'dragCancel':
        endActive('cancel')
        return
      case 'panStart':
        interaction.setState({ gesture: 'pan', longPress: null })
        return
      case 'pan':
        camera.panBy(intent.dx, intent.dy)
        return
      case 'panEnd':
      case 'pinchEnd':
        interaction.setState({ gesture: null })
        return
      case 'pinchStart':
        interaction.setState({ gesture: 'pinch', longPress: null })
        return
      case 'pinch':
        camera.panBy(intent.dx, intent.dy)
        camera.zoomAt(intent.center, intent.scale)
        return
      case 'longPress':
        if (ui.getState().tool.kind === 'select') interaction.setState({ longPress: intent.at })
        return
      case 'contextMenu':
        interaction.setState({ longPress: null })
        if (ui.getState().tool.kind !== 'select') return
        events.onContextMenu?.({ at: intent.at, itemId: intent.target.kind === 'item' ? intent.target.itemId : null, pointer: intent.pointer })
        return
      case 'wantTimer': {
        const wait = Math.max(0, intent.at - now())
        setTimer(() => {
          if (!destroyed) feed({ type: 'timer', time: now() })
        }, wait)
        return
      }
    }
  }

  function feed(input: PointerInput) {
    const step = stepPointer(machine, input, machineContext())
    machine = step.state
    for (const intent of step.intents) apply(intent)
    if (!isBusy(machine) && interaction.getState().longPress) interaction.setState({ longPress: null })
  }

  // ---------------------------------------------------------------- actions

  function selectionIds(): string[] {
    return [...ui.getState().selection]
  }

  function viewportCenterWorld(): Point {
    const size = camera.viewportSize()
    return toWorld({ x: size.width / 2, y: size.height / 2 })
  }

  function fitBox(): Box | null {
    return templateBox(doc.canvas(), deps.imageSize?.() ?? null)
  }

  const actions: TemplateActions = {
    undo() {
      if (!doc.canEdit()) {
        refused()
        return false
      }
      const out = doc.undo()
      if (out) ui.prune(out)
      return out !== null
    },
    redo() {
      if (!doc.canEdit()) {
        refused()
        return false
      }
      const out = doc.redo()
      if (out) ui.prune(out)
      return out !== null
    },
    deleteSelection() {
      const ids = selectionIds()
      if (ids.length === 0) return false
      return edit('Delete', (d) => deleteFixedItems(d, ids)) !== null
    },
    duplicateSelection() {
      const ids = selectionIds()
      if (ids.length === 0) return false
      let added: string[] = []
      const step = gridStep()
      const out = edit('Duplicate', (d) => {
        const r = duplicateFixedItems(d, ids, deps.newId, step, step)
        added = r.ids
        return r.doc
      })
      if (out) ui.select(added)
      return out !== null
    },
    selectAll() {
      ui.select(items().map((i) => i.id))
    },
    nudge(direction, big = false) {
      const ids = selectionIds()
      if (ids.length === 0) return false
      const t = now()
      const key = ids.join(',')
      if (t - nudgeBurst.at > NUDGE_BURST_MS || key !== nudgeBurst.key) nudgeBurst = { at: t, key, id: nudgeBurst.id + 1 }
      nudgeBurst.at = t
      const step = gridStep() * (big ? 5 : 1)
      const dx = direction === 'left' ? -step : direction === 'right' ? step : 0
      const dy = direction === 'up' ? -step : direction === 'down' ? step : 0
      return edit('Nudge', (d) => moveFixedItems(d, ids, dx, dy), `nudge:${nudgeBurst.id}`) !== null
    },
    run: (label, recipe, mergeKey) => edit(label, recipe, mergeKey) !== null,
    finishDrawing,
    cancelDrawing() {
      ui.setState({ drawing: null, cursor: null })
    },
    undoPoint() {
      const d = ui.getState().drawing
      if (!d) return
      const points = d.points.slice(0, -1)
      ui.setState({ drawing: points.length ? { ...d, points } : null })
    },
    addAtCenter(kind) {
      if (!doc.canEdit()) {
        refused()
        return null
      }
      const at = kind === 'door' || kind === 'window' ? viewportCenterWorld() : snapped(viewportCenterWorld())
      const item = makeAtPoint(kind, at, items(), deps.newId())
      return item && created(item) ? item.id : null
    },
    zoomIn: () => camera.zoomIn(),
    zoomOut: () => camera.zoomOut(),
    zoomReset: () => camera.zoomReset(),
    zoomFit: () => camera.fit(fitBox()),
    showItem(id) {
      const item = findItem(doc.canvas(), id)
      if (!item) return
      const box = templateBox({ items: [item], reference: null })
      if (box) camera.centerOn({ x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 })
    },
    setMode(mode) {
      if (isBusy(machine)) feed({ type: 'escape' })
      endActive('cancel')
      doc.cancelGesture()
      deps.setMode(mode)
    },
  }

  // ---------------------------------------------------------------- keyboard

  function keyDown(e: KeyLike, target?: unknown): boolean {
    if (e.key === 'Shift' || e.key === 'Alt') {
      if (!isDragging(machine)) return false
      feed({ type: 'modifiers', shift: e.shiftKey, alt: e.altKey })
      return true
    }
    const s = ui.getState()
    if (s.drawing) {
      if (e.key === 'Enter') {
        finishDrawing()
        return true
      }
      if ((e.key === 'Backspace' || e.key === 'Delete') && !e.metaKey && !e.ctrlKey) {
        actions.undoPoint()
        return true
      }
    }
    const command = keyCommand(e)
    if (!command) return false
    switch (command.type) {
      case 'space':
        if (target !== undefined && isPressable(target)) return false
        if (!e.repeat) {
          spaceHeld = true
          interaction.setState({ spacePan: true })
        }
        return true
      case 'escape': {
        if (isBusy(machine)) {
          feed({ type: 'escape' })
          return true
        }
        if (s.drawing) {
          actions.cancelDrawing()
          return true
        }
        if (s.tool.kind !== 'select') {
          ui.setTool(SELECT)
          return true
        }
        if (s.selection.length) {
          ui.clearSelection()
          return true
        }
        return false
      }
      case 'delete':
        if (s.selection.length === 0) return false
        actions.deleteSelection()
        return true
      case 'duplicate':
        actions.duplicateSelection()
        return true
      case 'selectAll':
        actions.selectAll()
        return true
      case 'undo':
        if (isBusy(machine)) feed({ type: 'escape' })
        actions.undo()
        return true
      case 'redo':
        if (isBusy(machine)) feed({ type: 'escape' })
        actions.redo()
        return true
      case 'nudge':
        if (s.selection.length === 0) return false
        if (!isDragging(machine)) actions.nudge(command.direction, command.big)
        return true
      case 'zoomIn':
        actions.zoomIn()
        return true
      case 'zoomOut':
        actions.zoomOut()
        return true
      case 'zoomReset':
        actions.zoomReset()
        return true
      case 'zoomFit':
        actions.zoomFit()
        return true
      default:
        // Copy and paste: Duplicate does that job here.
        return false
    }
  }

  function keyUp(e: KeyLike): boolean {
    if (isSpaceKey(e)) {
      const was = spaceHeld
      spaceHeld = false
      interaction.setState({ spacePan: false })
      return was
    }
    if ((e.key === 'Shift' || e.key === 'Alt') && isDragging(machine)) {
      feed({ type: 'modifiers', shift: e.shiftKey, alt: e.altKey })
      return true
    }
    return false
  }

  function targetAt(screen: Point): Target {
    const tool = ui.getState().tool
    // Drawing tools draw over whatever is there.
    if (tool.kind === 'draw' || tool.kind === 'measure') return EMPTY_TARGET
    const zoom = camera.get().zoom
    const hit = fixedItemAt(items(), toWorld(screen), HIT_TOLERANCE_PX / zoom)
    return hit ? { kind: 'item', itemId: hit.id, itemKind: 'fixed', locked: false } : EMPTY_TARGET
  }

  return {
    pointer: feed,
    targetAt,
    hover(screen) {
      if (isBusy(machine)) return
      const s = ui.getState()
      if (s.tool.kind === 'draw' || s.tool.kind === 'measure') {
        const cursor = screen ? (s.tool.kind === 'draw' && drawsPoints(s.tool.draw) ? snapped(toWorld(screen)) : toWorld(screen)) : null
        ui.setState({ cursor, hover: null })
        return
      }
      if (!screen) {
        if (s.hover !== null) ui.setState({ hover: null })
        return
      }
      const t = targetAt(screen)
      const hover = t.kind === 'item' ? t.itemId : null
      if (hover !== s.hover) ui.setState({ hover })
    },
    contextMenu(screen, target, pointer) {
      if (isBusy(machine)) {
        const id = menuPress(machine)
        if (id === null) return
        feed({ type: 'cancel', id })
        if (isBusy(machine)) return
      }
      if (ui.getState().tool.kind !== 'select') return
      const itemId = target.kind === 'item' ? target.itemId : null
      if (itemId && !ui.getState().selection.includes(itemId)) ui.select([itemId])
      events.onContextMenu?.({ at: screen, itemId, pointer })
    },
    wheel(e) {
      const setting = view.getState().wheel
      const action = classifyWheel(e, wheelHistory, setting)
      wheelHistory = rememberWheel(wheelHistory, e)
      if (action === 'zoom') camera.zoomAt(e.at, wheelZoomFactor(e.deltaY, e.deltaMode, e.ctrlKey))
      else {
        const d = wheelPanDelta(e)
        camera.panBy(d.dx, d.dy)
      }
    },
    gesture(phase, scale, at) {
      if (phase === 'start') {
        gestureScale = 1
        return
      }
      if (!(scale > 0)) return
      const factor = scale / gestureScale
      gestureScale = scale
      if (phase === 'change' && Number.isFinite(factor)) camera.zoomAt(at, factor)
      if (phase === 'end') gestureScale = 1
    },
    keyDown,
    keyUp,
    blur() {
      spaceHeld = false
      interaction.setState({ spacePan: false })
      if (isBusy(machine)) feed({ type: 'escape' })
    },
    isBusy: () => isBusy(machine),
    actions,
    destroy() {
      destroyed = true
      endActive('cancel')
    },
  }
}
