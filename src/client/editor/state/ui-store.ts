/**
 * The editor's UI state for one open layout (PLAN section 6, "State and
 * undo"): what is selected, what the pointer is over, the tool, Edit or View
 * mode and the phone switches. Never saved with the canvas and never undone
 * (DECISIONS 16).
 *
 * The interaction store beside it holds what changes on every drag frame
 * (selection box, guides, gap readout), so panels that read the UI store do
 * not re-render while something is dragged.
 */
import type { Canvas } from '@/domain/canvas-schema'
import type { Box, Point } from '@/domain/geometry'
import type { PresetId } from '@/domain/presets'
import type { Guide } from '@/domain/snapping'
import { createStore, type Store } from './store'

export type EditorMode = 'edit' | 'view'

/** One seat at a table or chair row: a selected or hovered guest seat. */
export type SeatRef = { itemId: string; seatIndex: number }

export type Hover = { kind: 'item'; itemId: string } | { kind: 'seat'; itemId: string; seatIndex: number } | null

/**
 * select: the usual pointer. hand: every drag pans. place: the next click or
 * tap on the canvas adds this preset there, then the tool goes back to select.
 */
export type Tool = { kind: 'select' } | { kind: 'hand' } | { kind: 'place'; presetId: PresetId }

export type UiState = {
  /** Selected item ids, in the order they were selected. */
  selection: readonly string[]
  /** Selected guests, by seat (spec section 4, "Selection"). */
  guestSeats: readonly SeatRef[]
  hover: Hover
  tool: Tool
  /** View until the device is known (mount), then the device's remembered or default mode. */
  mode: EditorMode
  /** False until mount() has read the device's mode and saved view. */
  deviceKnown: boolean
  /** Phone toolbar Select: one-finger drag on empty canvas draws a selection box and taps toggle (PLAN change 12). */
  phoneSelect: boolean
  /** Snap to the grid, guides and 15 degree steps. Alt does the same for one drag (PLAN change 14). */
  snap: boolean
  /** Handles keep proportions, as Shift does (PLAN change 14). */
  keepProportions: boolean
}

export const SELECT_TOOL: Tool = Object.freeze({ kind: 'select' })

export function initialUiState(): UiState {
  return {
    selection: [],
    guestSeats: [],
    hover: null,
    tool: SELECT_TOOL,
    mode: 'view',
    deviceKnown: false,
    phoneSelect: false,
    snap: true,
    keepProportions: false,
  }
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i])
}

function sameSeat(a: SeatRef, b: SeatRef): boolean {
  return a.itemId === b.itemId && a.seatIndex === b.seatIndex
}

function sameHover(a: Hover, b: Hover): boolean {
  if (a === null || b === null) return a === b
  if (a.kind !== b.kind || a.itemId !== b.itemId) return false
  return a.kind === 'item' || a.seatIndex === (b as { seatIndex: number }).seatIndex
}

export type UiStore = Store<UiState> & {
  /** Replace the selection. Clears selected guests. */
  select(ids: readonly string[]): void
  /** Shift+click: add the item, or take it out when it is selected. */
  toggle(id: string): void
  /** Add items (Shift+drag box). */
  add(ids: readonly string[]): void
  clearSelection(): void
  /** Select a guest's seat, or with toggle add or remove it (Shift+click). Clears selected items. */
  selectSeat(seat: SeatRef, toggle?: boolean): void
  clearGuestSeats(): void
  setHover(hover: Hover): void
  setTool(tool: Tool): void
  /** Called by the editor state, which also remembers the choice on this device. */
  setMode(mode: EditorMode): void
  setPhoneSelect(on: boolean): void
  setSnap(on: boolean): void
  setKeepProportions(on: boolean): void
  /** Drops selected ids and seats that are no longer on the canvas (after undo, delete or a reload). */
  prune(canvas: Canvas): void
}

export function createUiStore(initial: Partial<UiState> = {}): UiStore {
  const store = createStore<UiState>({ ...initialUiState(), ...initial })
  const set = store.setState

  return {
    ...store,
    select(ids) {
      const unique = [...new Set(ids)]
      const s = store.getState()
      set({ selection: sameIds(s.selection, unique) ? s.selection : unique, guestSeats: s.guestSeats.length ? [] : s.guestSeats })
    },
    toggle(id) {
      const s = store.getState()
      const selection = s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id]
      set({ selection, guestSeats: s.guestSeats.length ? [] : s.guestSeats })
    },
    add(ids) {
      const s = store.getState()
      const extra = ids.filter((id) => !s.selection.includes(id))
      if (extra.length === 0) return
      set({ selection: [...s.selection, ...new Set(extra)], guestSeats: s.guestSeats.length ? [] : s.guestSeats })
    },
    clearSelection() {
      const s = store.getState()
      set({ selection: s.selection.length ? [] : s.selection, guestSeats: s.guestSeats.length ? [] : s.guestSeats })
    },
    selectSeat(seat, toggle = false) {
      const s = store.getState()
      const has = s.guestSeats.some((g) => sameSeat(g, seat))
      let guestSeats: readonly SeatRef[]
      if (!toggle) guestSeats = has && s.guestSeats.length === 1 ? s.guestSeats : [seat]
      else guestSeats = has ? s.guestSeats.filter((g) => !sameSeat(g, seat)) : [...s.guestSeats, seat]
      set({ guestSeats, selection: s.selection.length ? [] : s.selection })
    },
    clearGuestSeats() {
      if (store.getState().guestSeats.length) set({ guestSeats: [] })
    },
    setHover(hover) {
      if (!sameHover(store.getState().hover, hover)) set({ hover })
    },
    setTool(tool) {
      const t = store.getState().tool
      if (t.kind === tool.kind && (tool.kind !== 'place' || (t.kind === 'place' && t.presetId === tool.presetId))) return
      set({ tool })
    },
    setMode(mode) {
      // View mode keeps the selection (a tapped table lists its guests) but drops tools.
      set(mode === 'view' ? { mode, tool: SELECT_TOOL, phoneSelect: false } : { mode })
    },
    setPhoneSelect(on) {
      set({ phoneSelect: on })
    },
    setSnap(on) {
      set({ snap: on })
    },
    setKeepProportions(on) {
      set({ keepProportions: on })
    },
    prune(canvas) {
      const s = store.getState()
      const byId = new Map(canvas.items.map((i) => [i.id, i]))
      const selection = s.selection.filter((id) => byId.has(id))
      const guestSeats = s.guestSeats.filter((g) => {
        const item = byId.get(g.itemId)
        return (item?.kind === 'table' || item?.kind === 'chairRow') && item.seats[g.seatIndex]?.guestId != null
      })
      const hover = s.hover && !byId.has(s.hover.itemId) ? null : s.hover
      set({
        selection: selection.length === s.selection.length ? s.selection : selection,
        guestSeats: guestSeats.length === s.guestSeats.length ? s.guestSeats : guestSeats,
        hover,
      })
    },
  }
}

// ---------------------------------------------------------------- interaction

/** The live gap readout while a table is dragged (spec section 4, "Space check"). */
export type GapReadout = {
  /** The nearest other table. */
  otherId: string
  gapCm: number
  /** Closest points, world cm, for the readout's line. */
  from: Point
  to: Point
  /** "4′ 6″" or "Overlapping". */
  text: string
  /** Under the wedding's minimum gap. A warning only: the move still happens. */
  warn: boolean
}

export type Gesture = 'move' | 'resize' | 'rotate' | 'centerResize' | 'marquee' | 'guest' | 'pan' | 'pinch'

export type InteractionState = {
  /** The pointer gesture under way, for cursors; null when none. */
  gesture: Gesture | null
  /** The selection box being drawn, in world cm. */
  marquee: Box | null
  /** Alignment guides to draw, in world cm. */
  guides: readonly Guide[]
  gap: GapReadout | null
  /** Space is held: drags pan. */
  spacePan: boolean
  /** A touch has been held 450 ms (screen px, for a ring under the finger). */
  longPress: Point | null
}

export type InteractionStore = Store<InteractionState> & {
  /** Clears everything a gesture drew. */
  endGesture(): void
}

const NO_GUIDES: readonly Guide[] = Object.freeze([])

export function createInteractionStore(): InteractionStore {
  const store = createStore<InteractionState>({ gesture: null, marquee: null, guides: NO_GUIDES, gap: null, spacePan: false, longPress: null })
  return {
    ...store,
    endGesture() {
      store.setState({ gesture: null, marquee: null, guides: NO_GUIDES, gap: null, longPress: null })
    },
  }
}

export { NO_GUIDES }
