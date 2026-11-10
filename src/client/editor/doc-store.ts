/**
 * The layout document for one open layout, with its undo history (PLAN
 * section 6, "State and undo"). A small external store: components read it
 * with useSyncExternalStore through EditorStoreProvider, and only the canvas
 * and its history live here (no view state, no selection).
 *
 * - edit(): a finished edit; recorded in the history.
 * - undo() / redo(): step through the history (src/domain/history.ts).
 * - replace(): the document came from the server; the history is cleared, so
 *   Undo can never bring back a snapshot that wipes the other person's work.
 * - patchOutsideHistory(): a change kept out of the history; redo keeps it too.
 * - patchFromServer(): a change the server already made (seats it emptied).
 *   The editor's document takes these over (routeServerPatches), so a drag
 *   under way keeps going with the change in it; with no editor attached it
 *   is patchOutsideHistory.
 *
 * Each returns the new canvas when it changed, so the caller can hand it to
 * the save engine.
 */
import type { Canvas } from '@/domain/canvas-schema'
import { canRedo, canUndo, clearHistory, emptyHistory, record, redo, undo, type History, type RecordOptions } from '@/domain/history'
import type { DroppedSeat } from '@/shared/api'

export type DocState<T = Canvas> = {
  canvas: T
  history: History<T>
  canUndo: boolean
  canRedo: boolean
}

/**
 * The store is generic in its document so the venue template editor can keep
 * its fixed items in one too; the layout editor uses the default, Canvas.
 */
export type DocStore<T = Canvas> = {
  getState(): DocState<T>
  subscribe(listener: () => void): () => void
  edit(label: string, recipe: (canvas: T) => T, options?: RecordOptions): T | null
  undo(): T | null
  redo(): T | null
  replace(canvas: T): void
  patchOutsideHistory(recipe: (canvas: T) => T): T | null
  /** A change the server already made: through the editor's handler when one is attached, else patchOutsideHistory. */
  patchFromServer(recipe: (canvas: T) => T): T | null
  /** The editor's document takes server patches from now on. Returns a function that hands them back. */
  routeServerPatches(handler: ServerPatchHandler<T>): () => void
}

export type ServerPatchHandler<T = Canvas> = (recipe: (canvas: T) => T) => T | null

function state<T>(canvas: T, history: History<T>): DocState<T> {
  return { canvas, history, canUndo: canUndo(history), canRedo: canRedo(history) }
}

/** T is never inferred from `initial` (a literal would narrow it): the default is Canvas, other documents name it. */
export function createDocStore<T = Canvas>(initial: NoInfer<T>, historyLimit?: number): DocStore<T> {
  let current = state(initial, emptyHistory<T>(historyLimit))
  const listeners = new Set<() => void>()
  let serverPatches: ServerPatchHandler<T> | null = null

  function set(next: DocState<T>) {
    current = next
    for (const listener of [...listeners]) listener()
  }

  function patchOutsideHistory(recipe: (canvas: T) => T): T | null {
    const after = recipe(current.canvas)
    if (after === current.canvas) return null
    set(state(after, current.history))
    return after
  }

  return {
    getState: () => current,

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    edit(label, recipe, options) {
      const before = current.canvas
      const after = recipe(before)
      if (after === before) return null
      set(state(after, record(current.history, before, after, label, options)))
      return after
    },

    undo() {
      const step = undo(current.history, current.canvas)
      if (!step) return null
      set(state(step.doc, step.history))
      return step.doc
    },

    redo() {
      const step = redo(current.history, current.canvas)
      if (!step) return null
      set(state(step.doc, step.history))
      return step.doc
    },

    replace(canvas) {
      set(state(canvas, clearHistory(current.history)))
    },

    patchOutsideHistory,

    patchFromServer(recipe) {
      return serverPatches ? serverPatches(recipe) : patchOutsideHistory(recipe)
    },

    routeServerPatches(handler) {
      serverPatches = handler
      return () => {
        if (serverPatches === handler) serverPatches = null
      }
    },
  }
}

/**
 * Empties the seats the server reported as dropped, when they still hold that
 * guest. Items without a change keep their identity.
 */
export function clearDroppedSeats(canvas: Canvas, dropped: readonly DroppedSeat[]): Canvas {
  if (dropped.length === 0) return canvas
  const byItem = new Map<string, DroppedSeat[]>()
  for (const d of dropped) byItem.set(d.itemId, [...(byItem.get(d.itemId) ?? []), d])
  let changed = false
  const items = canvas.items.map((item) => {
    if (item.kind !== 'table' && item.kind !== 'chairRow') return item
    const list = byItem.get(item.id)
    if (!list) return item
    let seats = item.seats
    for (const d of list) {
      const seat = seats[d.seatIndex]
      if (!seat || seat.guestId !== d.guestId) continue
      if (seats === item.seats) seats = item.seats.slice()
      seats[d.seatIndex] = { ...seat, guestId: null }
    }
    if (seats === item.seats) return item
    changed = true
    return { ...item, seats }
  })
  return changed ? { ...canvas, items } : canvas
}
