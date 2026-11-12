/**
 * The one door every editor change goes through (PLAN section 6, "Edit and
 * View mode"). It wraps the layout's document store (../doc-store.ts):
 *
 *  - In View mode, or while the page cannot edit (no save engine yet, no
 *    saving not ready, a conflict open), every change is refused here, so
 *    shortcuts, drags, buttons and panels all do nothing.
 *  - Each finished change is one undo step and goes to the save engine
 *    through onCommit (EditorShell passes session.noteEdit).
 *  - Drags are gestures: begin() takes the canvas as it is, preview() shows
 *    each frame (outside the undo history, not saved), and commit() records
 *    the whole drag as one undo step and saves it once. cancel() (Esc)
 *    puts the canvas back. If the document is replaced under a drag (the
 *    other person's version loaded), the drag is dropped and the new
 *    document stays.
 *  - Seats the server emptied come in through patchFromServer (the store
 *    routes them here). Outside a drag they are patched in outside the undo
 *    history; during one, the change goes into the drag's start and its
 *    latest frame, and the drag keeps going, so its commit is still one
 *    undo step and one save, with the seats emptied.
 */
import type { Canvas } from '@/domain/canvas-schema'
import type { RecordOptions } from '@/domain/history'
import type { DocStore } from '../doc-store'

export type DocGesture<T = Canvas> = {
  readonly label: string
  /** The canvas when the gesture began (with any server patch since). Commands for each frame start from it, so a drag never drifts. */
  readonly start: T
  /** Shows recipe(start). False when the gesture is over (refused, cancelled or lost). */
  preview(recipe: (start: T) => T): boolean
  /** The canvas the last preview showed. */
  current(): T
  /** Records the gesture as one undo step and saves it. Null when nothing changed or it was lost. */
  commit(options?: RecordOptions): T | null
  /** Puts the canvas back as it was when the gesture began. */
  cancel(): void
  isActive(): boolean
}

/** Generic in its document, like the store: the venue template editor uses it for fixed items. */
export type EditorDoc<T = Canvas> = {
  readonly store: DocStore<T>
  canvas(): T
  /** True in Edit mode when the page can edit. */
  canEdit(): boolean
  /** One finished change: one undo step, saved. Null when refused or nothing changed. Cancels a gesture under way. */
  edit(label: string, recipe: (canvas: T) => T, options?: RecordOptions): T | null
  undo(): T | null
  redo(): T | null
  /** Starts a drag. Null when editing is refused. Cancels a gesture already under way. */
  begin(label: string): DocGesture<T> | null
  /** The gesture under way, if any. */
  gesture(): DocGesture<T> | null
  /** Esc, a mode switch or a lost pointer: put back and forget the gesture under way. */
  cancelGesture(): void
  /** A change the server already made (seats it emptied): applied outside the undo history, into a drag under way too. Never refused. */
  patchFromServer(recipe: (canvas: T) => T): T | null
}

export type EditorDocOptions<T = Canvas> = {
  store: DocStore<T>
  /** Edit mode, and the page's own gate. Read on every change. */
  canEdit: () => boolean
  /** A finished change: hand the canvas to the save engine. */
  onCommit: (canvas: T) => void
}

export function createEditorDoc<T = Canvas>({ store, canEdit, onCommit }: EditorDocOptions<T>): EditorDoc<T> {
  let active: DocGesture<T> | null = null
  /** Puts a server patch into the gesture under way; null with none. */
  let patchActive: ((recipe: (canvas: T) => T) => T | null) | null = null

  function commitOut(canvas: T | null): T | null {
    if (canvas) onCommit(canvas)
    return canvas
  }

  function cancelGesture() {
    active?.cancel()
    active = null
  }

  function begin(label: string): DocGesture<T> | null {
    cancelGesture()
    if (!canEdit()) return null
    let start = store.getState().canvas
    let last = start
    /** The latest frame's recipe, to redraw that frame from a patched start. */
    let lastRecipe: ((start: T) => T) | null = null
    let live = true

    const end = () => {
      live = false
      if (active === gesture) {
        active = null
        patchActive = null
      }
    }
    /** True when the document is still the one this gesture last drew. */
    const ours = () => store.getState().canvas === last

    const gesture: DocGesture<T> = {
      label,
      get start() {
        return start
      },
      current: () => last,
      isActive: () => live,
      preview(recipe) {
        if (!live) return false
        if (!ours()) {
          end()
          return false
        }
        if (!canEdit()) {
          gesture.cancel()
          return false
        }
        const next = recipe(start)
        lastRecipe = recipe
        if (next === last) return true
        store.patchOutsideHistory(() => next)
        last = next
        return true
      },
      commit(options) {
        if (!live) return null
        const mine = ours()
        end()
        if (!mine) return null
        if (last === start) return null
        if (!canEdit()) {
          store.patchOutsideHistory(() => start)
          return null
        }
        const final = last
        // Back to the start outside the history, then the whole drag as one step.
        store.patchOutsideHistory(() => start)
        return commitOut(store.edit(label, () => final, options))
      },
      cancel() {
        if (!live) return
        const mine = ours()
        end()
        if (mine && last !== start) store.patchOutsideHistory(() => start)
      },
    }
    active = gesture
    patchActive = (recipe) => {
      if (!live || !ours()) return store.patchOutsideHistory(recipe)
      // Into the start, then the latest frame drawn again from it (a resize
      // may have moved the guest to another seat number since the start).
      start = recipe(start)
      const next = lastRecipe ? lastRecipe(start) : start
      if (next === last) return null
      last = next
      return store.patchOutsideHistory(() => next)
    }
    return gesture
  }

  return {
    store,
    canvas: () => store.getState().canvas,
    canEdit,
    edit(label, recipe, options) {
      cancelGesture()
      if (!canEdit()) return null
      return commitOut(store.edit(label, recipe, options))
    },
    undo() {
      cancelGesture()
      if (!canEdit()) return null
      return commitOut(store.undo())
    },
    redo() {
      cancelGesture()
      if (!canEdit()) return null
      return commitOut(store.redo())
    },
    begin,
    gesture: () => active,
    cancelGesture,
    patchFromServer(recipe) {
      return patchActive ? patchActive(recipe) : store.patchOutsideHistory(recipe)
    },
  }
}
