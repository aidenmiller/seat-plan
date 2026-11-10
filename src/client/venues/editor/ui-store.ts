/**
 * The template editor's UI state (never saved, never undone): the selection,
 * the side of a wall or outline picked for the length field, the tool, Edit
 * or View mode, a wall or outline being drawn point by point, and the two
 * points of the import's scale step. The interaction store beside it holds
 * what changes on every drag frame.
 */
import type { Box, Point } from '@/domain/geometry'
import type { DrawKind, TemplateDoc } from '@/domain/template-commands'
import { createStore, type Store } from '@/client/editor/state/store'
import type { EditorMode } from '@/client/editor/state/ui-store'

/**
 * select: the usual pointer. hand: every drag pans. draw: the next clicks
 * or drag make a fixed item of that kind. measure: clicks pick the two
 * points of the import's scale step.
 */
export type TemplateTool = { kind: 'select' } | { kind: 'hand' } | { kind: 'draw'; draw: DrawKind } | { kind: 'measure' }

export const SELECT: TemplateTool = Object.freeze({ kind: 'select' })

/** One side of a wall, room, zone or patio edge: segment `index` of item `itemId`. */
export type SegmentRef = { itemId: string; index: number }

/** A wall, patio edge, room or zone being drawn point by point. */
export type Drawing = { kind: 'wall' | 'room' | 'zone' | 'patioEdge'; points: readonly Point[] }

export type TemplateUiState = {
  selection: readonly string[]
  /** The side the length field sets: the one nearest the click that selected the item. */
  segment: SegmentRef | null
  hover: string | null
  tool: TemplateTool
  mode: EditorMode
  deviceKnown: boolean
  /** Phones: one finger draws a selection box (PLAN change 12). */
  phoneSelect: boolean
  snap: boolean
  drawing: Drawing | null
  /** Where the pointer is while drawing, for the next segment's preview. World cm. */
  cursor: Point | null
  /** The import's two-point scale step: up to two points, world cm. */
  measure: readonly Point[]
}

export function sameTool(a: TemplateTool, b: TemplateTool): boolean {
  return a.kind === b.kind && (a.kind !== 'draw' || (b.kind === 'draw' && a.draw === b.draw))
}

export type TemplateUiStore = Store<TemplateUiState> & {
  select(ids: readonly string[], segment?: SegmentRef | null): void
  toggle(id: string): void
  clearSelection(): void
  setSegment(segment: SegmentRef | null): void
  setTool(tool: TemplateTool): void
  setMode(mode: EditorMode): void
  /** Drops selected ids that are no longer in the document. */
  prune(doc: TemplateDoc): void
}

export function createTemplateUiStore(initial: Partial<TemplateUiState> = {}): TemplateUiStore {
  const store = createStore<TemplateUiState>({
    selection: [],
    segment: null,
    hover: null,
    tool: SELECT,
    mode: 'view',
    deviceKnown: false,
    phoneSelect: false,
    snap: true,
    drawing: null,
    cursor: null,
    measure: [],
    ...initial,
  })
  const set = store.setState
  return {
    ...store,
    select(ids, segment = null) {
      const unique = [...new Set(ids)]
      const s = store.getState()
      const same = unique.length === s.selection.length && unique.every((id, i) => id === s.selection[i])
      set({ selection: same ? s.selection : unique, segment })
    },
    toggle(id) {
      const s = store.getState()
      const selection = s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id]
      set({ selection, segment: null })
    },
    clearSelection() {
      const s = store.getState()
      if (s.selection.length || s.segment) set({ selection: [], segment: null })
    },
    setSegment(segment) {
      const s = store.getState().segment
      if (s === segment || (s && segment && s.itemId === segment.itemId && s.index === segment.index)) return
      set({ segment })
    },
    setTool(tool) {
      const s = store.getState()
      if (sameTool(s.tool, tool) && s.drawing === null) return
      // A draw tool starts afresh: Delete then takes back a point, never a selected item.
      set(tool.kind === 'draw' ? { tool, drawing: null, cursor: null, selection: [], segment: null } : { tool, drawing: null, cursor: null })
    },
    setMode(mode) {
      set(mode === 'view' ? { mode, tool: SELECT, drawing: null, cursor: null, phoneSelect: false } : { mode })
    },
    prune(doc) {
      const s = store.getState()
      const ids = new Set(doc.items.map((i) => i.id))
      const selection = s.selection.filter((id) => ids.has(id))
      const segment = s.segment && ids.has(s.segment.itemId) && selection.includes(s.segment.itemId) ? s.segment : null
      const hover = s.hover && ids.has(s.hover) ? s.hover : null
      set({ selection: selection.length === s.selection.length ? s.selection : selection, segment, hover })
    },
  }
}

export type TemplateGesture = 'move' | 'vertex' | 'resize' | 'rotate' | 'marquee' | 'rect' | 'pan' | 'pinch'

export type TemplateInteractionState = {
  gesture: TemplateGesture | null
  /** The selection box being drawn, world cm. */
  marquee: Box | null
  /** The rectangle a draw tool is dragging out, world cm. */
  rect: Box | null
  spacePan: boolean
  /** A touch held 450 ms, screen px. */
  longPress: Point | null
}

export type TemplateInteractionStore = Store<TemplateInteractionState> & { endGesture(): void }

export function createTemplateInteractionStore(): TemplateInteractionStore {
  const store = createStore<TemplateInteractionState>({ gesture: null, marquee: null, rect: null, spacePan: false, longPress: null })
  return {
    ...store,
    endGesture() {
      store.setState({ gesture: null, marquee: null, rect: null, longPress: null })
    },
  }
}
