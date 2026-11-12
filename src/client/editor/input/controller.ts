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
 *
 * Notes (spec section 9): a note tool places a note with a click or tap and
 * draws one with a drag (an arrow or line from start to end, its ends
 * attaching to the tables or fixtures they land on unless Alt is held; any
 * other note as the box dragged out). An arrow's end handles (vertex
 * targets 0 and 1) move its ends the same way. Enter, or a tap on the
 * selected sticky or text note, starts typing into it; Esc, a press on the
 * canvas or leaving Edit mode ends it, saving the text as one undo step.
 * Nothing on a hidden or locked notes layer changes (PLAN change 1): those
 * changes are refused, naming the reason. In Edit mode a click or tap goes
 * through a locked note to what is under it; the Notes tab still selects
 * one to read.
 */
import type { Canvas, Item, Note, Table } from '@/domain/canvas-schema'
import { attachTargetAt, detachOutside, isArrowNote, otherEnd, resolvedItems, type ArrowEnd, type AttachTarget } from '@/domain/arrows'
import {
  boxCenter,
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
import { blockDepth, ROW_PITCH_CM, type SeatingBlockOptions } from '@/domain/ceremony'
import { isTextNote, NOTE_TYPE_NAMES, noteBounds, type NoteAuthor, type NoteColor, type NoteType } from '@/domain/notes'
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
import { hitTest, isReachable, isVisible, itemLayer, itemsInBox, selectableIds, unlockedLayers, type Target } from './hit-test'
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
/** How far from an arrow or line a finger may land and still pick it, in screen px (half a 44 px tap target). */
export const TOUCH_LINE_REACH_PX = 22
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

/**
 * Why a change was refused when it was not View mode or the page's own gate:
 * the notes layer is hidden or locked, or another layer is locked.
 */
export type RefusalReason = 'notesHidden' | 'notesLocked' | 'layerLocked'

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
  /** A change was refused: View mode or the page cannot edit right now (no reason), or the reason given. */
  onRefused?(reason?: RefusalReason): void
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
  /** The signed-in user (name and account id). New notes record it; without it (the share viewer) note tools are refused. */
  author?: () => NoteAuthor
  /** The wall clock in ms (Date.now), for a new note's createdAt. */
  wallClock?: () => number
}

export type WheelInput = WheelLike & { at: Point }

export type PresetOptions = {
  /** Alt held on the drop: place exactly there, off the grid. */
  free?: boolean
}

export type NoteOptions = PresetOptions & {
  /** The color; the last one picked (ui noteColor) when left out. */
  color?: NoteColor
  /** Start typing into a new sticky or text note. Default true. */
  edit?: boolean
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
  /** The seating block tool: the block centered in the view, its rows selected. Returns their ids. */
  addSeatingBlock(options: Omit<SeatingBlockOptions, 'origin' | 'facing'>): string[]
  /** A new row behind the row's block, selected. Returns its id. */
  addRowBehind(rowId: string): string | null
  /** Selects every row of the row's block. */
  selectBlock(rowId: string): void
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
  // ---- notes (spec section 9). Each change is one undo step and one save; refused in View mode and on a hidden or locked notes layer.
  /** Adds a note centered at a world point (snapped unless free), or at the viewport's center. Selects it; returns its id. */
  addNote(type: NoteType, at?: Point | null, options?: NoteOptions): string | null
  /**
   * Arms the note tool: the next click places this type, a drag draws it.
   * Null goes back to select. Refused (false) in View mode, on a hidden or
   * locked notes layer, or with nobody picked as the author.
   */
  setNoteTool(type: NoteType | null): boolean
  /** Colors the given notes (the selected ones by default) and remembers the color for new notes. */
  setNoteColor(color: NoteColor, ids?: readonly string[]): boolean
  setNoteText(id: string, text: string): boolean
  setNoteDone(ids: string | readonly string[], done: boolean): boolean
  toggleNoteDone(id: string): boolean
  /** Attaches an arrow's end to a table or fixture. */
  attachArrowEnd(id: string, end: ArrowEnd, targetId: string): boolean
  /** Lets an arrow's end go, leaving it where it is drawn. */
  detachArrowEnd(id: string, end: ArrowEnd): boolean
  /** Starts typing into a sticky or text note (the one selected by default). The draft is ui noteEdit. */
  startNoteEdit(id?: string): boolean
  /** Ends typing and saves the draft as one undo step. False when nothing changed. */
  finishNoteEdit(): boolean
  /** Ends typing and drops the draft. */
  cancelNoteEdit(): void
  /** The Notes tab: selects the note and pans to it, showing the notes layer if it was hidden. Works in View mode. */
  focusNote(id: string): boolean
}

export type EditorController = {
  /** Pointer events, already in screen px (dom-adapter.ts). */
  pointer(input: PointerInput): void
  /** What is under a screen point (items and seats; handles come from the DOM). A finger reaches further to an arrow or line. */
  targetAt(screen: Point, pointer?: PointerKind): Target
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
  /** A note tool drag; startOn: the table or fixture an arrow starts on. */
  | {
      kind: 'draw'
      gesture: DocGesture
      id: string
      type: NoteType
      color: NoteColor
      author: NoteAuthor
      createdAt: number
      startWorld: Point
      startOn: string | null
    }
  /** An arrow's end handle. */
  | { kind: 'arrowEnd'; gesture: DocGesture; id: string; end: ArrowEnd }

function defaultNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

export function createEditorController(deps: ControllerDeps): EditorController {
  const { doc, ui, interaction, view, camera, clipboard, seating } = deps
  const events = deps.events ?? {}
  const now = deps.now ?? defaultNow
  const wallClock = deps.wallClock ?? Date.now
  const setTimer = deps.setTimer ?? ((cb: () => void, ms: number) => setTimeout(cb, ms))

  let machine: MachineState = initialMachineState
  let active: ActiveDrag | null = null
  let spaceHeld = false
  let wheelHistory: WheelHistory = []
  let gestureScale = 1
  let nudgeBurst = { at: -Infinity, key: '', id: 0 }
  let destroyed = false
  /** The item a press began on when it was already the only one selected (a second tap on a note types into it). */
  let pressedSole: string | null = null

  const gridStep = () => gridStepCm(deps.settings().unit)
  const layers = () => view.getState().layers
  const snapping = (alt: boolean) => ui.getState().snap && !alt
  const toWorld = (screen: Point) => camera.screenToWorld(screen)

  function refused(reason?: RefusalReason) {
    events.onRefused?.(reason)
  }

  const currentAuthor = () => deps.author?.() ?? null

  function findItem(id: string): Item | undefined {
    return doc.canvas().items.find((i) => i.id === id)
  }

  function findNote(id: string): Note | null {
    const item = findItem(id)
    return item?.kind === 'note' ? item : null
  }

  /** Why nothing on the notes layer can change now, or null. */
  function notesBlock(): RefusalReason | null {
    const l = layers().notes
    if (!l.visible) return 'notesHidden'
    return l.locked ? 'notesLocked' : null
  }

  /** Edit mode, the page can edit, and the notes layer shows and is unlocked. Refuses (naming why) otherwise. */
  function guardNotes(): boolean {
    if (!doc.canEdit()) {
      refused()
      return false
    }
    const block = notesBlock()
    if (block) {
      refused(block)
      return false
    }
    return true
  }

  /**
   * The ids whose items can change: on a layer that shows and is unlocked.
   * Null (refused, naming why) when editing is off, or when every item was
   * on a hidden or locked layer.
   */
  function changeableIds(ids: readonly string[]): string[] | null {
    if (!doc.canEdit()) {
      refused()
      return null
    }
    const l = layers()
    const set = new Set(ids)
    const out: string[] = []
    let blocked: Item | null = null
    for (const item of doc.canvas().items) {
      if (!set.has(item.id)) continue
      if (isReachable(item, l)) out.push(item.id)
      else blocked ??= item
    }
    if (out.length === 0 && blocked) {
      const layer = itemLayer(blocked)
      refused(layer === 'notes' ? (l.notes.visible ? 'notesLocked' : 'notesHidden') : 'layerLocked')
      return null
    }
    return out
  }

  /** The topmost visible table or fixture under a world point, chairs included, leaving out `exclude`. */
  function attachTargetFor(canvas: Canvas, world: Point, exclude: readonly (string | null)[]): AttachTarget | null {
    const l = layers()
    const tolerance = HIT_TOLERANCE_PX / camera.get().zoom
    return attachTargetAt(canvas, world, tolerance, (item) => isVisible(item, l) && !exclude.includes(item.id))
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
        // Arrows where they are drawn, so their boxes are what is on screen.
        const items = resolvedItems(canvas)
        const moving = items.filter((i) => selected.has(i.id) && !i.locked && isReachable(i, layers()))
        if (moving.length === 0) return
        const gesture = doc.begin('Move')
        if (!gesture) return refused()
        const ids = moving.map((i) => i.id)
        const set = new Set(ids)
        const others = items.filter((i) => !set.has(i.id) && isVisible(i, layers())).map(footprintBox)
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
        if (!from || from.locked || !isReachable(from, layers())) return
        if (t.kind === 'vertex') {
          // An arrow's end handle: 0 is the start, 1 the end.
          if (!isArrowNote(from) || info.drag !== 'resize') return
          const gesture = doc.begin('Move arrow end')
          if (!gesture) return refused()
          active = { kind: 'arrowEnd', gesture, id: from.id, end: t.index === 0 ? 'start' : 'end' }
          interaction.setState({ gesture: 'resize' })
          return
        }
        // Arrows and lines change by their ends only.
        if (isArrowNote(from)) return
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
      case 'draw': {
        const tool = ui.getState().tool
        if (tool.kind !== 'note' || !guardNotes()) return
        const author = currentAuthor()
        if (!author) return refused()
        const gesture = doc.begin(`Add ${NOTE_TYPE_NAMES[tool.noteType].toLowerCase()}`)
        if (!gesture) return refused()
        const id = deps.newId()
        const arrow = tool.noteType === 'arrow' || tool.noteType === 'line'
        const startOn = arrow && !info.alt ? (attachTargetFor(canvas, startWorld, [id])?.id ?? null) : null
        active = {
          kind: 'draw',
          gesture,
          id,
          type: tool.noteType,
          color: ui.getState().noteColor,
          author,
          createdAt: wallClock(),
          startWorld,
          startOn,
        }
        interaction.setState({ gesture: 'draw' })
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
      case 'draw': {
        const step = snap ? gridStep() : 0
        const snapIf = (p: Point) => cmd.snapPoint(p, step)
        const type = a.type
        if (type === 'arrow' || type === 'line') {
          // Ends on a table or fixture attach to it (Alt: free); free ends snap to the grid.
          const target = info.alt ? null : attachTargetFor(a.gesture.start, world, [a.id, a.startOn])
          const start = a.startOn ? a.startWorld : snapIf(a.startWorld)
          const end = target ? world : snapIf(world)
          const spec = { id: a.id, type, start, end, startOn: a.startOn, endOn: target?.id ?? null, author: a.author, color: a.color, now: a.createdAt }
          if (!a.gesture.preview((c) => cmd.addArrow(c, spec))) return lost()
          interaction.setState({ attachTarget: target?.id ?? null })
          return
        }
        // The box dragged out; a drag that makes no box gives the default size.
        const box = boxFromCorners(snapIf(a.startWorld), snapIf(world))
        const spec = {
          id: a.id,
          type,
          at: boxCenter(box),
          size: { width: box.maxX - box.minX, height: box.maxY - box.minY },
          author: a.author,
          color: a.color,
          now: a.createdAt,
        }
        if (!a.gesture.preview((c) => cmd.addNote(c, spec))) return lost()
        return
      }
      case 'arrowEnd': {
        const note = a.gesture.start.items.find((i) => i.id === a.id)
        if (!isArrowNote(note)) return lost()
        // Onto a table or fixture (not the one the other end holds) it attaches; Alt keeps it free.
        const target = info.alt ? null : attachTargetFor(a.gesture.start, world, [note.id, note.attachedTo[otherEnd(a.end)]])
        const p = target ? world : cmd.snapPoint(world, snap ? gridStep() : 0)
        if (!a.gesture.preview((start) => cmd.moveArrowEnd(start, a.id, a.end, p, target?.id ?? null))) return lost()
        interaction.setState({ attachTarget: target?.id ?? null })
        return
      }
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
    } else if (a.kind === 'draw') {
      if (how === 'commit' && a.gesture.commit()) {
        ui.setTool(SELECT_TOOL)
        ui.select([a.id])
        if (isTextNote({ type: a.type })) beginEdit(a.id)
      } else if (how === 'cancel') {
        a.gesture.cancel()
      }
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
        if (tool.kind === 'note') {
          ui.setTool(SELECT_TOOL)
          actions.addNote(tool.noteType, toWorld(intent.at), { free: intent.alt })
          return
        }
        if (tool.kind !== 'place') return
        ui.setTool(SELECT_TOOL)
        actions.addPreset(tool.presetId, toWorld(intent.at), { free: intent.alt })
        return
      }
      case 'tap':
        // Tap-then-tap and the + on empty seats take the tap; View mode taps on seats show cards.
        if (seating.canvasTap(intent.target, intent.at, intent.pointer)) return
        events.onTap?.({ target: intent.target, at: intent.at, pointer: intent.pointer })
        editOnSecondTap(intent.target)
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

  /** Pointer input from outside. A press ends typing into a note first (saving it). */
  function pointer(input: PointerInput) {
    if (input.type === 'down') {
      if (ui.getState().noteEdit) actions.finishNoteEdit()
      const s = ui.getState()
      const t = input.target
      pressedSole = t.kind === 'item' && s.selection.length === 1 && s.selection[0] === t.itemId ? t.itemId : null
    }
    feed(input)
  }

  /**
   * A tap on the sticky or text note that was already the only one selected
   * starts typing into it. A locked note takes text too (DECISIONS 56); a
   * locked notes layer does not.
   */
  function editOnSecondTap(target: Target) {
    const sole = pressedSole
    pressedSole = null
    if (target.kind !== 'item' || target.itemId !== sole) return
    const s = ui.getState()
    if (s.mode !== 'edit' || s.phoneSelect || s.noteEdit || s.selection.length !== 1 || s.selection[0] !== sole) return
    const note = findNote(sole)
    if (note && isTextNote(note) && notesBlock() === null && doc.canEdit()) beginEdit(note.id)
  }

  /** Starts typing into a note (checks done by the caller). */
  function beginEdit(id: string) {
    const note = findNote(id)
    if (!note) return
    ui.beginNoteEdit(note.id, note.text)
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

  /** What fit to content frames: the visible items (arrows as drawn), and the venue's fixed items while that layer shows. */
  function fitBox(): Box | null {
    const items = resolvedItems(doc.canvas()).filter((i) => isVisible(i, layers()))
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
    addSeatingBlock(options) {
      const center = viewportCenterWorld()
      const depth = blockDepth(options.rows, options.rowPitchCm ?? ROW_PITCH_CM)
      const origin = ui.getState().snap ? cmd.snapPoint({ x: center.x, y: center.y - depth / 2 }, gridStep()) : { x: center.x, y: center.y - depth / 2 }
      let added: string[] = []
      const out = edit('Add seating block', (c) => {
        const r = cmd.addSeatingBlock(c, { ...options, origin, facing: 0 }, deps.newId)
        added = r.ids
        return r.canvas
      })
      if (!out) return []
      ui.select(added)
      return added
    },
    addRowBehind(rowId) {
      const id = deps.newId()
      const out = edit('Add row', (c) => cmd.addRowBehind(c, rowId, id).canvas)
      if (!out) return null
      ui.select([id])
      return id
    },
    selectBlock(rowId) {
      const ids = cmd.blockRowIds(doc.canvas(), rowId)
      if (ids.length > 0) ui.select(ids)
    },
    deleteSelection() {
      if (selection().length === 0) return false
      const ids = changeableIds(selection())
      if (!ids || ids.length === 0) return false
      return edit('Delete', (c) => cmd.deleteItems(c, ids)) !== null
    },
    duplicateSelection() {
      if (selection().length === 0) return false
      const ids = changeableIds(selection())
      if (!ids || ids.length === 0) return false
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
      const canvas = doc.canvas()
      // Arrows let go of items not copied with them, where they are drawn now.
      const items = detachOutside(cmd.itemsByIds(canvas, selection()), canvas)
      if (items.length === 0) return false
      clipboard.write(items, deps.settings().layoutId)
      return true
    },
    paste(at) {
      const read = clipboard.read()
      if (!read) return false
      // Notes stay out while the notes layer is hidden or locked.
      const block = notesBlock()
      const data = block ? { ...read, items: read.items.filter((i) => i.kind !== 'note') } : read
      if (data.items.length === 0) {
        if (!doc.canEdit()) refused()
        else if (block) refused(block)
        return false
      }
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
      if (selection().length === 0) return false
      const ids = changeableIds(selection())
      if (!ids || ids.length === 0) return false
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
    align: (mode) => withChangeable(selection(), (ids) => edit('Align', (c) => cmd.alignItems(c, ids, mode))),
    distribute: (axis) => withChangeable(selection(), (ids) => edit('Distribute', (c) => cmd.distributeItems(c, ids, axis))),
    bringToFront: () => withChangeable(selection(), (ids) => edit('Bring to front', (c) => cmd.bringToFront(c, ids))),
    sendToBack: () => withChangeable(selection(), (ids) => edit('Send to back', (c) => cmd.sendToBack(c, ids))),
    setLocked(locked, ids) {
      return withChangeable(ids ?? selection(), (target) => edit(locked ? 'Lock' : 'Unlock', (c) => cmd.setLocked(c, target, locked)))
    },
    renameTable: (id, name) => edit('Rename table', (c) => cmd.renameTable(c, id, name)) !== null,
    setTableNumber: (id, n) => edit('Change table number', (c) => cmd.setTableNumber(c, id, n)) !== null,
    setItemBox: (id, patch) => withChangeable([id], () => edit('Change size', (c) => cmd.setItemBox(c, id, patch))),
    setLabel: (id, label) => withChangeable([id], () => edit('Change label', (c) => cmd.setLabel(c, id, label))),
    setStyle: (id, patch) => withChangeable([id], () => edit('Change style', (c) => cmd.setStyle(c, id, patch))),
    run: (label, recipe) => edit(label, recipe) !== null,
    zoomIn: () => camera.zoomIn(),
    zoomOut: () => camera.zoomOut(),
    zoomReset: () => camera.zoomReset(),
    zoomFit: () => camera.fit(fitBox()),
    setMode(mode) {
      if (isBusy(machine)) feed({ type: 'escape' })
      endActive('cancel')
      // Typing into a note is saved before View mode refuses changes.
      actions.finishNoteEdit()
      doc.cancelGesture()
      deps.setMode(mode)
    },

    // ---------------------------------------------------------------- notes

    addNote(type, at, options) {
      if (!guardNotes()) return null
      const author = currentAuthor()
      if (!author) {
        refused()
        return null
      }
      const base = at ?? viewportCenterWorld()
      const p = ui.getState().snap && !options?.free ? cmd.snapPoint(base, gridStep()) : base
      const id = deps.newId()
      const color = options?.color ?? ui.getState().noteColor
      const createdAt = wallClock()
      const out = edit(`Add ${NOTE_TYPE_NAMES[type].toLowerCase()}`, (c) =>
        cmd.addNote(c, { id, type, at: freePoint(c, p), author, color, now: createdAt }),
      )
      if (!out) return null
      ui.select([id])
      if (options?.edit !== false && isTextNote({ type })) beginEdit(id)
      return id
    },
    setNoteTool(type) {
      if (type === null) {
        if (ui.getState().tool.kind === 'note') ui.setTool(SELECT_TOOL)
        return true
      }
      if (!guardNotes()) return false
      if (!currentAuthor()) {
        refused()
        return false
      }
      if (ui.getState().noteEdit) actions.finishNoteEdit()
      ui.setTool({ kind: 'note', noteType: type })
      return true
    },
    setNoteColor(color, ids) {
      ui.setNoteColor(color)
      const canvas = doc.canvas()
      const set = new Set(ids ?? selection())
      const notes = canvas.items.filter((i) => i.kind === 'note' && set.has(i.id)).map((i) => i.id)
      // Nothing to color: the color is kept for the next note.
      if (notes.length === 0) return true
      if (!guardNotes()) return false
      return edit('Change note color', (c) => cmd.setNoteColor(c, notes, color)) !== null
    },
    setNoteText(id, text) {
      if (!findNote(id) || !guardNotes()) return false
      return edit('Edit note', (c) => cmd.setNoteText(c, id, text)) !== null
    },
    setNoteDone(ids, done) {
      const list = typeof ids === 'string' ? [ids] : [...ids]
      if (!list.some((id) => findNote(id)) || !guardNotes()) return false
      return edit(done ? 'Mark done' : 'Mark not done', (c) => cmd.setNoteDone(c, list, done)) !== null
    },
    toggleNoteDone(id) {
      const note = findNote(id)
      if (!note || !guardNotes()) return false
      return edit(note.done ? 'Mark not done' : 'Mark done', (c) => cmd.toggleNoteDone(c, id)) !== null
    },
    attachArrowEnd(id, end, targetId) {
      if (!isArrowNote(findNote(id)) || !guardNotes()) return false
      return edit('Attach arrow', (c) => cmd.attachArrowEnd(c, id, end, targetId)) !== null
    },
    detachArrowEnd(id, end) {
      if (!isArrowNote(findNote(id)) || !guardNotes()) return false
      return edit('Detach arrow', (c) => cmd.detachArrowEnd(c, id, end)) !== null
    },
    startNoteEdit(id) {
      const sel = selection()
      const target = id ?? (sel.length === 1 ? sel[0] : null)
      const note = target === null ? null : findNote(target)
      if (!note || !isTextNote(note)) return false
      if (!guardNotes()) return false
      const current = ui.getState().noteEdit
      if (current?.id === note.id) return true
      if (current) actions.finishNoteEdit()
      if (sel.length !== 1 || sel[0] !== note.id) ui.select([note.id])
      beginEdit(note.id)
      return true
    },
    finishNoteEdit() {
      const e = ui.endNoteEdit()
      if (!e) return false
      const note = findNote(e.id)
      if (!note || note.text === e.text) return false
      // Typing began on an open notes layer, so the text is kept even if the layer was locked since.
      return edit('Edit note', (c) => cmd.setNoteText(c, e.id, e.text)) !== null
    },
    cancelNoteEdit() {
      ui.endNoteEdit()
    },
    focusNote(id) {
      const note = findNote(id)
      if (!note) return false
      if (!layers().notes.visible) view.setLayer('notes', { visible: true })
      ui.select([id])
      camera.centerOn(boxCenter(noteBounds(note, doc.canvas())))
      return true
    },
  }

  /** Runs `change` on the ids that can change (see changeableIds); false when none can or nothing changed. */
  function withChangeable(ids: readonly string[], change: (ids: string[]) => Canvas | null): boolean {
    if (ids.length === 0) {
      if (!doc.canEdit()) refused()
      return false
    }
    const ok = changeableIds(ids)
    if (!ok || ok.length === 0) return false
    return change(ok) !== null
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
        if (ui.getState().noteEdit) {
          actions.finishNoteEdit()
          return true
        }
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
      case 'enter': {
        if (ui.getState().noteEdit) {
          if (!command.mod) return false
          actions.finishNoteEdit()
          return true
        }
        if (command.mod || (target !== undefined && isPressable(target))) return false
        const sel = ui.getState().selection
        const note = sel.length === 1 ? findNote(sel[0]) : null
        if (!note || !isTextNote(note)) return false
        actions.startNoteEdit(note.id)
        return true
      }
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
   * What is under a screen point. In Edit mode a locked layer lets clicks
   * through to what is under it; View mode changes nothing, so its locks
   * are left out and a tap still reads a note. A finger reaches further to
   * an arrow or line. A taken seat right under the pointer wins; otherwise
   * an empty seat's + within 22 px (a 44 px target) is that seat, marked
   * plus, as long as the pointer is not on another item (a neighbouring
   * fixture, table or note keeps its presses); otherwise the item or seat
   * hit. A chair row is all chairs, with no body to click, so its + works
   * only once the row is selected: the first click picks the row.
   */
  function targetAt(screen: Point, pointer?: PointerKind): Target {
    const zoom = camera.get().zoom
    const lineTolerance = (pointer === 'touch' ? TOUCH_LINE_REACH_PX : HIT_TOLERANCE_PX) / zoom
    const l = layers()
    const reach = ui.getState().mode === 'edit' ? l : unlockedLayers(l)
    const hit = hitTest(doc.canvas(), toWorld(screen), { tolerance: HIT_TOLERANCE_PX / zoom, lineTolerance, layers: reach })
    if (hit.kind === 'seat' && hit.guestId !== null) return hit
    const plus = seating.plusAt(screen)
    if (!plus) return hit
    if ((hit.kind === 'item' || hit.kind === 'seat') && hit.itemId !== plus.itemId) return hit
    const item = doc.canvas().items.find((i) => i.id === plus.itemId)
    if (!item || (item.kind !== 'table' && item.kind !== 'chairRow')) return hit
    if (item.kind === 'chairRow' && !selection().includes(item.id)) return hit
    const target: Target = { kind: 'seat', itemId: plus.itemId, seatIndex: plus.seatIndex, guestId: null, locked: item.locked, plus: true }
    return item.kind === 'chairRow' ? { ...target, itemKind: 'chairRow' } : target
  }

  return {
    pointer,
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
