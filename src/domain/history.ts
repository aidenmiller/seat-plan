/**
 * Undo history of whole-document snapshots (PLAN section 6, "State and undo").
 *
 * Callers pass immutable documents, so two snapshots share every part that did
 * not change and a step costs only the changed objects. Plain functions over a
 * plain value: every call returns a new history and never changes its input.
 */

export const DEFAULT_HISTORY_LIMIT = 200

export type HistoryEntry<T> = {
  /** The document before the step; undo goes back to it. */
  before: T
  /** The document after the step; redo goes forward to it. */
  after: T
  /** What the step did, for an "Undo move" style menu item. */
  label: string
  /** Steps that share a key and follow straight on from each other merge into one (a burst of nudges). */
  mergeKey?: string
}

export type History<T> = {
  /** Oldest first. The last entry is the next one to undo. */
  past: readonly HistoryEntry<T>[]
  /** Oldest first. The last entry is the next one to redo. */
  future: readonly HistoryEntry<T>[]
  limit: number
}

export type RecordOptions = {
  /**
   * Merge this step into the previous one when both carry the same key and
   * the previous step ended where this one starts. One undo then reverts the
   * whole run, for example a burst of arrow-key nudges.
   */
  mergeKey?: string
}

export function emptyHistory<T>(limit = DEFAULT_HISTORY_LIMIT): History<T> {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('History limit must be a whole number above 0')
  return { past: [], future: [], limit }
}

/**
 * Add a finished step. Clears redo, and drops the oldest steps past the limit.
 * A step whose document did not change (same reference) is ignored.
 */
export function record<T>(
  history: History<T>,
  before: T,
  after: T,
  label: string,
  options: RecordOptions = {},
): History<T> {
  if (before === after) return history
  const { mergeKey } = options
  const last = history.past[history.past.length - 1]
  if (mergeKey !== undefined && last && last.mergeKey === mergeKey && last.after === before) {
    const merged: HistoryEntry<T> = { ...last, after }
    return { ...history, past: [...history.past.slice(0, -1), merged], future: [] }
  }
  const entry: HistoryEntry<T> = mergeKey === undefined ? { before, after, label } : { before, after, label, mergeKey }
  const past = [...history.past, entry]
  return { ...history, past: past.length > history.limit ? past.slice(past.length - history.limit) : past, future: [] }
}

/**
 * Step back. `current` is the document on screen now; redo returns to it, so
 * changes applied outside the history (seats the server emptied) are kept.
 */
export function undo<T>(history: History<T>, current: T): { history: History<T>; doc: T } | null {
  const entry = history.past[history.past.length - 1]
  if (!entry) return null
  const redoEntry: HistoryEntry<T> = { before: entry.before, after: current, label: entry.label }
  return {
    doc: entry.before,
    history: { ...history, past: history.past.slice(0, -1), future: [...history.future, redoEntry] },
  }
}

/** Step forward again. `current` is the document on screen now; undo returns to it. */
export function redo<T>(history: History<T>, current: T): { history: History<T>; doc: T } | null {
  const entry = history.future[history.future.length - 1]
  if (!entry) return null
  const undoEntry: HistoryEntry<T> = { before: current, after: entry.after, label: entry.label }
  return {
    doc: entry.after,
    history: { ...history, past: [...history.past, undoEntry], future: history.future.slice(0, -1) },
  }
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0
}

export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0
}

/** The label of the step undo would revert, if any. */
export function undoLabel<T>(history: History<T>): string | null {
  return history.past[history.past.length - 1]?.label ?? null
}

/** The label of the step redo would apply, if any. */
export function redoLabel<T>(history: History<T>): string | null {
  return history.future[history.future.length - 1]?.label ?? null
}

/** Forget every step, keeping the limit. Used whenever the document is replaced from the server. */
export function clearHistory<T>(history: History<T>): History<T> {
  return emptyHistory<T>(history.limit)
}
