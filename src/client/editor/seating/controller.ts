/**
 * The seating controller (spec section 4, "Seating guests"; section 6,
 * "Seated and unassigned"; PLAN section 6, "Seating guests" and "Phones").
 * One controller for every way a guest gets a seat:
 *
 *  - Drags from the side list to a seat or a table (list-press.ts decides
 *    when a press becomes a drag), from seat to seat on the canvas (the
 *    pointer machine's guest drag: mouse after 4 px, touch after the 450 ms
 *    hold), and from a seat back onto the list (unseat). While a drag is
 *    under way the store holds its target (the seat that grows) and the
 *    tables' tints, worked out once at the start; a ghost element follows
 *    the pointer, moved with a transform once per animation frame. Esc and
 *    pointercancel end it with no change. A drop is one undo step and one
 *    save; a drop on a full table changes nothing and says "Table 4 is full".
 *  - The phone's tap-then-tap: tap a name, then tap a seat.
 *  - The + on empty seats opens a guest picker anchored at the seat.
 *  - Seating actions for panels and menus: seat, seat at a table's first
 *    free seat, move, swap, unseat, reorder within a table.
 *  - Pan to a seat: zoom to at least close level, glide the seat to the
 *    middle of the free part of the view, and pulse it for two seconds.
 *    Works in Edit and View mode.
 *  - Hover cards (a mouse resting 150 ms on a taken seat) and tap cards (a
 *    seat tapped in View mode).
 *
 * Every change goes through the editor document (state/editor-doc.ts), so
 * View mode, or a page that cannot edit yet, refuses it and onRefused tells
 * the page. The camera and cards work in both modes.
 */
import type { Canvas, Item } from '@/domain/canvas-schema'
import { fitArea, type Camera } from '@/domain/camera'
import { zoomForSeatFocus } from '@/domain/detail-level'
import type { Point } from '@/domain/geometry'
import { itemLabel } from '@/domain/item-labels'
import { dragTint, type LayoutKind } from '@/domain/rules'
import {
  dropTarget,
  fullMessage,
  guestSeat,
  isSeatItem,
  reorderWithinTable,
  seatAtTableFirstFree,
  seatCenters,
  seatGuest,
  seatsByGuest,
  unseatGuest,
  type SeatItem,
  type SeatMove,
  type SeatRef,
} from '@/domain/seating'
import { ANIMATE_MS, type CameraController, type FrameScheduler } from '../camera/camera-controller'
import { swapGuests, unseatGuests } from '../commands'
import { isReachable, type Target } from '../input/hit-test'
import type { PointerKind } from '../input/pointer-machine'
import type { ViewStore } from '../state/device-view'
import type { EditorDoc } from '../state/editor-doc'
import type { UiStore } from '../state/ui-store'
import { NO_TARGET, planDrop, resolveDragTarget, sameTarget, seatLabel, targetSeat, type ClientRect, type DragTarget } from './drop'
import { guestIdsAtSeats } from './guest-menu'
import { LIST_PRESS_IDLE, listPressBusy, listPressDragging, stepListPress, type ListPressInput, type ListPressIntent, type ListPressState } from './list-press'
import { directory, guestFullName, guestShortName, NO_PEOPLE, pickPrompt, type People, type PeopleDirectory } from './people'
import { plusSeatAt, type PlusSeat } from './plus'
import { createSeatingStore, type GuestDrag, type ScreenAnchor, type SeatingStore } from './store'

/** A mouse resting this long on a taken seat shows its card. */
export const HOVER_CARD_MS = 150
/** Pan to a seat pulses it this long. */
export const PULSE_MS = 2000
/** Elements marked with this attribute count as the side list when a guest is dropped. */
export const LIST_ZONE_ATTR = 'data-guest-list-zone'

export type SeatingResult =
  | { status: 'done'; seat: SeatRef | null; from: SeatRef | null; displaced: SeatMove['displaced'] }
  | { status: 'unchanged' }
  /** View mode, or the page cannot edit right now. */
  | { status: 'refused' }
  /** No free seat at that table: the page shows `message` ("Table 4 is full"). */
  | { status: 'full'; itemId: string; message: string }

export type PanResult = 'done' | 'notSeated'

export type SeatingActions = {
  /** Seats a guest at a seat. A seated guest moves; a taken seat swaps (its guest goes to Unassigned when the guest came from the list). */
  seatGuest(guestId: string, itemId: string, seatIndex: number): SeatingResult
  /** The table's (or row's) lowest-numbered free seat; 'full' when it has none. */
  seatAtTable(guestId: string, itemId: string): SeatingResult
  /** Moves a seated guest to another seat, swapping with whoever sits there. */
  moveGuest(guestId: string, itemId: string, seatIndex: number): SeatingResult
  /** Two seated guests trade seats. */
  swapGuests(a: string, b: string): SeatingResult
  unseatGuest(guestId: string): SeatingResult
  /** Several guests to Unassigned, as one undo step. */
  unseatGuests(guestIds: readonly string[]): SeatingResult
  /** The guests selected on the canvas to Unassigned (the guest menu's Unseat). */
  unseatSelectedGuests(): SeatingResult
  /** The Properties seat list: the guest in one seat to another seat of the same table, swapping. */
  reorderSeat(itemId: string, fromIndex: number, toIndex: number): SeatingResult
  /** Zooms to at least close level, glides the guest's seat to the middle and pulses it. Edit and View mode. */
  panToGuest(guestId: string): PanResult
  /** The + on an empty seat: opens the guest picker there. False in View mode or for a taken seat. */
  openSeatPicker(itemId: string, seatIndex: number): boolean
  closeSeatPicker(): void
  /** The picker's choice: seats that guest at the picker's seat and closes it. */
  chooseForSeat(guestId: string): SeatingResult
  /** Tap-then-tap: the next tap on a seat or table seats this guest. False when editing is refused. */
  startPick(guestId: string): boolean
  cancelPick(): void
}

export type SeatingEvents = {
  /** A change was refused (View mode, or the page cannot edit right now). */
  onRefused?(): void
  /** A short message for a toast: "Table 4 is full". */
  onNotice?(text: string): void
}

/** What a list row's pointer event gives the controller (a PointerEvent has all of it). */
export type ListPointerEvent = {
  pointerId: number
  pointerType: string
  button: number
  clientX: number
  clientY: number
  timeStamp: number
}

export type CanvasGuestDrag = {
  phase: 'start' | 'move' | 'end' | 'cancel'
  itemId: string
  seatIndex: number
  guestId: string | null
  /** Screen px (from the viewport's top left). */
  at: Point
  pointer: PointerKind
}

type ElementLike = { getBoundingClientRect(): { left: number; top: number; width: number; height: number } }
type GhostElement = { style: { transform: string } }

/** A window-like target for the list's drag listeners (the browser's window by default). */
export type ListWindow = {
  addEventListener(type: string, listener: (event: Event) => void, options?: boolean | AddEventListenerOptions): void
  removeEventListener(type: string, listener: (event: Event) => void, options?: boolean | EventListenerOptions): void
}

export type SeatingDeps = {
  doc: EditorDoc
  ui: UiStore
  view: ViewStore
  camera: CameraController
  layoutKind?: () => LayoutKind
  events?: SeatingEvents
  scheduler?: Pick<FrameScheduler, 'requestFrame'>
  now?: () => number
  setTimer?: (callback: () => void, ms: number) => unknown
  /** True when the person asked for less motion: pan to a seat jumps instead of gliding. */
  reducedMotion?: () => boolean
  /** The side list's drop zones on the page; default: registered zones and [data-guest-list-zone] elements. */
  listZones?: () => ClientRect[]
  /** Where list drags listen for the pointer (the browser's window by default). */
  listWindow?: ListWindow | null
}

export type SeatingController = {
  store: SeatingStore
  actions: SeatingActions
  /** The wedding's guests, groups and rules, whenever the page loads them. */
  setPeople(people: Partial<People>): void
  people(): PeopleDirectory
  /** "Jane Doe", or "Guest" for an id not in the list. */
  guestName(guestId: string): string
  guestNames(guestIds: readonly string[]): string[]
  /** "Jane D." */
  shortName(guestId: string): string

  // ---- the side list
  /** A list row's onPointerDown: watches the press until it lifts (drag, tap or scroll). */
  listPointerDown(event: ListPointerEvent, guestId: string): void
  /** The press machine itself, for tests and other adapters (a 'down' without canDrag can drag). */
  listPointer(input: ListPressInput): void
  /** A row chosen without a pointer (keyboard): pans to a seated guest, or starts tap-then-tap. */
  rowActivate(guestId: string): void
  /** Marks an element (the guests panel, the phone's sheet) as the side list for drops. Returns unregister. */
  registerListZone(element: ElementLike): () => void
  /** The ghost element's ref: the controller moves it with a transform each frame. */
  bindGhost(element: GhostElement | null): void
  /** The pointer during a drag, client px. */
  ghostPosition(): Point | null

  // ---- the canvas (the editor controller calls these)
  canvasDrag(event: CanvasGuestDrag): void
  /** A finished tap on the canvas. True when seating used it (pick, +, a View mode card), so onTap does not hear it. */
  canvasTap(target: Target, at: Point, pointer: PointerKind): boolean
  /** A press began on the canvas: hover cards and the picker close. */
  canvasPress(): void
  /** The mouse moved over the canvas with no button down (null: it left). */
  hover(target: Target | null): void
  isPicking(): boolean
  /** The empty seat whose + is under a screen point (Edit mode, close and middle level), or null. None during a drag. */
  plusAt(screen: Point): PlusSeat | null
  /** Esc: ends a list drag, the picker, tap-then-tap or a card. True when it did something. */
  escape(): boolean
  destroy(): void
}

function defaultNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function defaultReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

function pointerKind(type: string): PointerKind {
  return type === 'touch' ? 'touch' : type === 'pen' ? 'pen' : 'mouse'
}

/** The ghost sits beside a mouse pointer, and above a finger so the finger does not hide it. */
export function ghostTransform(client: Point, pointer: PointerKind): string {
  const x = Math.round(client.x)
  const y = Math.round(client.y)
  if (pointer === 'touch') return `translate3d(${x}px, ${y - 32}px, 0) translate(-50%, -100%)`
  return `translate3d(${x + 14}px, ${y + 14}px, 0)`
}

/** "Table 3, seat 4" */
export function seatName(item: SeatItem, seatIndex: number): string {
  return `${itemLabel(item)}, seat ${seatIndex + 1}`
}

function findSeatItem(canvas: Pick<Canvas, 'items'>, itemId: string): SeatItem | null {
  const item = canvas.items.find((i) => i.id === itemId)
  return item && isSeatItem(item) ? item : null
}

/** The camera that shows `world` at the middle of the part of the view the fit insets leave free, at `zoom`. */
export function focusCamera(world: Point, zoom: number, viewport: { width: number; height: number }, insets: Parameters<typeof fitArea>[1]): Camera {
  const area = fitArea(viewport, insets)
  const cx = area.x + area.width / 2
  const cy = area.y + area.height / 2
  return { zoom, x: cx - world.x * zoom, y: cy - world.y * zoom }
}

export function createSeatingController(deps: SeatingDeps): SeatingController {
  const { doc, ui, view, camera } = deps
  const events = deps.events ?? {}
  const now = deps.now ?? defaultNow
  const setTimer = deps.setTimer ?? ((cb: () => void, ms: number) => setTimeout(cb, ms))
  const requestFrame = deps.scheduler?.requestFrame ?? ((cb: () => void) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => cb()) : (setTimeout(cb, 16) as unknown as number)))
  const reducedMotion = deps.reducedMotion ?? defaultReducedMotion
  const layoutKind = deps.layoutKind ?? (() => 'reception' as LayoutKind)
  const store = createSeatingStore()
  const zones = new Set<ElementLike>()

  let people: PeopleDirectory = NO_PEOPLE
  let listMachine: ListPressState = LIST_PRESS_IDLE
  let detachListDom: (() => void) | null = null
  let ghostEl: GhostElement | null = null
  let ghostAt: Point | null = null
  let ghostPointer: PointerKind = 'mouse'
  let ghostFrame = false
  let dragId = 0
  let pulseId = 0
  let hoverToken = 0
  let hoverKey: string | null = null
  let cardCamera: Camera | null = null
  let destroyed = false

  const layers = () => view.getState().layers
  const reachable = (item: Item) => isReachable(item, layers())
  const set = store.setState

  function refused() {
    events.onRefused?.()
  }

  function notice(text: string) {
    events.onNotice?.(text)
  }

  // ---------------------------------------------------------------- screen and client points

  /** The viewport's top left on the page. */
  function origin(): Point {
    const o = camera.clientToScreen(0, 0)
    return { x: -o.x, y: -o.y }
  }

  function viewportRect(): ClientRect {
    const o = origin()
    const size = camera.viewportSize()
    return { left: o.x, top: o.y, width: size.width, height: size.height }
  }

  function anchorAt(world: Point): ScreenAnchor {
    const screen = camera.worldToScreen(world)
    const o = origin()
    return { screen, client: { x: screen.x + o.x, y: screen.y + o.y } }
  }

  function seatWorld(canvas: Pick<Canvas, 'items'>, ref: SeatRef): Point | null {
    const item = findSeatItem(canvas, ref.itemId)
    if (!item) return null
    return seatCenters(item)[ref.seatIndex] ?? null
  }

  function listZoneRects(): ClientRect[] {
    if (deps.listZones) return deps.listZones()
    const out: ClientRect[] = []
    const add = (el: ElementLike) => {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) out.push({ left: r.left, top: r.top, width: r.width, height: r.height })
    }
    zones.forEach(add)
    if (typeof document !== 'undefined') document.querySelectorAll(`[${LIST_ZONE_ATTR}]`).forEach((el) => add(el))
    return out
  }

  // ---------------------------------------------------------------- edits

  /** The selected guests' seats follow them through a seating change (and drop out when unseated). */
  function followSelection(before: readonly string[], canvas: Canvas) {
    if (before.length === 0) return
    const seats = seatsByGuest(canvas)
    const next = before.map((g) => seats.get(g)).filter((s): s is SeatRef => s !== undefined)
    const current = ui.getState().guestSeats
    const same = current.length === next.length && current.every((s, i) => s.itemId === next[i].itemId && s.seatIndex === next[i].seatIndex)
    if (!same) ui.setState({ guestSeats: next })
  }

  /**
   * One seating change as one undo step: a dry run picks the label and
   * catches a full table, then the recipe runs again on the document as it
   * is when the edit lands.
   */
  function runMove(compute: (canvas: Canvas) => SeatMove | 'full', fullItemId: string | null, label?: string): SeatingResult {
    if (!doc.canEdit()) {
      refused()
      return { status: 'refused' }
    }
    const dry = compute(doc.canvas())
    if (dry === 'full') return full(fullItemId)
    if (!dry.changed) return { status: 'unchanged' }
    const selected = guestIdsAtSeats(doc.canvas(), ui.getState().guestSeats)
    let result: SeatMove | null = null
    const out = doc.edit(label ?? seatLabel(dry), (c) => {
      const r = compute(c)
      if (r === 'full') return c
      result = r
      return r.canvas
    })
    const move = result as SeatMove | null
    if (!out || !move) return { status: 'unchanged' }
    ui.prune(out)
    followSelection(selected, out)
    return { status: 'done', seat: move.seat, from: move.from, displaced: move.displaced }
  }

  function full(itemId: string | null): SeatingResult {
    const item = itemId ? findSeatItem(doc.canvas(), itemId) : null
    const message = fullMessage(item ? itemLabel(item) : 'This table')
    notice(message)
    return { status: 'full', itemId: itemId ?? '', message }
  }

  // ---------------------------------------------------------------- pan to a seat

  function pulse(ref: SeatRef) {
    const id = ++pulseId
    set({ pulse: { itemId: ref.itemId, seatIndex: ref.seatIndex, id } })
    setTimer(() => {
      if (!destroyed && store.getState().pulse?.id === id) set({ pulse: null })
    }, PULSE_MS)
  }

  function panToGuest(guestId: string): PanResult {
    const canvas = doc.canvas()
    const ref = guestSeat(canvas, guestId)
    const world = ref ? seatWorld(canvas, ref) : null
    if (!ref || !world) return 'notSeated'
    camera.measure()
    const target = focusCamera(world, zoomForSeatFocus(camera.get().zoom), camera.viewportSize(), camera.fitInsets())
    camera.animateTo(target, { durationMs: reducedMotion() ? 0 : ANIMATE_MS })
    pulse(ref)
    return 'done'
  }

  // ---------------------------------------------------------------- the picker and tap-then-tap

  function openSeatPicker(itemId: string, seatIndex: number): boolean {
    if (!doc.canEdit()) {
      refused()
      return false
    }
    const item = findSeatItem(doc.canvas(), itemId)
    const world = item ? seatCenters(item)[seatIndex] : undefined
    if (!item || !world || item.seats[seatIndex]?.guestId !== null) return false
    set({ picker: { itemId, seatIndex, label: seatName(item, seatIndex), ...anchorAt(world) }, pick: null, card: null })
    return true
  }

  function closeSeatPicker() {
    if (store.getState().picker) set({ picker: null })
  }

  function startPick(guestId: string): boolean {
    if (!doc.canEdit()) {
      refused()
      return false
    }
    set({ pick: { guestId, name: guestShortName(people, guestId), prompt: pickPrompt(people, guestId) }, picker: null, card: null })
    return true
  }

  function cancelPick() {
    if (store.getState().pick) set({ pick: null })
  }

  /** A tap while picking: seat the guest at the seat or table tapped. Taps elsewhere keep the pick. */
  function pickAt(screen: Point) {
    const pick = store.getState().pick
    if (!pick) return
    const cam = camera.get()
    const target = dropTarget(doc.canvas(), camera.screenToWorld(screen), cam.zoom, { guestId: pick.guestId, reachable })
    if (target.kind === 'full') {
      notice(fullMessage(target.label))
      return
    }
    if (target.kind !== 'seat' && target.kind !== 'table') return
    const r = actions.seatGuest(pick.guestId, target.itemId, target.seatIndex)
    if (r.status === 'done' || r.status === 'unchanged') cancelPick()
  }

  // ---------------------------------------------------------------- cards

  function clearCard(source?: 'hover' | 'tap') {
    const card = store.getState().card
    if (card && (!source || card.source === source)) set({ card: null })
    cardCamera = null
  }

  function showCard(ref: SeatRef, guestId: string, source: 'hover' | 'tap') {
    const world = seatWorld(doc.canvas(), ref)
    if (!world) return
    cardCamera = camera.get()
    set({ card: { guestId, itemId: ref.itemId, seatIndex: ref.seatIndex, source, ...anchorAt(world) } })
  }

  function stopHover() {
    hoverKey = null
    hoverToken++
  }

  // ---------------------------------------------------------------- drags

  function ghostWrite() {
    ghostFrame = false
    if (ghostEl && ghostAt) ghostEl.style.transform = ghostTransform(ghostAt, ghostPointer)
  }

  function moveGhost(client: Point) {
    ghostAt = client
    if (!ghostFrame) {
      ghostFrame = true
      requestFrame(ghostWrite)
    }
  }

  function resolve(drag: Pick<GuestDrag, 'guestId' | 'source'>, client: Point): DragTarget {
    const target = resolveDragTarget({
      canvas: doc.canvas(),
      camera: camera.get(),
      viewport: viewportRect(),
      listZones: listZoneRects(),
      client,
      guestId: drag.guestId,
      reachable,
    })
    // A name picked up from the list and put back changes nothing.
    return target.kind === 'list' && drag.source === 'list' ? NO_TARGET : target
  }

  function beginDrag(spec: { guestId: string; source: 'list' | 'seat'; from: SeatRef | null; pointer: PointerKind; client: Point }): boolean {
    if (!doc.canEdit()) {
      refused()
      return false
    }
    camera.measure()
    stopHover()
    const canvas = doc.canvas()
    const from = spec.from ?? guestSeat(canvas, spec.guestId)
    const tints = dragTint(
      { layoutKind: layoutKind(), canvas, guests: people.guests, rules: people.rules, groups: people.groups },
      spec.guestId,
    )
    const base = { guestId: spec.guestId, source: spec.source }
    const target = resolve(base, spec.client)
    ghostPointer = spec.pointer
    set({
      drag: {
        id: ++dragId,
        guestId: spec.guestId,
        text: guestFullName(people, spec.guestId),
        source: spec.source,
        from,
        pointer: spec.pointer,
        target,
        targetSeat: targetSeat(target),
        tints,
      },
      card: null,
      picker: null,
      pick: null,
    })
    moveGhost(spec.client)
    return true
  }

  function moveDrag(client: Point) {
    const drag = store.getState().drag
    if (!drag) return
    moveGhost(client)
    const target = resolve(drag, client)
    if (!sameTarget(target, drag.target)) set({ drag: { ...drag, target, targetSeat: targetSeat(target) } })
  }

  function clearDrag() {
    ghostAt = null
    if (!store.getState().drag) return
    set({ drag: null })
  }

  function endDrag(client: Point) {
    const drag = store.getState().drag
    if (!drag) return
    const target = resolve(drag, client)
    clearDrag()
    if (target.kind === 'none' || (target.kind === 'list' && drag.source === 'list')) return
    if (!doc.canEdit()) {
      refused()
      return
    }
    const plan = planDrop(doc.canvas(), drag.guestId, target)
    if (plan.kind === 'full') {
      notice(plan.message)
      return
    }
    if (plan.kind === 'none') return
    runMove(
      (c) => {
        const p = planDrop(c, drag.guestId, target)
        return p.kind === 'change' ? p.move : p.kind === 'full' ? 'full' : { canvas: c, changed: false, seat: null, from: null, displaced: null }
      },
      target.kind === 'seat' || target.kind === 'table' ? target.itemId : null,
      plan.label,
    )
  }

  function cancelDrag() {
    clearDrag()
  }

  // ---------------------------------------------------------------- the side list

  function listTap(guestId: string, pointer: PointerKind) {
    if (guestSeat(doc.canvas(), guestId)) {
      panToGuest(guestId)
      return
    }
    if (pointer === 'touch' && ui.getState().mode === 'edit') startPick(guestId)
  }

  /** The side list's names can be dragged: Edit mode and a page that can edit. */
  function listCanDrag(): boolean {
    return ui.getState().mode === 'edit' && doc.canEdit()
  }

  function applyList(intent: ListPressIntent) {
    switch (intent.type) {
      case 'wantTimer':
        setTimer(() => {
          if (!destroyed) listPointer({ type: 'timer', time: now() })
        }, Math.max(0, intent.at - now()))
        return
      case 'dragStart':
        if (!beginDrag({ guestId: intent.guestId, source: 'list', from: null, pointer: intent.pointer, client: intent.at })) {
          // Refused: let the list scroll again.
          listMachine = LIST_PRESS_IDLE
        }
        return
      case 'dragMove':
        moveDrag(intent.at)
        return
      case 'drop':
        endDrag(intent.at)
        return
      case 'dragCancel':
        cancelDrag()
        return
      case 'tap':
        listTap(intent.guestId, intent.pointer)
        return
    }
  }

  function listPointer(input: ListPressInput) {
    const step = stepListPress(listMachine, input)
    listMachine = step.state
    for (const intent of step.intents) applyList(intent)
    if (!listPressBusy(listMachine)) {
      const detach = detachListDom
      detachListDom = null
      detach?.()
    }
  }

  function listWindow(): ListWindow | null {
    if (deps.listWindow !== undefined) return deps.listWindow
    return typeof window === 'undefined' ? null : window
  }

  function listPointerDown(event: ListPointerEvent, guestId: string) {
    if (event.button !== 0 || listPressBusy(listMachine)) return
    const id = event.pointerId
    listPointer({
      type: 'down',
      id,
      pointer: pointerKind(event.pointerType),
      button: event.button,
      guestId,
      at: { x: event.clientX, y: event.clientY },
      time: event.timeStamp,
      canDrag: listCanDrag(),
    })
    if (!listPressBusy(listMachine)) return
    const win = listWindow()
    if (!win) return
    const touch = event.pointerType === 'touch'
    const point = (e: Event) => {
      const p = e as unknown as ListPointerEvent
      return { x: p.clientX, y: p.clientY }
    }
    const mine = (e: Event) => (e as unknown as ListPointerEvent).pointerId === id
    const onMove = (e: Event) => {
      if (mine(e)) listPointer({ type: 'move', id, at: point(e), time: e.timeStamp })
    }
    const onUp = (e: Event) => {
      if (mine(e)) listPointer({ type: 'up', id, at: point(e), time: e.timeStamp })
    }
    const onCancel = (e: Event) => {
      if (mine(e)) listPointer({ type: 'cancel', id })
    }
    // Once the hold has made it a drag, the finger moves the guest, not the list.
    const onTouchMove = (e: Event) => {
      if (listPressDragging(listMachine) && e.cancelable) e.preventDefault()
    }
    // A long press would open the browser's own menu or start selecting text.
    const onBlock = (e: Event) => {
      if (listPressBusy(listMachine)) e.preventDefault()
    }
    const onKey = (e: Event) => {
      if ((e as KeyboardEvent).key !== 'Escape' || !listPressBusy(listMachine)) return
      e.preventDefault()
      e.stopPropagation()
      listPointer({ type: 'escape' })
    }
    const onBlur = () => listPointer({ type: 'escape' })
    const capture = { capture: true }
    const active = { capture: true, passive: false }
    win.addEventListener('pointermove', onMove, capture)
    win.addEventListener('pointerup', onUp, capture)
    win.addEventListener('pointercancel', onCancel, capture)
    win.addEventListener('keydown', onKey, capture)
    win.addEventListener('blur', onBlur)
    win.addEventListener('selectstart', onBlock, capture)
    if (touch) {
      win.addEventListener('touchmove', onTouchMove, active)
      win.addEventListener('contextmenu', onBlock, capture)
    }
    detachListDom = () => {
      win.removeEventListener('pointermove', onMove, capture)
      win.removeEventListener('pointerup', onUp, capture)
      win.removeEventListener('pointercancel', onCancel, capture)
      win.removeEventListener('keydown', onKey, capture)
      win.removeEventListener('blur', onBlur)
      win.removeEventListener('selectstart', onBlock, capture)
      if (touch) {
        win.removeEventListener('touchmove', onTouchMove, active)
        win.removeEventListener('contextmenu', onBlock, capture)
      }
    }
  }

  // ---------------------------------------------------------------- actions

  const actions: SeatingActions = {
    seatGuest: (guestId, itemId, seatIndex) => runMove((c) => seatGuest(c, guestId, itemId, seatIndex), itemId),
    seatAtTable: (guestId, itemId) => runMove((c) => seatAtTableFirstFree(c, guestId, itemId), itemId),
    moveGuest: (guestId, itemId, seatIndex) => runMove((c) => seatGuest(c, guestId, itemId, seatIndex), itemId),
    swapGuests: (a, b) => runMove((c) => swapGuests(c, a, b), null, 'Swap guests'),
    unseatGuest: (guestId) => runMove((c) => unseatGuest(c, guestId), null),
    unseatGuests(guestIds) {
      const ids = [...new Set(guestIds)]
      return runMove((c) => unseatGuests(c, ids), null, ids.length === 1 ? 'Unseat guest' : 'Unseat guests')
    },
    unseatSelectedGuests() {
      return actions.unseatGuests(guestIdsAtSeats(doc.canvas(), ui.getState().guestSeats))
    },
    reorderSeat: (itemId, fromIndex, toIndex) => runMove((c) => reorderWithinTable(c, itemId, fromIndex, toIndex), itemId),
    panToGuest,
    openSeatPicker,
    closeSeatPicker,
    chooseForSeat(guestId) {
      const picker = store.getState().picker
      if (!picker) return { status: 'unchanged' }
      const r = actions.seatGuest(guestId, picker.itemId, picker.seatIndex)
      if (r.status === 'done' || r.status === 'unchanged') closeSeatPicker()
      return r
    },
    startPick,
    cancelPick,
  }

  // ---------------------------------------------------------------- listening

  const unsubscribers: (() => void)[] = []
  let lastMode = ui.getState().mode
  unsubscribers.push(
    ui.subscribe(() => {
      const mode = ui.getState().mode
      if (mode === lastMode) return
      lastMode = mode
      if (mode === 'view') {
        // Nothing on the plan changes in View mode.
        if (listPressBusy(listMachine)) listPointer({ type: 'escape' })
        clearDrag()
        cancelPick()
        closeSeatPicker()
      }
    }),
    doc.store.subscribe(() => {
      // A picker whose seat was taken or went away closes.
      const picker = store.getState().picker
      if (picker) {
        const item = findSeatItem(doc.canvas(), picker.itemId)
        if (!item || item.seats[picker.seatIndex]?.guestId !== null) set({ picker: null })
      }
    }),
    camera.subscribeSettle(() => {
      const picker = store.getState().picker
      if (picker) {
        const world = seatWorld(doc.canvas(), picker)
        if (world) set({ picker: { ...picker, ...anchorAt(world) } })
      }
    }),
    camera.subscribeFrame((cam) => {
      // A card belongs to a place on screen: it closes when the view moves.
      if (cardCamera && (cam.zoom !== cardCamera.zoom || cam.x !== cardCamera.x || cam.y !== cardCamera.y)) clearCard()
    }),
  )

  return {
    store,
    actions,
    setPeople(next) {
      people = directory({ ...people, ...next })
      const pick = store.getState().pick
      set(pick ? { people, pick: { ...pick, name: guestShortName(people, pick.guestId), prompt: pickPrompt(people, pick.guestId) } } : { people })
    },
    people: () => people,
    guestName: (id) => guestFullName(people, id),
    guestNames: (ids) => ids.map((id) => guestFullName(people, id)),
    shortName: (id) => guestShortName(people, id),

    listPointerDown,
    listPointer,
    rowActivate(guestId) {
      if (guestSeat(doc.canvas(), guestId)) panToGuest(guestId)
      // Only Edit mode seats anyone; in View mode an unassigned name does nothing.
      else if (ui.getState().mode === 'edit') startPick(guestId)
    },
    registerListZone(element) {
      zones.add(element)
      return () => void zones.delete(element)
    },
    bindGhost(element) {
      ghostEl = element
      if (element && ghostAt) element.style.transform = ghostTransform(ghostAt, ghostPointer)
    },
    ghostPosition: () => ghostAt,

    canvasDrag(event) {
      const o = origin()
      const client = { x: event.at.x + o.x, y: event.at.y + o.y }
      switch (event.phase) {
        case 'start':
          if (event.guestId !== null) beginDrag({ guestId: event.guestId, source: 'seat', from: { itemId: event.itemId, seatIndex: event.seatIndex }, pointer: event.pointer, client })
          return
        case 'move':
          moveDrag(client)
          return
        case 'end':
          endDrag(client)
          return
        case 'cancel':
          cancelDrag()
          return
      }
    },
    canvasTap(target, at) {
      if (store.getState().pick) {
        pickAt(at)
        return true
      }
      const mode = ui.getState().mode
      if (mode === 'edit' && target.kind === 'seat' && target.plus === true) {
        openSeatPicker(target.itemId, target.seatIndex)
        return true
      }
      // View mode: a tap on a taken seat opens its card (and only that); other taps close it.
      if (mode === 'view' && target.kind === 'seat' && target.guestId !== null) {
        showCard({ itemId: target.itemId, seatIndex: target.seatIndex }, target.guestId, 'tap')
        return true
      }
      clearCard('tap')
      return false
    },
    canvasPress() {
      stopHover()
      clearCard('hover')
      closeSeatPicker()
    },
    hover(target) {
      if (store.getState().drag) return
      if (target && target.kind === 'seat' && target.guestId !== null) {
        const key = `${target.itemId}#${target.seatIndex}`
        const card = store.getState().card
        if (card && card.itemId === target.itemId && card.seatIndex === target.seatIndex) return
        if (hoverKey === key) return
        if (card?.source === 'hover') clearCard('hover')
        hoverKey = key
        const token = ++hoverToken
        const ref = { itemId: target.itemId, seatIndex: target.seatIndex }
        const guestId = target.guestId
        setTimer(() => {
          if (destroyed || token !== hoverToken) return
          hoverKey = null
          // Still that guest in that seat.
          const item = findSeatItem(doc.canvas(), ref.itemId)
          if (item?.seats[ref.seatIndex]?.guestId === guestId) showCard(ref, guestId, 'hover')
        }, HOVER_CARD_MS)
        return
      }
      stopHover()
      clearCard('hover')
    },
    isPicking: () => store.getState().pick !== null,
    plusAt(screen) {
      if (store.getState().drag || doc.gesture()) return null
      return plusSeatAt({ canvas: doc.canvas(), camera: camera.get(), level: camera.detailLevel(), mode: ui.getState().mode, reachable }, screen)
    },
    escape() {
      const s = store.getState()
      if (listPressBusy(listMachine)) {
        listPointer({ type: 'escape' })
        return true
      }
      if (s.drag) {
        cancelDrag()
        return true
      }
      if (s.picker) {
        closeSeatPicker()
        return true
      }
      if (s.pick) {
        cancelPick()
        return true
      }
      if (s.card) {
        clearCard()
        return true
      }
      return false
    },
    destroy() {
      destroyed = true
      hoverToken++
      const detach = detachListDom
      detachListDom = null
      detach?.()
      for (const u of unsubscribers) u()
      ghostEl = null
    },
  }
}
