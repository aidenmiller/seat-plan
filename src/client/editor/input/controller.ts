/**
 * The editor controller: the one place pointer, wheel, gesture and keyboard
 * input becomes selection changes, document edits and camera moves (PLAN
 * section 6, "Input", "Selection", "Keyboard", "Snapping and guides"). It
 * has no DOM of its own: dom-adapter.ts feeds it browser events, and panels
 * and buttons call its actions.
 *
 * Every document change goes through the guard (state/editor-doc.ts), so in
 * View mode they are all refused in one place. Drags are gestures: one undo
 * step and one save each.
 *
 * Seating (milestone 5) lives in ../seating/controller.ts. This controller
 * hands it a seated guest's drag, taps while a name waits for a seat (the
 * phone's tap-then-tap) or on an empty seat's +, View mode taps on seats
 * (cards), the hover and Esc, and its actions join these.
 */
import type { Canvas, Item, Table } from '@/domain/canvas-schema'
import {
  boxFromCorners,
  contentBox,
  footprintBox,
  itemBox,
  itemsBox,
  translateBox,
  unionBoxes,
  venueBox,
  type Box,
  type Point,
} from '@/domain/geometry'
import { getPreset, type PresetId } from '@/domain/presets'
import { handlePoint, type Handle } from '@/domain/resize'
import { gridStepCm, snapMove } from '@/domain/snapping'
import { gapText, isNarrowGap, nearestGapAmong } from '@/domain/spacing'
import type { LengthUnit } from '@/domain/units'
import type { FixedItem } from '@/domain/venue-schema'
import { classifyWheel, rememberWheel, wheelPanDelta, wheelZoomFactor, type WheelHistory, type WheelLike } from '@/domain/wheel'
import type { CameraController } from '../camera/camera-controller'
import type { EditorClipboard } from '../clipboard'
import * as cmd from '../commands'
import type { SeatingActions, SeatingController } from '../seating/controller'
import type { DocGesture, EditorDoc } from '../state/editor-doc'
import type { ViewStore } from '../state/device-view'
import { NO_GUIDES, SELECT_TOOL, type EditorMode, type GapReadout, type InteractionStore, type SeatRef, type UiStore } from '../state/ui-store'
import { hitTest, isReachable, isVisible, itemsInBox, selectableIds, type Target } from './hit-test'
import { isPressable, isSpaceKey, keyCommand, type KeyLike } from './keyboard'
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
} from './pointer-machine'

/** Pointer reach for hit testing, in screen px. */
export const HIT_TOLERANCE_PX = 4
/** Arrow-key nudges this close together are one undo step. */
export const NUDGE_BURST_MS = 1000

export type EditorSettings = {
  layoutId: string
  /** The wedding's unit: the grid (1 ft or 0.5 m) and the gap readout. */
  unit: LengthUnit
  /** The wedding's narrowest gap between tables (5 ft unless changed). */
  minGapCm: number
}

export type SeatRequest =
  | { status: 'done' }
  | { status: 'unchanged' }
  /** View mode, or the page cannot edit right now. */
  | { status: 'refused' }
  /**
   * The change would unseat these guests (highest seat numbers first), with
   * their names in the same order ("Guest" for one not in the guest list).
   * Ask, then call confirm().
   */
  | { status: 'confirm'; unseated: string[]; names: string[]; confirm(): boolean }

export type ContextMenuRequest = { at: Point; target: Target; pointer: PointerKind }

export type GuestDragEvent = {
  phase: 'start' | 'move' | 'end' | 'cancel'
  itemId: string
  seatIndex: number
  guestId: string | null
  /** Screen px and world cm. */
  at: Point
  world: Point
}

/** What the rest of the editor hears from the controller. All optional. */
export type EditorEvents = {
  /** Right click, or a touch held 450 ms and lifted. The selection already includes the target. */
  onContextMenu?(request: ContextMenuRequest): void
  /**
   * A click or tap finished (after its selection change): table guest lists.
   * Taps seating takes are not heard here: a seat tap while a name waits for
   * a seat, an empty seat's +, and a View mode tap on a taken seat (its card).
   */
  onTap?(tap: { target: Target; at: Point; pointer: PointerKind }): void
  /** A seated guest is being dragged on the canvas (the seating controller has already taken it). */
  onGuestDrag?(event: GuestDragEvent): void
  /** A change was refused: View mode, or the page cannot edit right now. */
  onRefused?(): void
  /** A short message to show for a few seconds: "Table 4 is full". */
  onNotice?(text: string): void
}

export type ControllerDeps = {
  doc: EditorDoc
  ui: UiStore
  interaction: InteractionStore
  view: ViewStore
  camera: CameraController
  clipboard: EditorClipboard
  settings: () => EditorSettings
  newId: () => string
  /** Switch Edit and View, remembered on this device. */
  setMode: (mode: EditorMode) => void
  events?: EditorEvents
  /** The pointer events' clock (performance.now). */
  now?: () => number
  setTimer?: (callback: () => void, ms: number) => unknown
  /** The venue template's fixed items, for fit to content while the venue layer shows. */
  venueItems?: () => readonly FixedItem[]
  /** Seating guests (../seating/controller.ts). */
  seating: SeatingController
}

export type WheelInput = WheelLike & { at: Point }

export type PresetOptions = {
  /** Alt held on the drop: place exactly there, off the grid. */
  free?: boolean
}

/**
 * Every button, menu and panel action. The seating ones (SeatingActions in
 * ../seating/controller.ts): seatGuest, seatAtTable (returns 'full'),
 * moveGuest, swapGuests, unseatGuest, unseatGuests, unseatSelectedGuests,
 * reorderSeat, panToGuest, openSeatPicker, closeSeatPicker, chooseForSeat,
 * startPick, cancelPick.
 */
export type EditorActions = BaseActions & SeatingActions

type BaseActions = {
  /** Adds a preset at a world point (snapped to the grid unless free), or at the viewport's center. Selects it; returns its id. */
  addPreset(presetId: PresetId, at?: Point | null, options?: PresetOptions): string | null
  /** A preset dropped from the shape panel at a pointer's clientX and clientY ({ free: true } with Alt held). */
  dropPreset(presetId: PresetId, clientX: number, clientY: number, options?: PresetOptions): string | null
  deleteSelection(): boolean
  duplicateSelection(): boolean
  /** Copies the selected items to the clipboard. False with no item selected. */
  copySelection(): boolean
  /**
   * Pastes the clipboard. With a world point (a menu's "Paste" where it
   * opened), the copies' center lands there, moved by whole grid steps when
   * snapping is on so items copied on the grid stay on it. Without one: one
   * grid step on each time (same layout), or at the viewport's center
   * (another layout).
   */
  paste(at?: Point | null): boolean
  selectAll(): void
  undo(): boolean
  redo(): boolean
  nudge(direction: cmd.NudgeDirection, big?: boolean): boolean
  addSeat(tableId: string): SeatRequest
  removeSeat(tableId: string): SeatRequest
  setSeatCount(tableId: string, count: number): SeatRequest
  fitSeats(tableId: string): SeatRequest
  setSeatSides(tableId: string, sides: Table['seatSides']): boolean
  align(mode: cmd.AlignMode): boolean
  distribute(axis: cmd.DistributeAxis): boolean
  bringToFront(): boolean
  sendToBack(): boolean
  /** Locks or unlocks the selection (or the given ids). */
  setLocked(locked: boolean, ids?: readonly string[]): boolean
  renameTable(tableId: string, name: string): boolean
  setTableNumber(tableId: string, number: number): boolean
  setItemBox(id: string, patch: cmd.BoxPatch): boolean
  setLabel(id: string, label: string): boolean
  setStyle(id: string, patch: cmd.StylePatch): boolean
  /** Any other change, as one undo step. */
  run(label: string, recipe: (canvas: Canvas) => Canvas): boolean
  zoomIn(): void
  zoomOut(): void
  zoomReset(): void
  zoomFit(): void
  setMode(mode: EditorMode): void
}

export type EditorController = {
  /** Pointer events, already in screen px (dom-adapter.ts). */
  pointer(input: PointerInput): void
  /** What is under a screen point (items and seats; handles come from the DOM). */
  targetAt(screen: Point): Target
  /** Mouse moving with no button down: hover highlight and, after 150 ms on a taken seat, its card. Null when it leaves the canvas. */
  hover(screen: Point | null): void
  /** Right click (the browser's contextmenu event), at a screen point. */
  contextMenu(screen: Point, target: Target, pointer: PointerKind): void
  wheel(e: WheelInput): void
  /** Safari's trackpad pinch: scale since the gesture began, about a screen point. */
  gesture(phase: 'start' | 'change' | 'end', scale: number, at: Point): void
  /** True when the editor handled the key (the adapter then prevents the browser's use of it). */
  keyDown(e: KeyLike, target?: unknown): boolean
  keyUp(e: KeyLike): boolean
  /** The window lost focus: let go of Space and cancel a drag. */
  blur(): void
  isBusy(): boolean
  actions: EditorActions
  destroy(): void
}

export { nearestGapAmong, type NearestGap } from '@/domain/spacing'

/** The live readout: the gap between table edges in the wedding's unit, warning under the minimum gap. */
export function gapReadout(item: Item, tables: readonly Table[], unit: LengthUnit, minGapCm: number): GapReadout | null {
  if (item.kind !== 'table') return null
  const g = nearestGapAmong(item, tables)
  if (!g) return null
  return { otherId: g.otherId, gapCm: g.gapCm, from: g.from, to: g.to, text: gapText(g.gapCm, unit), warn: isNarrowGap(g.gapCm, minGapCm) }
}

type ActiveDrag =
  | {
      kind: 'move'
      gesture: DocGesture
      ids: string[]
      startWorld: Point
      /** Footprints (chairs and all) for guides; bodies for the grid. */
      startBox: Box
      startBodyBox: Box
      others: Box[]
      tables: Table[]
      primary: string | null
    }
  /** grab: the pointer's offset from the handle's point at the press, kept so a press off its center does not jump. */
  | { kind: 'resize'; gesture: DocGesture; id: string; handle: Handle; grab: Point; tables: Table[] }
  | { kind: 'rotate'; gesture: DocGesture; id: string; tables: Table[] }
  | { kind: 'centerResize'; gesture: DocGesture; id: string; startWorld: Point; tables: Table[] }
  /** base: the selection a Shift box adds to; before: the selection and guest seats to put back on Esc. */
  | { kind: 'marquee'; startWorld: Point; base: readonly string[]; before: { selection: readonly string[]; guestSeats: readonly SeatRef[] } }
  | { kind: 'guest'; itemId: string; seatIndex: number; guestId: string | null; pointer: PointerKind }

function defaultNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

export function createEditorController(deps: ControllerDeps): EditorController {
  const { doc, ui, interaction, view, camera, clipboard, seating } = deps
  const events = deps.events ?? {}
  const now = deps.now ?? defaultNow
  const setTimer = deps.setTimer ?? ((cb: () => void, ms: number) => setTimeout(cb, ms))

  let machine: MachineState = initialMachineState
  let active: ActiveDrag | null = null
  let spaceHeld = false
  let wheelHistory: WheelHistory = []
  let gestureScale = 1
  let nudgeBurst = { at: -Infinity, key: '', id: 0 }
  let destroyed = false

  const gridStep = () => gridStepCm(deps.settings().unit)
  const layers = () => view.getState().layers
  const snapping = (alt: boolean) => ui.getState().snap && !alt
  const toWorld = (screen: Point) => camera.screenToWorld(screen)

  function refused() {
    events.onRefused?.()
  }

  function machineContext(): MachineContext {
    const s = ui.getState()
    const selected = new Set(s.selection)
    return { mode: s.mode, tool: s.tool.kind, phoneSelect: s.phoneSelect, spaceHeld, isSelected: (id) => selected.has(id), picking: seating.isPicking() }
  }

  function tablesExcept(canvas: Canvas, ids: ReadonlySet<string>): Table[] {
    return canvas.items.filter((i): i is Table => i.kind === 'table' && !ids.has(i.id) && isVisible(i, layers()))
  }

  // ---------------------------------------------------------------- drags

  function startDrag(info: DragInfo) {
    endActive('cancel')
    const canvas = doc.canvas()
    const startWorld = toWorld(info.start)
    const t = info.target
    switch (info.drag) {
      case 'move': {
        const selected = new Set(ui.getState().selection)
        const moving = canvas.items.filter((i) => selected.has(i.id) && !i.locked && isReachable(i, layers()))
        if (moving.length === 0) return
        const gesture = doc.begin('Move')
        if (!gesture) return refused()
        const ids = moving.map((i) => i.id)
        const set = new Set(ids)
        const others = canvas.items.filter((i) => !set.has(i.id) && isVisible(i, layers())).map(footprintBox)
        const grabbed = t.kind === 'item' || t.kind === 'seat' ? moving.find((i) => i.id === t.itemId) : undefined
        const movingTables = moving.filter((i) => i.kind === 'table')
        const primary = grabbed?.kind === 'table' ? grabbed.id : movingTables.length === 1 ? movingTables[0].id : null
        active = {
          kind: 'move',
          gesture,
          ids,
          startWorld,
          startBox: itemsBox(moving, footprintBox) as Box,
          startBodyBox: itemsBox(moving, itemBox) as Box,
          others,
          tables: tablesExcept(canvas, set),
          primary,
        }
        interaction.setState({ gesture: 'move' })
        return
      }
      case 'resize':
      case 'rotate':
      case 'centerResize': {
        const id = t.kind === 'empty' ? null : t.itemId
        const from = id ? canvas.items.find((i) => i.id === id) : undefined
        if (!from || from.locked) return
        const label = info.drag === 'rotate' ? 'Rotate' : 'Resize'
        const gesture = doc.begin(label)
        if (!gesture) return refused()
        const tables = tablesExcept(canvas, new Set([from.id]))
        if (info.drag === 'resize' && t.kind === 'handle') {
          const h = handlePoint(from, t.handle)
          active = { kind: 'resize', gesture, id: from.id, handle: t.handle, grab: { x: startWorld.x - h.x, y: startWorld.y - h.y }, tables }
        }
        else if (info.drag === 'rotate') active = { kind: 'rotate', gesture, id: from.id, tables }
        else active = { kind: 'centerResize', gesture, id: from.id, startWorld, tables }
        interaction.setState({ gesture: info.drag })
        return
      }
      case 'marquee': {
        const s = ui.getState()
        const before = { selection: s.selection, guestSeats: s.guestSeats }
        const base = info.pressShift ? s.selection : []
        if (!info.pressShift) ui.clearSelection()
        active = { kind: 'marquee', startWorld, base, before }
        interaction.setState({ gesture: 'marquee' })
        return
      }
      case 'guest': {
        if (t.kind !== 'seat') return
        active = { kind: 'guest', itemId: t.itemId, seatIndex: t.seatIndex, guestId: t.guestId, pointer: info.pointer }
        interaction.setState({ gesture: 'guest' })
        seating.canvasDrag({ phase: 'start', itemId: t.itemId, seatIndex: t.seatIndex, guestId: t.guestId, at: info.at, pointer: info.pointer })
        events.onGuestDrag?.({ phase: 'start', itemId: t.itemId, seatIndex: t.seatIndex, guestId: t.guestId, at: info.at, world: toWorld(info.at) })
        return
      }
    }
  }

  function readoutFor(gesture: DocGesture, id: string, tables: Table[]): GapReadout | null {
    const item = gesture.current().items.find((i) => i.id === id)
    if (!item) return null
    const s = deps.settings()
    return gapReadout(item, tables, s.unit, s.minGapCm)
  }

  function moveDrag(info: DragInfo) {
    const a = active
    if (!a) return
    const world = toWorld(info.at)
    const snap = snapping(info.alt)
    switch (a.kind) {
      case 'move': {
        const rawX = world.x - a.startWorld.x
        const rawY = world.y - a.startWorld.y
        const r = snapMove(translateBox(a.startBox, rawX, rawY), a.others, {
          gridStep: gridStep(),
          zoom: camera.get().zoom,
          snapGrid: snap,
          snapGuides: snap,
          gridBox: translateBox(a.startBodyBox, rawX, rawY),
        })
        const dx = rawX + r.dx
        const dy = rawY + r.dy
        if (!a.gesture.preview((start) => cmd.moveItems(start, a.ids, dx, dy))) return lost()
        interaction.setState({ guides: r.guides.length ? r.guides : NO_GUIDES, gap: a.primary ? readoutFor(a.gesture, a.primary, a.tables) : null })
        return
      }
      case 'resize': {
        // Where the handle's point would be, then the raw size rounded to whole grid steps (raw with Alt).
        const p = { x: world.x - a.grab.x, y: world.y - a.grab.y }
        const keepRatio = info.shift || ui.getState().keepProportions
        const options = { keepRatio, gridStep: snap ? gridStep() : 0 }
        // Each frame starts from the drag's start canvas, so seats the server emptied meanwhile stay empty.
        if (!a.gesture.preview((start) => cmd.resizeItem(start, a.id, a.handle, p, options))) return lost()
        interaction.setState({ gap: readoutFor(a.gesture, a.id, a.tables) })
        return
      }
      case 'rotate': {
        if (!a.gesture.preview((start) => cmd.rotateItem(start, a.id, world, snap ? 15 : null))) return lost()
        interaction.setState({ gap: readoutFor(a.gesture, a.id, a.tables) })
        return
      }
      case 'centerResize': {
        if (!a.gesture.preview((start) => cmd.resizeItemFromCenter(start, a.id, a.startWorld, world))) return lost()
        interaction.setState({ gap: readoutFor(a.gesture, a.id, a.tables) })
        return
      }
      case 'marquee': {
        const box = boxFromCorners(a.startWorld, world)
        const inside = itemsInBox(doc.canvas(), box, layers())
        ui.select([...a.base, ...inside])
        interaction.setState({ marquee: box })
        return
      }
      case 'guest':
        seating.canvasDrag({ phase: 'move', itemId: a.itemId, seatIndex: a.seatIndex, guestId: a.guestId, at: info.at, pointer: a.pointer })
        events.onGuestDrag?.({ phase: 'move', itemId: a.itemId, seatIndex: a.seatIndex, guestId: a.guestId, at: info.at, world })
        return
    }
  }

  /** The document changed under the drag, or editing turned off: drop it. */
  function lost() {
    active = null
    interaction.endGesture()
  }

  function endActive(how: 'commit' | 'cancel', info?: DragInfo) {
    const a = active
    active = null
    if (!a) return
    if (a.kind === 'guest') {
      const at = info?.at ?? { x: 0, y: 0 }
      const phase = how === 'commit' ? 'end' : 'cancel'
      seating.canvasDrag({ phase, itemId: a.itemId, seatIndex: a.seatIndex, guestId: a.guestId, at, pointer: a.pointer })
      events.onGuestDrag?.({ phase, itemId: a.itemId, seatIndex: a.seatIndex, guestId: a.guestId, at, world: toWorld(at) })
    } else if (a.kind === 'marquee') {
      if (how === 'cancel') ui.setState({ selection: a.before.selection, guestSeats: a.before.guestSeats })
    } else if (how === 'commit') {
      a.gesture.commit()
    } else {
      a.gesture.cancel()
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
        ui.selectSeat({ itemId: intent.itemId, seatIndex: intent.seatIndex }, intent.toggle)
        return
      case 'place': {
        const tool = ui.getState().tool
        if (tool.kind !== 'place') return
        ui.setTool(SELECT_TOOL)
        actions.addPreset(tool.presetId, toWorld(intent.at))
        return
      }
      case 'tap':
        // Tap-then-tap and the + on empty seats take the tap; View mode taps on seats show cards.
        if (seating.canvasTap(intent.target, intent.at, intent.pointer)) return
        events.onTap?.({ target: intent.target, at: intent.at, pointer: intent.pointer })
        return
      case 'dragStart':
        if (interaction.getState().longPress) interaction.setState({ longPress: null })
        startDrag(intent)
        return
      case 'dragMove':
        moveDrag(intent)
        return
      case 'dragEnd':
        moveDrag(intent)
        endActive('commit', intent)
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
        interaction.setState({ longPress: intent.at })
        return
      case 'contextMenu':
        interaction.setState({ longPress: null })
        events.onContextMenu?.({ at: intent.at, target: intent.target, pointer: intent.pointer })
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
    if (input.type === 'down') seating.canvasPress()
    const step = stepPointer(machine, input, machineContext())
    machine = step.state
    for (const intent of step.intents) apply(intent)
    if (!isBusy(machine) && interaction.getState().longPress) interaction.setState({ longPress: null })
  }

  // ---------------------------------------------------------------- actions

  function edit(label: string, recipe: (canvas: Canvas) => Canvas, options?: { mergeKey?: string }): Canvas | null {
    if (!doc.canEdit()) {
      refused()
      return null
    }
    const out = doc.edit(label, recipe, options)
    if (out) ui.prune(out)
    return out
  }

  function selection(): string[] {
    return [...ui.getState().selection]
  }

  function viewportCenterWorld(): Point {
    const size = camera.viewportSize()
    return toWorld({ x: size.width / 2, y: size.height / 2 })
  }

  /** A point a grid step on from any item already centered there, so repeated adds do not stack. */
  function freePoint(canvas: Canvas, p: Point): Point {
    const step = gridStep()
    let q = p
    for (let i = 0; i < 20; i++) {
      if (!canvas.items.some((item) => Math.abs(item.x - q.x) < 1 && Math.abs(item.y - q.y) < 1)) return q
      q = { x: q.x + step, y: q.y + step }
    }
    return q
  }

  function seatRequest(label: string, run: (canvas: Canvas, allowUnseat: boolean) => cmd.SeatChange): SeatRequest {
    if (!doc.canEdit()) {
      refused()
      return { status: 'refused' }
    }
    const dry = run(doc.canvas(), false)
    if (dry.refused) {
      return {
        status: 'confirm',
        unseated: dry.unseated,
        names: seating.guestNames(dry.unseated),
        confirm: () => edit(label, (c) => run(c, true).canvas) !== null,
      }
    }
    return edit(label, (c) => run(c, false).canvas) ? { status: 'done' } : { status: 'unchanged' }
  }

  /** What fit to content frames: the visible items, and the venue's fixed items while that layer shows. */
  function fitBox(): Box | null {
    const items = doc.canvas().items.filter((i) => isVisible(i, layers()))
    const venue = layers().venue.visible ? venueBox(deps.venueItems?.() ?? []) : null
    return unionBoxes([contentBox({ items }), venue])
  }

  const actions: EditorActions = {
    ...seating.actions,
    addPreset(presetId, at, options) {
      const base = at ?? viewportCenterWorld()
      const p = ui.getState().snap && !options?.free ? cmd.snapPoint(base, gridStep()) : base
      const id = deps.newId()
      const label = `Add ${getPreset(presetId).label.toLowerCase()}`
      const out = edit(label, (c) => cmd.addItem(c, presetId, freePoint(c, p), id))
      if (!out) return null
      ui.select([id])
      return id
    },
    dropPreset(presetId, clientX, clientY, options) {
      camera.measure()
      return actions.addPreset(presetId, toWorld(camera.clientToScreen(clientX, clientY)), options)
    },
    deleteSelection() {
      const ids = selection()
      if (ids.length === 0) return false
      return edit('Delete', (c) => cmd.deleteItems(c, ids)) !== null
    },
    duplicateSelection() {
      const ids = selection()
      if (ids.length === 0) return false
      let added: string[] = []
      const out = edit('Duplicate', (c) => {
        const r = cmd.duplicateItems(c, ids, deps.newId, gridStep())
        added = r.ids
        return r.canvas
      })
      if (out) ui.select(added)
      return out !== null
    },
    copySelection() {
      const items = cmd.itemsByIds(doc.canvas(), selection())
      if (items.length === 0) return false
      clipboard.write(items, deps.settings().layoutId)
      return true
    },
    paste(at) {
      const data = clipboard.read()
      if (!data) return false
      const step = gridStep()
      let placement: cmd.PastePlacement
      if (at) placement = { at, gridStep: ui.getState().snap ? step : 0 }
      else if (data.layoutId === deps.settings().layoutId) {
        const n = clipboard.pasteCount(data.copyId) + 1
        placement = { offset: { x: n * step, y: n * step } }
      } else placement = { at: viewportCenterWorld(), gridStep: ui.getState().snap ? step : 0 }
      let added: string[] = []
      const out = edit('Paste', (c) => {
        const r = cmd.pasteItems(c, data.items, deps.newId, placement)
        added = r.ids
        return r.canvas
      })
      if (!out) return false
      if (!at && data.layoutId === deps.settings().layoutId) clipboard.notePaste(data.copyId)
      ui.select(added)
      return true
    },
    selectAll() {
      ui.select(selectableIds(doc.canvas(), layers()))
    },
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
    nudge(direction, big = false) {
      const ids = selection()
      if (ids.length === 0) return false
      const t = now()
      const key = ids.join(',')
      if (t - nudgeBurst.at > NUDGE_BURST_MS || key !== nudgeBurst.key) nudgeBurst = { at: t, key, id: nudgeBurst.id + 1 }
      nudgeBurst.at = t
      return edit('Nudge', (c) => cmd.nudgeItems(c, ids, direction, gridStep(), big), { mergeKey: `nudge:${nudgeBurst.id}` }) !== null
    },
    addSeat(tableId) {
      if (!doc.canEdit()) {
        refused()
        return { status: 'refused' }
      }
      return edit('Add seat', (c) => cmd.addSeat(c, tableId)) ? { status: 'done' } : { status: 'unchanged' }
    },
    removeSeat: (tableId) => seatRequest('Remove seat', (c, allowUnseat) => cmd.removeSeat(c, tableId, { allowUnseat })),
    setSeatCount: (tableId, count) => seatRequest('Change seats', (c, allowUnseat) => cmd.setSeatCount(c, tableId, count, { allowUnseat })),
    fitSeats: (tableId) => seatRequest('Fit seats', (c, allowUnseat) => cmd.fitSeats(c, tableId, { allowUnseat })),
    setSeatSides: (tableId, sides) => edit('Change seat sides', (c) => cmd.setSeatSides(c, tableId, sides)) !== null,
    align: (mode) => edit('Align', (c) => cmd.alignItems(c, selection(), mode)) !== null,
    distribute: (axis) => edit('Distribute', (c) => cmd.distributeItems(c, selection(), axis)) !== null,
    bringToFront: () => edit('Bring to front', (c) => cmd.bringToFront(c, selection())) !== null,
    sendToBack: () => edit('Send to back', (c) => cmd.sendToBack(c, selection())) !== null,
    setLocked(locked, ids) {
      const target = ids ?? selection()
      return edit(locked ? 'Lock' : 'Unlock', (c) => cmd.setLocked(c, target, locked)) !== null
    },
    renameTable: (id, name) => edit('Rename table', (c) => cmd.renameTable(c, id, name)) !== null,
    setTableNumber: (id, n) => edit('Change table number', (c) => cmd.setTableNumber(c, id, n)) !== null,
    setItemBox: (id, patch) => edit('Change size', (c) => cmd.setItemBox(c, id, patch)) !== null,
    setLabel: (id, label) => edit('Change label', (c) => cmd.setLabel(c, id, label)) !== null,
    setStyle: (id, patch) => edit('Change style', (c) => cmd.setStyle(c, id, patch)) !== null,
    run: (label, recipe) => edit(label, recipe) !== null,
    zoomIn: () => camera.zoomIn(),
    zoomOut: () => camera.zoomOut(),
    zoomReset: () => camera.zoomReset(),
    zoomFit: () => camera.fit(fitBox()),
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
        // A list drag, the + picker, tap-then-tap or a card go first.
        if (seating.escape()) return true
        const s = ui.getState()
        if (s.tool.kind !== 'select') {
          ui.setTool(SELECT_TOOL)
          return true
        }
        if (s.selection.length || s.guestSeats.length) {
          ui.clearSelection()
          return true
        }
        return false
      }
      case 'delete':
        if (ui.getState().selection.length === 0) return false
        actions.deleteSelection()
        return true
      case 'copy':
        return actions.copySelection()
      case 'paste':
        return actions.paste()
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
        if (ui.getState().selection.length === 0) return false
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

  /**
   * What is under a screen point. A taken seat right under the pointer wins;
   * otherwise an empty seat's + within 22 px (a 44 px target) is that seat,
   * marked plus, as long as the pointer is not on another item (a
   * neighbouring fixture or table keeps its presses); otherwise the item or
   * seat hit.
   */
  function targetAt(screen: Point): Target {
    const zoom = camera.get().zoom
    const hit = hitTest(doc.canvas(), toWorld(screen), { tolerance: HIT_TOLERANCE_PX / zoom, layers: layers() })
    if (hit.kind === 'seat' && hit.guestId !== null) return hit
    const plus = seating.plusAt(screen)
    if (!plus) return hit
    if ((hit.kind === 'item' || hit.kind === 'seat') && hit.itemId !== plus.itemId) return hit
    const item = doc.canvas().items.find((i) => i.id === plus.itemId)
    if (!item || (item.kind !== 'table' && item.kind !== 'chairRow')) return hit
    const target: Target = { kind: 'seat', itemId: plus.itemId, seatIndex: plus.seatIndex, guestId: null, locked: item.locked, plus: true }
    return item.kind === 'chairRow' ? { ...target, itemKind: 'chairRow' } : target
  }

  return {
    pointer: feed,
    targetAt,
    hover(screen) {
      if (isBusy(machine)) return
      if (!screen) {
        ui.setHover(null)
        seating.hover(null)
        return
      }
      const t = targetAt(screen)
      if (t.kind === 'item') ui.setHover({ kind: 'item', itemId: t.itemId })
      else if (t.kind === 'seat') ui.setHover({ kind: 'seat', itemId: t.itemId, seatIndex: t.seatIndex })
      else ui.setHover(null)
      seating.hover(t)
    },
    contextMenu(screen, target, pointer) {
      if (isBusy(machine)) {
        // macOS and Linux send this while the button is still down (right
        // press, or Ctrl+click on a Mac): drop that press, so its release
        // is no click, and open the menu. Any other gesture keeps going.
        const id = menuPress(machine)
        if (id === null) return
        feed({ type: 'cancel', id })
        if (isBusy(machine)) return
      }
      const s = ui.getState()
      if (target.kind === 'seat' && target.guestId !== null) {
        if (!s.guestSeats.some((g) => g.itemId === target.itemId && g.seatIndex === target.seatIndex)) {
          ui.selectSeat({ itemId: target.itemId, seatIndex: target.seatIndex })
        }
      } else if ((target.kind === 'item' || target.kind === 'seat') && !s.selection.includes(target.itemId)) {
        ui.select([target.itemId])
      }
      events.onContextMenu?.({ at: screen, target, pointer })
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
