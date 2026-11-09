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
 * - patchOutsideHistory(): a change the server already made (seats it emptied);
 *   kept out of the history, and redo keeps it too.
 *
 * Each returns the new canvas when it changed, so the caller can hand it to
 * the save engine.
 */
import type { Canvas } from '@/domain/canvas-schema'
import { canRedo, canUndo, clearHistory, emptyHistory, record, redo, undo, type History, type RecordOptions } from '@/domain/history'
import type { DroppedSeat } from '@/shared/api'

export type DocState = {
  canvas: Canvas
  history: History<Canvas>
  canUndo: boolean
  canRedo: boolean
}

export type DocStore = {
  getState(): DocState
  subscribe(listener: () => void): () => void
  edit(label: string, recipe: (canvas: Canvas) => Canvas, options?: RecordOptions): Canvas | null
  undo(): Canvas | null
  redo(): Canvas | null
  replace(canvas: Canvas): void
  patchOutsideHistory(recipe: (canvas: Canvas) => Canvas): Canvas | null
}

function state(canvas: Canvas, history: History<Canvas>): DocState {
  return { canvas, history, canUndo: canUndo(history), canRedo: canRedo(history) }
}

export function createDocStore(initial: Canvas, historyLimit?: number): DocStore {
  let current = state(initial, emptyHistory<Canvas>(historyLimit))
  const listeners = new Set<() => void>()

  function set(next: DocState) {
    current = next
    for (const listener of [...listeners]) listener()
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

    patchOutsideHistory(recipe) {
      const after = recipe(current.canvas)
      if (after === current.canvas) return null
      set(state(after, current.history))
      return after
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
