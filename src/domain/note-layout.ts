/**
 * How a note draws, worked out from the note alone (no DOM, so no text
 * measuring), in world units (cm): the lines of a sticky or text note's text,
 * wrapped to its width and shrunk to fit its height, and the line and head
 * of an arrow. Widths come from textWidthEm (text-fit.ts), which errs a
 * little wide, so text stays inside its note.
 */
import type { Point } from './geometry'
import { NOTE_FONT_CM, NOTE_LINE_CM } from './notes'
import { textWidthEm } from './text-fit'

/** The smallest text a note shrinks to before its text is cut short, in cm. */
export const NOTE_MIN_FONT_CM = 8
/** Each step down in size while fitting the text. */
const SHRINK = 0.9
/** Baseline to baseline, in multiples of the font size. */
export const NOTE_LINE_HEIGHT = 1.25
/** The author's initial in a sticky note's corner, in cm. */
export const NOTE_INITIAL_FONT_CM = 11

function widthOf(text: string, fontSize: number): number {
  return textWidthEm(text) * fontSize
}

/** Splits a word wider than the line into pieces that fit (at least one character each). */
function breakWord(word: string, maxWidth: number, fontSize: number): string[] {
  const out: string[] = []
  let piece = ''
  for (const ch of word) {
    if (piece !== '' && widthOf(piece + ch, fontSize) > maxWidth) {
      out.push(piece)
      piece = ''
    }
    piece += ch
  }
  if (piece !== '') out.push(piece)
  return out
}

/**
 * The text in lines no wider than `maxWidth` at `fontSize`: each typed line
 * (blank ones too) wraps at spaces, and a word too long for a line breaks
 * between characters. Runs of spaces close up.
 */
export function wrapText(text: string, maxWidth: number, fontSize: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    const words = paragraph.split(/[ \t]+/).filter((w) => w !== '')
    if (words.length === 0) {
      lines.push('')
      continue
    }
    let line = ''
    for (const word of words) {
      const next = line === '' ? word : `${line} ${word}`
      if (widthOf(next, fontSize) <= maxWidth) {
        line = next
        continue
      }
      if (line !== '') lines.push(line)
      line = ''
      if (widthOf(word, fontSize) <= maxWidth) {
        line = word
        continue
      }
      const pieces = breakWord(word, maxWidth, fontSize)
      lines.push(...pieces.slice(0, -1))
      line = pieces[pieces.length - 1] ?? ''
    }
    lines.push(line)
  }
  return lines
}

/** The line cut short with an ellipsis so that it fits. */
function withEllipsis(line: string, maxWidth: number, fontSize: number): string {
  const chars = Array.from(line.trimEnd())
  while (chars.length > 0 && widthOf(`${chars.join('').trimEnd()}…`, fontSize) > maxWidth) chars.pop()
  return `${chars.join('').trimEnd()}…`
}

export type NoteTextLayout = {
  lines: string[]
  fontSize: number
  /** Baseline to baseline, cm. */
  lineStep: number
  /** True when the text did not fit even at the smallest size and was cut short. */
  cut: boolean
}

/**
 * The text in a box `width` by `height` cm: as large as fits, up to
 * NOTE_FONT_CM, wrapping as it goes. Below NOTE_MIN_FONT_CM the text stays
 * at that size and is cut after the last line that fits, with an ellipsis.
 * Trailing blank lines take no room.
 */
export function layoutNoteText(text: string, width: number, height: number, maxFont = NOTE_FONT_CM, minFont = NOTE_MIN_FONT_CM): NoteTextLayout {
  const trimmed = text.replace(/\s+$/, '')
  const floor = Math.min(minFont, maxFont)
  if (trimmed.trim() === '') return { lines: [], fontSize: maxFont, lineStep: maxFont * NOTE_LINE_HEIGHT, cut: false }
  const w = Math.max(1, width)
  const h = Math.max(0, height)
  /** Lines of `step` that fit in the height: the first takes one font size, each after it one step. */
  const room = (size: number) => Math.max(1, Math.floor((h - size) / (size * NOTE_LINE_HEIGHT)) + 1)
  let size = maxFont
  for (;;) {
    const lines = wrapText(trimmed, w, size)
    if (lines.length <= room(size)) return { lines, fontSize: size, lineStep: size * NOTE_LINE_HEIGHT, cut: false }
    if (size <= floor) break
    size = Math.max(floor, size * SHRINK)
  }
  const lines = wrapText(trimmed, w, floor)
  const keep = lines.slice(0, room(floor))
  keep[keep.length - 1] = withEllipsis(keep[keep.length - 1], w, floor)
  return { lines: keep, fontSize: floor, lineStep: floor * NOTE_LINE_HEIGHT, cut: true }
}

export type TextBox = { x: number; y: number; width: number; height: number }

/** Where a sticky note's text goes inside it (its own frame, center at 0, 0), clear of the corner initial. */
export function stickyTextBox(width: number, height: number): TextBox & { pad: number } {
  const pad = Math.max(3, Math.min(12, Math.min(width, height) * 0.09))
  const reserve = Math.min(NOTE_INITIAL_FONT_CM, height * 0.12)
  return { x: -width / 2 + pad, y: -height / 2 + pad, width: Math.max(1, width - 2 * pad), height: Math.max(0, height - 2 * pad - reserve), pad }
}

/** Where a text note's text goes: nearly the whole box. */
export function plainTextBox(width: number, height: number): TextBox {
  const pad = Math.max(1, Math.min(4, Math.min(width, height) * 0.05))
  return { x: -width / 2 + pad, y: -height / 2 + pad, width: Math.max(1, width - 2 * pad), height: Math.max(0, height - 2 * pad) }
}

/** The rough width of a laid out line, for the line through a done sticky note's text. */
export function lineWidth(line: string, fontSize: number): number {
  return widthOf(line, fontSize)
}

export type ArrowParts = {
  /** The shaft, ending inside the head so its round cap never pokes past the tip. */
  from: Point
  to: Point
  /** The head's three corners (tip in the middle), or null for a line or an arrow with no length. */
  head: [Point, Point, Point] | null
}

/** The head's length and half width, in multiples of the line width. */
const HEAD_LENGTH = 5
const HEAD_HALF_WIDTH = 2.2

/**
 * An arrow (or line) from `start` to `end`: the shaft and a filled head at
 * the end. A short arrow gets a smaller head, at most half its length.
 */
export function arrowParts(start: Point, end: Point, withHead: boolean, strokeWidth = NOTE_LINE_CM): ArrowParts {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const len = Math.hypot(dx, dy)
  if (!withHead || len < 1e-6) return { from: start, to: end, head: null }
  const ux = dx / len
  const uy = dy / len
  const headLen = Math.min(strokeWidth * HEAD_LENGTH, len / 2)
  const halfW = headLen * (HEAD_HALF_WIDTH / HEAD_LENGTH)
  const base = { x: end.x - ux * headLen, y: end.y - uy * headLen }
  const left = { x: base.x - uy * halfW, y: base.y + ux * halfW }
  const right = { x: base.x + uy * halfW, y: base.y - ux * halfW }
  const stop = headLen * 0.6
  return { from: start, to: { x: end.x - ux * stop, y: end.y - uy * stop }, head: [left, { x: end.x, y: end.y }, right] }
}
