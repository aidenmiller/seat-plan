/**
 * The Notes tab's list and its "show me this note" camera (spec section 9),
 * as plain functions: filtering by open and done, the counts on the filter,
 * newest first, and the camera that brings a note into view.
 */
import { clampZoom, FIT_MAX_ZOOM, fitArea, type Camera, type FitInsets, type Viewport } from '@/domain/camera'
import { boxCenter, type Box } from '@/domain/geometry'
import { noteBounds, type NoteListEntry } from '@/domain/notes'
import type { EditorState } from '../state'

export type NoteFilter = 'all' | 'open' | 'done'

export const NOTE_FILTERS: readonly { value: NoteFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'done', label: 'Done' },
]

export type NoteCounts = Record<NoteFilter, number>

export function noteCounts(notes: readonly NoteListEntry[]): NoteCounts {
  let done = 0
  for (const n of notes) if (n.done) done++
  return { all: notes.length, open: notes.length - done, done }
}

/**
 * The notes a filter keeps, newest first (by when they were added; notes
 * added at the same moment, the one drawn on top first).
 */
export function visibleNotes(notes: readonly NoteListEntry[], filter: NoteFilter): NoteListEntry[] {
  const kept: { entry: NoteListEntry; order: number }[] = []
  notes.forEach((entry, order) => {
    if (filter === 'all' || (filter === 'done') === entry.done) kept.push({ entry, order })
  })
  kept.sort((a, b) => {
    const ta = Date.parse(a.entry.createdAt)
    const tb = Date.parse(b.entry.createdAt)
    const byTime = (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0)
    return byTime !== 0 ? byTime : b.order - a.order
  })
  return kept.map((k) => k.entry)
}

/** What the list says when a filter leaves nothing. */
export function emptyListText(filter: NoteFilter, total: number, edit: boolean): string {
  if (total === 0) return edit ? 'No notes yet. Add one with the Notes tools.' : 'No notes on this plan.'
  return filter === 'open' ? 'No open notes.' : 'No done notes.'
}

/** A note smaller than this share of the free view is zoomed in on; larger than the top share, zoomed out from. */
const SMALLEST_SHARE = 0.12
const LARGEST_SHARE = 0.7
/** The share of the free view a note takes once zoomed to. */
const TARGET_SHARE = 0.35
/** Notes smaller than this (cm) are framed as if this big, so a short arrow does not fill the screen. */
const MIN_FRAMED_CM = 60

/**
 * The camera that shows a note: its box centered in the part of the
 * viewport the toolbar, zoom controls and phone sheet leave free (fitArea).
 * The zoom stays as it is while the note shows at a readable size, and
 * otherwise changes so the note takes about a third of the view, never past
 * fit to content's 200%.
 */
export function noteFocusCamera(bounds: Box, camera: Camera, viewport: Viewport, insets?: FitInsets): Camera {
  const area = fitArea(viewport, insets)
  const center = boxCenter(bounds)
  const side = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, MIN_FRAMED_CM)
  const room = Math.min(area.width, area.height)
  let zoom = camera.zoom
  if (room > 0) {
    const share = (side * zoom) / room
    if (share < SMALLEST_SHARE || share > LARGEST_SHARE) zoom = clampZoom(Math.min(FIT_MAX_ZOOM, (TARGET_SHARE * room) / side))
  }
  return { zoom, x: area.x + area.width / 2 - center.x * zoom, y: area.y + area.height / 2 - center.y * zoom }
}

/**
 * Selects a note and brings it into view (showing hidden notes), framed so
 * it reads (noteFocusCamera): the Notes tab's click and "Edit on the plan".
 * Works in View mode. False when the note is gone.
 */
export function focusNoteOnPlan(editor: Pick<EditorState, 'actions' | 'doc' | 'camera'>, id: string): boolean {
  if (!editor.actions.focusNote(id)) return false
  const canvas = editor.doc.canvas()
  const note = canvas.items.find((i) => i.id === id)
  if (note?.kind !== 'note') return false
  const { camera } = editor
  camera.set(noteFocusCamera(noteBounds(note, canvas), camera.get(), camera.viewportSize(), camera.fitInsets()), { immediate: true })
  return true
}
