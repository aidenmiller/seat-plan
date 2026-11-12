/**
 * Notes on the plan (spec section 9; PLAN section 7, "Annotations"): sticky
 * notes, text, arrows, lines, boxes and circles in six preset colors, on
 * their own layer above the furniture. Each records who wrote it (the
 * signed-in user's display name and account id) and when, and can be marked
 * done.
 *
 * Sizes are in cm, like everything on the canvas. Arrows and lines are
 * worked out by arrows.ts.
 */
import { noteColors, noteTypes, type Canvas, type Note } from './canvas-schema'
import { arrowBox, isArrowNote, withEnds } from './arrows'
import { itemBox, type Box, type Point } from './geometry'

export type NoteType = Note['type']
/** Who makes a new note: the signed-in user's display name and account id. */
export type NoteAuthor = { name: string; id: string }
export type NoteColor = Note['color']
export const NOTE_TYPES: readonly NoteType[] = noteTypes
export const NOTE_COLORS: readonly NoteColor[] = noteColors

/** Default sizes in cm. Arrows and lines are their length long. */
export const NOTE_SIZES: Record<NoteType, { width: number; height: number }> = {
  sticky: { width: 120, height: 120 },
  text: { width: 200, height: 50 },
  box: { width: 200, height: 150 },
  circle: { width: 150, height: 150 },
  arrow: { width: 200, height: 0 },
  line: { width: 200, height: 0 },
}

/** The text size notes draw with, in cm. */
export const NOTE_FONT_CM = 18
/** The width of an arrow, line, box or circle outline, in cm. */
export const NOTE_LINE_CM = 3
/** How strongly a note marked done shows (it greys out). */
export const NOTE_DONE_OPACITY = 0.45

export const NOTE_TYPE_NAMES: Record<NoteType, string> = {
  sticky: 'Sticky note',
  text: 'Text',
  arrow: 'Arrow',
  line: 'Line',
  box: 'Box',
  circle: 'Circle',
}

export type NoteColorPreset = {
  id: NoteColor
  label: string
  /** Sticky notes' paper: light, so dark text reads on it, on screen and in print. */
  fill: string
  /** Lines, arrows, outlines and sticky edges: dark enough to read on a white plan and in print. */
  stroke: string
  /** Text on the fill. */
  text: string
}

const INK = '#1c1917'

/** The six colors (spec section 9), in the order the color picker shows them. */
export const NOTE_COLOR_PRESETS: Record<NoteColor, NoteColorPreset> = {
  yellow: { id: 'yellow', label: 'Yellow', fill: '#fef08a', stroke: '#a16207', text: INK },
  pink: { id: 'pink', label: 'Pink', fill: '#fbcfe8', stroke: '#be185d', text: INK },
  blue: { id: 'blue', label: 'Blue', fill: '#bfdbfe', stroke: '#1d4ed8', text: INK },
  green: { id: 'green', label: 'Green', fill: '#bbf7d0', stroke: '#15803d', text: INK },
  purple: { id: 'purple', label: 'Purple', fill: '#e9d5ff', stroke: '#7e22ce', text: INK },
  grey: { id: 'grey', label: 'Grey', fill: '#e5e7eb', stroke: '#4b5563', text: INK },
}

export const DEFAULT_NOTE_COLOR: NoteColor = 'yellow'

/** Sticky notes and text: the notes whose text shows on the plan, edited in place. */
export function isTextNote(note: Pick<Note, 'type'>): boolean {
  return note.type === 'sticky' || note.type === 'text'
}

/** What a new note of each type says before anyone types. */
export function defaultNoteText(type: NoteType): string {
  return type === 'text' ? 'Text' : ''
}

function isoTime(now: Date | number): string {
  const d = now instanceof Date ? now : new Date(now)
  return Number.isFinite(d.getTime()) ? d.toISOString() : new Date(0).toISOString()
}

/**
 * A new note centered at `at`, unrotated, unlocked, not done, written by
 * `author` at `now`. Sticky 120 by 120 cm, text 200 by 50, box 200 by 150,
 * circle 150 across; arrows and lines run 200 cm from left to right.
 *
 * The note keeps the author's name as it is now, and their account id, so a
 * note deleted, saved and brought back by Undo still names whoever made it.
 */
export function makeNote(type: NoteType, at: Point, author: NoteAuthor, color: NoteColor, now: Date | number, id: string): Note {
  const size = NOTE_SIZES[type]
  const note: Note = {
    id,
    kind: 'note',
    type,
    x: at.x,
    y: at.y,
    rotation: 0,
    locked: false,
    width: size.width,
    height: Math.max(size.height, 1),
    text: defaultNoteText(type),
    color,
    author: author.name,
    authorId: author.id,
    done: false,
    createdAt: isoTime(now),
    attachedTo: { start: null, end: null },
  }
  if (type === 'arrow' || type === 'line') {
    const half = size.width / 2
    return withEnds(note, { x: at.x - half, y: at.y }, { x: at.x + half, y: at.y })
  }
  return note
}

/** Up to `max` characters of the text on one line: blank lines and runs of spaces closed up, an ellipsis when cut. */
export function textPreview(text: string, max = 60): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const chars = Array.from(flat)
  if (chars.length <= max) return flat
  return chars.slice(0, Math.max(1, max - 1)).join('').trimEnd() + '…'
}

export type NoteListEntry = {
  id: string
  type: NoteType
  color: NoteColor
  author: Note['author']
  done: boolean
  locked: boolean
  createdAt: string
  /** The text on one short line; empty when the note has none. */
  preview: string
  /** The preview, or the note's type ("Arrow") when it has no text. */
  title: string
}

const entries = new WeakMap<Note, NoteListEntry>()

function entryOf(note: Note): NoteListEntry {
  let entry = entries.get(note)
  if (!entry) {
    const preview = textPreview(note.text)
    entry = {
      id: note.id,
      type: note.type,
      color: note.color,
      author: note.author,
      done: note.done,
      locked: note.locked,
      createdAt: note.createdAt,
      preview,
      title: preview || NOTE_TYPE_NAMES[note.type],
    }
    entries.set(note, entry)
  }
  return entry
}

/**
 * Every note for the Notes tab, in drawing order (bottom first). Each entry
 * is the same object while its note is unchanged, so a list compared item
 * by item (shallowEqual) changes only when a note does.
 */
export function listNotes(canvas: Pick<Canvas, 'items'>): NoteListEntry[] {
  const out: NoteListEntry[] = []
  for (const item of canvas.items) if (item.kind === 'note') out.push(entryOf(item))
  return out
}

/** The box a note covers on the canvas: arrows and lines by their ends as drawn, the rest by their turned body. */
export function noteBounds(note: Note, canvas: Pick<Canvas, 'items'>): Box {
  return isArrowNote(note) ? arrowBox(note, canvas) : itemBox(note)
}
