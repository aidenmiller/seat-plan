/**
 * The editor core for one open layout (milestone 3; PLAN section 6). Build
 * it once per layout with createEditorState(), hand it to React with
 * <EditorStateProvider state={...}>, and mount it on the canvas elements in
 * an effect. Everything else (drawing, panels, phone layout) reads from it.
 *
 * ## Building it (EditorShell)
 *
 *   const [store] = useState(() => createDocStore(layout.canvas))
 *   const [editor] = useState(() => createEditorState({
 *     layoutId: layout.id,
 *     store,
 *     canEdit: () => canEditRef.current,          // saver ready, no conflict
 *     onCommit: (canvas) => sessionRef.current?.noteEdit(canvas),
 *     settings: () => ({ unit: wedding.unit, minGapCm: wedding.minGapCm }),
 *     venueItems: () => template?.fixedItems ?? [],  // fit to content takes the venue in
 *     events: { onContextMenu, onTap, onRefused, onNotice },  // all optional
 *   }))
 *   useEffect(() => () => editor.destroy(), [editor])
 *
 * Do not call store.edit() directly any more: every change goes through
 * editor.doc or editor.actions, which refuse it in View mode (and when
 * canEdit() is false) and hand the result to onCommit. Undo and redo too.
 * Seats the server emptied (layout-session.ts calls store.patchFromServer)
 * go through editor.doc too, so a drag under way keeps going.
 *
 * ## Mounting it (the viewport component)
 *
 *   <div ref={viewportRef} className="relative overflow-hidden" data-editor-viewport>
 *     <div ref={wrapperRef} className="absolute inset-0">            // moved during gestures
 *       <svg className="absolute inset-0 h-full w-full overflow-visible">
 *         <g ref={worldRef}>{...items in world cm...}</g>             // camera written at settle
 *       </svg>
 *     </div>
 *     <EditorOverlay />                                              // screen-space layer, inside the viewport
 *   </div>
 *   useEffect(() => editor.mount({ viewport, wrapper, world }), [editor])
 *
 * mount() reads this device's mode, layers and camera (fitting the content,
 * venue included, the first time), attaches the camera and all input, and
 * returns the cleanup. The venue's fixed items come from venueItems, or
 * mount({ ..., venueItems }) when the viewport has them. Give the SVG
 * overflow: visible so shapes past its box still show while the wrapper
 * moves. The grid is a CSS background on the viewport using
 * --grid-step, --grid-x and --grid-y (written every frame); constant-width
 * strokes can use --zoom (written at settle), and the viewport carries
 * data-detail="far|middle|close" (written at settle). Draw all three label
 * sets and let CSS on [data-detail] fade between them, so a level change
 * re-renders nothing; useDetailLevel() is there for what CSS cannot do.
 *
 * Notes (milestone 9, spec section 9): actions.setNoteTool(type) arms the
 * note tool (the next click or tap places that note, a drag draws it: an
 * arrow or line from start to end, ends attaching to the tables and fixtures
 * they land on unless Alt is held; false when refused, as in View mode);
 * actions.addNote(type, at?) adds one at a point or the viewport's center. New notes take the signed-in user (the
 * author option: name and account id) and ui noteColor (actions.
 * setNoteColor(color) colors the selected notes and remembers the color).
 * setNoteText, setNoteDone, toggleNoteDone, attachArrowEnd and
 * detachArrowEnd change a note; focusNote(id) is the Notes tab's click
 * (select and pan to it). A selected arrow shows two end handles in the
 * overlay instead of resize and rotate handles. Typing into a sticky or
 * text note: Enter or a tap on the selected note starts it
 * (actions.startNoteEdit), the overlay shows a text box over the note
 * ([data-note-editor]) holding the draft in ui noteEdit, and Esc, a press on
 * the canvas or leaving Edit mode ends it (actions.finishNoteEdit), saving
 * the text as one undo step. NoteView can dim the note's own text while
 * ui noteEdit?.id is its id. Draw arrows with useResolvedItem(id) (or
 * resolveArrow in src/domain/arrows.ts): attached ends are worked out from
 * the item they hold, so they follow it with no arrow edit. Nothing on a
 * hidden or locked notes layer changes (refused with onRefused('notesHidden'
 * or 'notesLocked')); hidden notes cannot be hit or selected, a click in
 * Edit mode goes through locked ones, and the Notes tab still selects one
 * to read.
 *
 * Shape panel drags end with actions.dropPreset(presetId, clientX, clientY,
 * { free: altKey }) (Alt places it off the grid); a tap on a preset (phones)
 * can call actions.addPreset(presetId) for the viewport's center, or
 * ui.setTool({ kind: 'place', presetId }) so the next tap on the canvas
 * places it. The canvas menu's Paste calls actions.paste(worldPoint), with
 * camera.screenToWorld(menu point), to paste where the menu opened.
 *
 * ## What it holds
 *
 *  - doc (editor-doc.ts): canvas(), canEdit(), edit(label, recipe), undo(),
 *    redo(), begin(label) for drags. Recipes are the pure commands in
 *    ../commands.ts, e.g. editor.doc.edit('Rename table', (c) => renameTable(c, id, name)).
 *  - actions (../input/controller.ts): selection-aware buttons and menus:
 *    addPreset(presetId, worldPoint?, { free? }), dropPreset(presetId,
 *    clientX, clientY, { free? }), deleteSelection, duplicateSelection,
 *    copySelection(), paste(worldPoint?), selectAll, undo, redo, nudge, addSeat,
 *    removeSeat / setSeatCount / fitSeats (return { status: 'confirm',
 *    unseated, confirm } when guests would move: name them, then call
 *    confirm()), setSeatSides, align, distribute, bringToFront, sendToBack,
 *    setLocked, renameTable, setTableNumber, setItemBox, setLabel, setStyle,
 *    run(label, recipe), zoomIn, zoomOut, zoomReset, zoomFit, setMode.
 *  - ui (ui-store.ts): selection (item ids), guestSeats ({ itemId,
 *    seatIndex }), hover, tool ({ kind: 'select' | 'hand' }, { kind:
 *    'place', presetId } or { kind: 'note', noteType }), mode ('edit' |
 *    'view'), deviceKnown, phoneSelect, snap, keepProportions, noteColor,
 *    noteEdit ({ id, text, original } while typing into a note), with
 *    setters. Use actions.setMode() to switch modes: it also remembers the
 *    choice.
 *  - interaction (ui-store.ts): what a drag draws: gesture, marquee,
 *    guides, gap (the live readout, with warn), spacePan, longPress,
 *    attachTarget (the item an arrow end would attach to).
 *  - view (device-view.ts): layers ({ venue, furniture, notes } each
 *    { visible, locked }), showReferenceImage, wheel ('auto' | 'zoom' |
 *    'pan'), with setLayer, setShowReferenceImage, setWheel. Kept per
 *    device in localStorage, never in the canvas (PLAN change 1).
 *  - camera (../camera/camera-controller.ts): get(), screenToWorld,
 *    worldToScreen, zoomIn/zoomOut/zoomReset/fit/centerOn, subscribeFrame
 *    (same-frame listeners), zoomText/detailLevel. <ZoomPercentLabel
 *    camera={editor.camera} /> shows the zoom without re-rendering.
 *  - clipboard (../clipboard.ts) and controller (../input/controller.ts).
 *
 * ## Seating (milestone 5, ../seating/)
 *
 *  - editor.setPeople({ guests, groups, rules }) whenever the page loads the
 *    guest list (EditorShell: from useEditorGuestList, rules included,
 *    fetched again on focus). The ghost, the "Tap a seat for Jane D." prompt, the
 *    unseat question's names and the drag tints read from it. Pass
 *    layoutKind in the options for ceremony layouts.
 *  - editor.actions: seatGuest, seatAtTable ('full' comes with "Table 4 is
 *    full", which also goes to events.onNotice), moveGuest, swapGuests,
 *    unseatGuest, unseatGuests, unseatSelectedGuests, reorderSeat,
 *    panToGuest (Edit and View), openSeatPicker, closeSeatPicker,
 *    chooseForSeat, startPick, cancelPick. Each change is one undo step and
 *    one save; View mode refuses them (events.onRefused).
 *  - editor.seating: the store (drag, pick, card, picker, pulse, people) and
 *    what the side list needs: listPointerDown(event, guestId) on each
 *    row's onPointerDown (rows: touch-action pan-y, no text selection),
 *    rowActivate(guestId) for the keyboard, registerListZone(element) for
 *    where a seated guest is dropped to unseat them (or mark it
 *    data-guest-list-zone), bindGhost(element) for the ghost that follows
 *    the pointer, guestName(id) and guestNames(ids).
 *  - editor.labels: guest names at close level for the world SVG's names
 *    layer, worked out when the camera settles (useSeatLabels(tableId)).
 *  - Hooks in ../seating/react.ts: useGuestDrag(), useDragTint(itemId),
 *    useDropTargetSeat(itemId), useDragOrigin(itemId), useSeatPulse(itemId),
 *    useGuestPick(), useSeatCard(), useSeatPicker(), useGuestRowProps(guestId),
 *    useListZone(). The + on empty seats is drawn in TableView and found by
 *    seating.plusAt(screen).
 *  - SeatRequest's 'confirm' (a seat count that unseats people) carries
 *    `names` beside `unseated`.
 *
 * ## Hooks (react.ts)
 *
 * useEditorState(), useUi(selector), useInteraction(selector),
 * useViewState(selector), useMode(), useCanvas(selector), useItem(id),
 * useItemIds(), useSelectedItems(), useZoomText(), useDetailLevel(),
 * useResolvedItem(id) and useResolvedSelection() (arrows at their drawn
 * ends), useNotes() (the Notes tab's list), useNoteEdit().
 * Draw each item as a memoized component that reads useItem(id), so a drag
 * re-renders only what moves.
 *
 * ## Events (EditorEvents in ../input/controller.ts)
 *
 * onContextMenu({ at, target, pointer }): right click, or a touch held 450
 * ms and lifted; the selection already includes the target (a seat target
 * with a guest: build the guest menu with ../seating/guest-menu.ts). onTap:
 * a finished click or tap that seating did not take. onGuestDrag: a seated
 * guest dragged (seating handles the drop). onRefused(reason?): a change
 * refused in View mode or while the page cannot edit (no reason), or for a
 * reason: 'notesHidden', 'notesLocked' or 'layerLocked'.
 * onNotice(text): a short message such as "Table 4 is full".
 */
import type { Canvas } from '@/domain/canvas-schema'
import type { NoteAuthor } from '@/domain/notes'
import { randomId } from '@/client/sync/random-id'
import type { LengthUnit } from '@/domain/units'
import type { FixedItem } from '@/domain/venue-schema'
import { createCameraController, type CameraController, type CameraTargets, type FrameScheduler } from '../camera/camera-controller'
import { createClipboard, type EditorClipboard } from '../clipboard'
import type { DocStore } from '../doc-store'
import { createEditorController, type EditorActions, type EditorController, type EditorEvents, type EditorSettings } from '../input/controller'
import { attachInput } from '../input/dom-adapter'
import { browserStorage, createViewStore, writeMode, type StorageLike, type ViewStore } from './device-view'
import type { LayoutKind } from '@/domain/rules'
import { createSeatingController, type ListWindow, type SeatingController } from '../seating/controller'
import { createNameLabels, type NameLabels } from '../seating/name-labels'
import type { MeasureText } from '@/domain/labels'
import type { People } from '../seating/people'
import { createEditorDoc, type EditorDoc } from './editor-doc'
import { initialMode, readDeviceTraits, type DeviceTraits } from './mode'
import { createInteractionStore, createUiStore, type EditorMode, type InteractionStore, type UiStore } from './ui-store'

export type EditorStateOptions = {
  layoutId: string
  store: DocStore
  /** The page's own gate: the save engine is ready and no conflict is open. Default: always. */
  canEdit?: () => boolean
  /** A finished change: hand it to the save engine (session.noteEdit). */
  onCommit: (canvas: Canvas) => void
  /** Read on every use, so a changed unit or minimum gap applies at once. */
  settings: () => Omit<EditorSettings, 'layoutId'>
  /** The venue template's fixed items, so fit to content takes them in while the venue layer shows. */
  venueItems?: () => readonly FixedItem[]
  events?: EditorEvents
  /** Reception (default) or ceremony: the rules the drag tint checks. */
  layoutKind?: LayoutKind
  /** Tests and special cases; the defaults use the browser. */
  storage?: StorageLike | null
  newId?: () => string
  scheduler?: FrameScheduler
  traits?: () => DeviceTraits
  clipboard?: EditorClipboard
  now?: () => number
  setTimer?: (callback: () => void, ms: number) => unknown
  /** Less motion: pan to a seat jumps instead of gliding. Default: the browser's prefers-reduced-motion. */
  reducedMotion?: () => boolean
  /** Where side list drags listen for the pointer (the window by default; null for none). */
  listWindow?: ListWindow | null
  /** Text widths for the names at close level (the browser's canvas by default). */
  measureText?: MeasureText
  /**
   * Who makes new notes: the signed-in user (name and account id). Without
   * it the note tools are refused, as in the share viewer, which never edits.
   */
  author?: () => NoteAuthor
  /** The wall clock in ms, for a new note's createdAt. Default: Date.now. */
  wallClock?: () => number
}

export type MountTargets = {
  viewport: HTMLElement
  wrapper: HTMLElement
  world: SVGGElement
  /** The venue's fixed items, if the viewport has them (instead of the venueItems option). */
  venueItems?: readonly FixedItem[]
}

export type EditorState = {
  layoutId: string
  store: DocStore
  doc: EditorDoc
  ui: UiStore
  interaction: InteractionStore
  view: ViewStore
  camera: CameraController
  clipboard: EditorClipboard
  controller: EditorController
  actions: EditorActions
  /** Seating guests: drags, tap-then-tap, the + picker, cards, pan to a seat (../seating/controller.ts). */
  seating: SeatingController
  /** Guest names at close level, worked out when the camera settles (../seating/name-labels.ts). */
  labels: NameLabels
  /** The wedding's guests, groups and rules, whenever the page loads them. */
  setPeople(people: Partial<People>): void
  /** Reads this device's mode, layers and camera, once. mount() calls it; tests may call it alone. */
  loadDevice(): void
  /** Attaches the camera and input to the canvas elements. Returns the cleanup. */
  mount(targets: MountTargets): () => void
  /** The wedding's unit changed: redraws the grid. Snapping reads settings() itself. */
  setUnit(unit: LengthUnit): void
  destroy(): void
}

export function createEditorState(options: EditorStateOptions): EditorState {
  const storage = options.storage !== undefined ? options.storage : browserStorage()
  const { store } = options
  const ui = createUiStore()
  const interaction = createInteractionStore()
  const view = createViewStore(options.layoutId, storage)
  const camera = createCameraController({
    scheduler: options.scheduler,
    gridUnit: options.settings().unit,
    onSettle: (c) => view.saveCamera(c),
    now: options.now,
  })
  const clipboard = options.clipboard ?? createClipboard({ storage })
  const doc = createEditorDoc({
    store,
    canEdit: () => ui.getState().mode === 'edit' && (options.canEdit?.() ?? true),
    onCommit: options.onCommit,
  })

  function setMode(mode: EditorMode) {
    if (mode === 'view') doc.cancelGesture()
    ui.setMode(mode)
    writeMode(storage, mode)
  }

  const seating = createSeatingController({
    doc,
    ui,
    view,
    camera,
    layoutKind: () => options.layoutKind ?? 'reception',
    events: {
      onRefused: () => options.events?.onRefused?.(),
      onNotice: (text) => options.events?.onNotice?.(text),
    },
    scheduler: options.scheduler,
    now: options.now,
    setTimer: options.setTimer,
    reducedMotion: options.reducedMotion,
    listWindow: options.listWindow,
  })

  let mountedVenue: readonly FixedItem[] | null = null
  const controller = createEditorController({
    doc,
    ui,
    interaction,
    view,
    camera,
    clipboard,
    settings: () => ({ ...options.settings(), layoutId: options.layoutId }),
    newId: options.newId ?? randomId,
    setMode,
    events: options.events,
    now: options.now,
    setTimer: options.setTimer,
    venueItems: () => mountedVenue ?? options.venueItems?.() ?? [],
    seating,
    author: options.author,
    wallClock: options.wallClock,
  })

  const labels = createNameLabels({
    doc,
    camera,
    seating: seating.store,
    venueItems: () => mountedVenue ?? options.venueItems?.() ?? [],
    measure: options.measureText,
  })

  // Selected items and seats that undo, a delete or a reload took away leave the selection.
  const unsubscribe = store.subscribe(() => {
    if (!doc.gesture()) ui.prune(store.getState().canvas)
  })
  // Seats the server emptied go into a drag under way instead of dropping it.
  const unroute = store.routeServerPatches(doc.patchFromServer)

  // Hiding the notes layer ends typing into a note (saving it) and takes notes out of the selection and hover.
  let notesVisible = view.getState().layers.notes.visible
  const unwatchLayers = view.subscribe(() => {
    const visible = view.getState().layers.notes.visible
    if (visible === notesVisible) return
    notesVisible = visible
    if (visible) return
    controller.actions.finishNoteEdit()
    const s = ui.getState()
    const index = new Map(store.getState().canvas.items.map((i) => [i.id, i]))
    const selection = s.selection.filter((id) => index.get(id)?.kind !== 'note')
    if (selection.length !== s.selection.length) ui.setState({ selection })
    if (s.hover && index.get(s.hover.itemId)?.kind === 'note') ui.setHover(null)
  })

  let loaded = false
  let savedCamera = false

  function loadDevice() {
    if (loaded) return
    loaded = true
    const traits = (options.traits ?? readDeviceTraits)()
    const camera0 = view.load()
    savedCamera = camera0 !== null
    if (camera0) camera.set(camera0, { immediate: true })
    ui.setState({ mode: initialMode(storage, traits), deviceKnown: true })
  }

  return {
    layoutId: options.layoutId,
    store,
    doc,
    ui,
    interaction,
    view,
    camera,
    clipboard,
    controller,
    actions: controller.actions,
    seating,
    labels,
    setPeople: (people) => seating.setPeople(people),
    loadDevice,
    mount(targets) {
      loadDevice()
      if (targets.venueItems) mountedVenue = targets.venueItems
      const detachCamera = camera.attach(targets as unknown as CameraTargets)
      if (!savedCamera) {
        // The visible items and, while that layer shows, the venue.
        controller.actions.zoomFit()
        savedCamera = true
      }
      const detachInput = attachInput({ viewport: targets.viewport, controller, camera })
      return () => {
        detachInput()
        detachCamera()
      }
    },
    setUnit: (unit) => camera.setGridUnit(unit),
    destroy() {
      unsubscribe()
      unroute()
      unwatchLayers()
      controller.destroy()
      labels.destroy()
      seating.destroy()
      camera.flush()
      camera.destroy()
    },
  }
}

export type { EditorActions, EditorController, EditorEvents, EditorSettings, NoteOptions, RefusalReason } from '../input/controller'
export type { ContextMenuRequest, GuestDragEvent, SeatRequest } from '../input/controller'
export type { Target } from '../input/hit-test'
export type { CameraController } from '../camera/camera-controller'
export type { CanvasGuestDrag, PanResult, SeatingActions, SeatingController, SeatingResult } from '../seating/controller'
export type { People, PeopleGuest } from '../seating/people'
export type { GuestDrag, GuestPick, SeatCard, SeatingState, SeatPicker, SeatPulse } from '../seating/store'
export type { DragTarget } from '../seating/drop'
export type { PlusSeat } from '../seating/plus'
export type { EditorClipboard } from '../clipboard'
export type { EditorDoc, DocGesture } from './editor-doc'
export type { DeviceTraits } from './mode'
export { isPhoneLike, readDeviceTraits } from './mode'
export type { Layers, LayerName, LayerSwitch, ViewState, ViewStore } from './device-view'
export type { EditorMode, GapReadout, Hover, InteractionState, InteractionStore, NoteEdit, SeatRef, Tool, UiState, UiStore } from './ui-store'
export {
  EditorStateProvider,
  itemIndex,
  useCanvas,
  useDetailLevel,
  useEditorState,
  useInteraction,
  useItem,
  useItemIds,
  useMode,
  useNoteEdit,
  useNotes,
  useResolvedItem,
  useResolvedSelection,
  useSelectedItems,
  useUi,
  useViewState,
  useZoomText,
} from './react'
export { shallowEqual } from './store'
export {
  GUEST_ROW_STYLE,
  useDragOrigin,
  useDragTint,
  useDropTargetSeat,
  useGuestDrag,
  useGuestPick,
  useGuestRowProps,
  useListZone,
  useSeatCard,
  useSeating,
  useSeatPicker,
  useSeatPulse,
} from '../seating/react'
export { guestIdsAtSeats, guestMenu, type GuestMenu, type GuestMenuExtension, type GuestMenuItem } from '../seating/guest-menu'
export { seatPickerGuests, PICKER_LIMIT } from '../seating/people'
export { LIST_ZONE_ATTR } from '../seating/controller'
