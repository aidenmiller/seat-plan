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
 *     canEdit: () => canEditRef.current,          // saver ready, author picked, no conflict
 *     onCommit: (canvas) => sessionRef.current?.noteEdit(canvas),
 *     settings: () => ({ unit: wedding.unit, minGapCm: wedding.minGapCm }),
 *     venueItems: () => template?.fixedItems ?? [],  // fit to content takes the venue in
 *     events: { onContextMenu, onTap, onRefused },  // all optional
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
 *    seatIndex }), hover, tool ({ kind: 'select' | 'hand' } or { kind:
 *    'place', presetId }), mode ('edit' | 'view'), deviceKnown,
 *    phoneSelect, snap, keepProportions, with setters. Use
 *    actions.setMode() to switch modes: it also remembers the choice.
 *  - interaction (ui-store.ts): what a drag draws: gesture, marquee,
 *    guides, gap (the live readout, with warn), spacePan, longPress.
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
 * ## Hooks (react.ts)
 *
 * useEditorState(), useUi(selector), useInteraction(selector),
 * useViewState(selector), useMode(), useCanvas(selector), useItem(id),
 * useItemIds(), useSelectedItems(), useZoomText(), useDetailLevel().
 * Draw each item as a memoized component that reads useItem(id), so a drag
 * re-renders only what moves.
 *
 * ## Events (EditorEvents in ../input/controller.ts)
 *
 * onContextMenu({ at, target, pointer }): right click, or a touch held 450
 * ms and lifted; the selection already includes the target. onTap: a
 * finished click or tap (View mode cards). onGuestDrag: a seated guest
 * dragged (milestone 5). onRefused: a change refused in View mode.
 */
import type { Canvas } from '@/domain/canvas-schema'
import { randomId } from '@/client/sync/random-id'
import type { LengthUnit } from '@/domain/units'
import type { FixedItem } from '@/domain/venue-schema'
import { createCameraController, type CameraController, type CameraTargets, type FrameScheduler } from '../camera/camera-controller'
import { createClipboard, type EditorClipboard } from '../clipboard'
import type { DocStore } from '../doc-store'
import { createEditorController, type EditorActions, type EditorController, type EditorEvents, type EditorSettings } from '../input/controller'
import { attachInput } from '../input/dom-adapter'
import { browserStorage, createViewStore, writeMode, type StorageLike, type ViewStore } from './device-view'
import { createEditorDoc, type EditorDoc } from './editor-doc'
import { initialMode, readDeviceTraits, type DeviceTraits } from './mode'
import { createInteractionStore, createUiStore, type EditorMode, type InteractionStore, type UiStore } from './ui-store'

export type EditorStateOptions = {
  layoutId: string
  store: DocStore
  /** The page's own gate: the save engine is ready, an author is picked, no conflict is open. Default: always. */
  canEdit?: () => boolean
  /** A finished change: hand it to the save engine (session.noteEdit). */
  onCommit: (canvas: Canvas) => void
  /** Read on every use, so a changed unit or minimum gap applies at once. */
  settings: () => Omit<EditorSettings, 'layoutId'>
  /** The venue template's fixed items, so fit to content takes them in while the venue layer shows. */
  venueItems?: () => readonly FixedItem[]
  events?: EditorEvents
  /** Tests and special cases; the defaults use the browser. */
  storage?: StorageLike | null
  newId?: () => string
  scheduler?: FrameScheduler
  traits?: () => DeviceTraits
  clipboard?: EditorClipboard
  now?: () => number
  setTimer?: (callback: () => void, ms: number) => unknown
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
  })

  // Selected items and seats that undo, a delete or a reload took away leave the selection.
  const unsubscribe = store.subscribe(() => {
    if (!doc.gesture()) ui.prune(store.getState().canvas)
  })
  // Seats the server emptied go into a drag under way instead of dropping it.
  const unroute = store.routeServerPatches(doc.patchFromServer)

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
      controller.destroy()
      camera.flush()
      camera.destroy()
    },
  }
}

export type { EditorActions, EditorController, EditorEvents, EditorSettings } from '../input/controller'
export type { ContextMenuRequest, GuestDragEvent, SeatRequest } from '../input/controller'
export type { Target } from '../input/hit-test'
export type { CameraController } from '../camera/camera-controller'
export type { EditorClipboard } from '../clipboard'
export type { EditorDoc, DocGesture } from './editor-doc'
export type { DeviceTraits } from './mode'
export { isPhoneLike, readDeviceTraits } from './mode'
export type { Layers, LayerName, LayerSwitch, ViewState, ViewStore } from './device-view'
export type { EditorMode, GapReadout, Hover, InteractionState, InteractionStore, SeatRef, Tool, UiState, UiStore } from './ui-store'
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
  useSelectedItems,
  useUi,
  useViewState,
  useZoomText,
} from './react'
export { shallowEqual } from './store'
