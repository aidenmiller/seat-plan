'use client'

/**
 * A note on the plan (spec section 9; PLAN section 7, "Annotations"), on the
 * notes layer above the furniture:
 *
 *  - sticky: a filled square in its color with the text wrapped inside and
 *    the author's initial small in the bottom right corner;
 *  - text: the text alone, in the darker shade of its color;
 *  - box and circle: an outline with a faint fill;
 *  - line and arrow: a line between its ends, the arrow with a filled head.
 *
 * A note marked done greys out (drawn at NOTE_DONE_OPACITY), and a done
 * sticky note's text is struck through. While a sticky or text note is typed
 * into, the overlay's text box covers it and its own text is left out.
 *
 * Every length is in cm and every look is a plain SVG attribute (no class,
 * style or CSS variable), so the print export can draw the same note. On
 * screen, globals.css keeps outlines and lines at least 1 px wide
 * ([data-note-line]) and shows an empty text note's dashed box
 * ([data-note-placeholder], hidden in print).
 *
 * Arrows and lines draw from their points, so pass the note with its
 * attached ends where they are drawn (useResolvedItem, or withResolvedEnds
 * in src/domain/arrows.ts): they then follow the tables and fixtures they
 * hold.
 *
 * Test hooks: <g data-item-id data-kind="note" data-note-type data-note-color
 * data-done>, data-note-text on the text, data-note-author on the initial,
 * data-note-strike on the lines through done text, data-arrow-head.
 */
import { memo, useMemo, type ReactNode } from 'react'
import type { Note } from '@/domain/canvas-schema'
import type { Point } from '@/domain/geometry'
import { NOTE_COLOR_PRESETS, NOTE_DONE_OPACITY, NOTE_LINE_CM } from '@/domain/notes'
import { arrowParts, layoutNoteText, lineWidth, NOTE_INITIAL_FONT_CM, plainTextBox, stickyTextBox, type TextBox } from '@/domain/note-layout'
import { pointsAttr } from './symbols'
import { itemTransform } from './TableView'

/** How opaque a box or circle's fill is: enough to mark an area, light enough to see the plan through. */
const AREA_FILL_OPACITY = 0.22

/** Lengths to a thousandth of a cm, so the markup carries no float noise. */
function r(v: number): number {
  const out = Math.round(v * 1000) / 1000
  return out === 0 ? 0 : out
}

function ends(note: Note): [Point, Point] {
  const pts = note.points
  if (pts && pts.length >= 2) return [pts[0], pts[pts.length - 1]]
  return [
    { x: -note.width / 2, y: 0 },
    { x: note.width / 2, y: 0 },
  ]
}

/**
 * The note's text in lines, from the top left of `box`; struck through when
 * `strike`. The layout is kept while the text and box size stay, so a drag
 * that only moves the note does not wrap the text again on every frame.
 */
function NoteText({ text, box, fill, strike }: { text: string; box: TextBox; fill: string; strike: boolean }) {
  const layout = useMemo(() => layoutNoteText(text, box.width, box.height), [text, box.width, box.height])
  if (layout.lines.length === 0) return null
  const first = box.y + layout.fontSize * 0.85
  return (
    <g data-note-text="">
      <text fontSize={r(layout.fontSize)} fill={fill} textRendering="geometricPrecision">
        {layout.lines.map((line, i) => (
          <tspan key={i} x={r(box.x)} y={r(first + i * layout.lineStep)}>
            {line === '' ? ' ' : line}
          </tspan>
        ))}
      </text>
      {strike &&
        layout.lines.map((line, i) => {
          if (line.trim() === '') return null
          const y = first + i * layout.lineStep - layout.fontSize * 0.3
          const w = Math.min(box.width, lineWidth(line, layout.fontSize))
          return (
            <line
              key={i}
              x1={r(box.x)}
              y1={r(y)}
              x2={r(box.x + w)}
              y2={r(y)}
              stroke={fill}
              strokeWidth={r(Math.max(1, layout.fontSize * 0.08))}
              strokeLinecap="round"
              data-note-strike=""
            />
          )
        })}
    </g>
  )
}

export type NoteViewProps = {
  /** The note, arrows with their attached ends where they are drawn. */
  note: Note
  selected?: boolean
  /** Its text is being typed into: the overlay's text box shows it instead. */
  editing?: boolean
}

export const NoteView = memo(function NoteView({ note, selected = false, editing = false }: NoteViewProps) {
  const { width: w, height: h } = note
  const color = NOTE_COLOR_PRESETS[note.color] ?? NOTE_COLOR_PRESETS.yellow
  let body: ReactNode
  switch (note.type) {
    case 'sticky': {
      const box = stickyTextBox(w, h)
      const initial = Array.from(note.author)[0] ?? ''
      const initialFont = Math.min(NOTE_INITIAL_FONT_CM, Math.max(4, Math.min(w, h) * 0.12))
      body = (
        <>
          <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={2} fill={color.fill} stroke={color.stroke} strokeOpacity={0.45} strokeWidth={1.5} />
          {!editing && <NoteText text={note.text} box={box} fill={color.text} strike={note.done} />}
          <text
            x={r(w / 2 - box.pad * 0.6)}
            y={r(h / 2 - box.pad * 0.45)}
            fontSize={r(initialFont)}
            fontWeight={600}
            textAnchor="end"
            fill={color.stroke}
            textRendering="geometricPrecision"
            data-note-author=""
          >
            {initial}
          </text>
        </>
      )
      break
    }
    case 'text': {
      const box = plainTextBox(w, h)
      const empty = note.text.trim() === ''
      body = (
        <>
          {/* Shows in the editor only (globals.css), so an empty text note can still be found; print leaves it out. */}
          {empty && (
            <rect
              x={-w / 2}
              y={-h / 2}
              width={w}
              height={h}
              fill="none"
              stroke={color.stroke}
              strokeOpacity={0.5}
              strokeWidth={1}
              strokeDasharray="6 4"
              visibility="hidden"
              data-note-placeholder=""
            />
          )}
          {!editing && <NoteText text={note.text} box={box} fill={color.stroke} strike={false} />}
        </>
      )
      break
    }
    case 'box':
      body = (
        <rect
          x={-w / 2}
          y={-h / 2}
          width={w}
          height={h}
          rx={4}
          fill={color.fill}
          fillOpacity={AREA_FILL_OPACITY}
          stroke={color.stroke}
          strokeWidth={NOTE_LINE_CM}
          data-note-line=""
        />
      )
      break
    case 'circle':
      body = (
        <ellipse rx={w / 2} ry={h / 2} fill={color.fill} fillOpacity={AREA_FILL_OPACITY} stroke={color.stroke} strokeWidth={NOTE_LINE_CM} data-note-line="" />
      )
      break
    case 'arrow':
    case 'line': {
      const [start, end] = ends(note)
      const parts = arrowParts(start, end, note.type === 'arrow')
      body = (
        <>
          <line
            x1={r(parts.from.x)}
            y1={r(parts.from.y)}
            x2={r(parts.to.x)}
            y2={r(parts.to.y)}
            stroke={color.stroke}
            strokeWidth={NOTE_LINE_CM}
            strokeLinecap="round"
            data-note-line=""
          />
          {parts.head && <polygon points={pointsAttr(parts.head.map((p) => ({ x: r(p.x), y: r(p.y) })))} fill={color.stroke} stroke={color.stroke} strokeWidth={1} strokeLinejoin="round" data-arrow-head="" />}
        </>
      )
      break
    }
  }
  return (
    <g
      data-item-id={note.id}
      data-kind="note"
      data-note-type={note.type}
      data-note-color={note.color}
      data-done={note.done ? 'true' : undefined}
      data-selected={selected ? 'true' : undefined}
      data-locked={note.locked ? 'true' : undefined}
      data-editing={editing ? 'true' : undefined}
      opacity={note.done ? NOTE_DONE_OPACITY : undefined}
      transform={itemTransform(note)}
    >
      {body}
    </g>
  )
})
