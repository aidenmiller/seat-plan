'use client'

/**
 * Notes on the plan (spec section 9; milestone 9 adds their tools and the
 * Notes tab). For now each note draws plainly so a layout that holds notes
 * still shows them: sticky notes as colored squares with their text, text
 * notes as text, arrows and lines along their points, boxes and circles as
 * outlines.
 */
import { memo, type ReactNode } from 'react'
import type { Note } from '@/domain/canvas-schema'
import type { Point } from '@/domain/geometry'
import { INK, NOTE_COLORS, NOTE_STROKES } from './style'
import { pointsAttr } from './symbols'
import { fitText } from './text-fit'
import { itemTransform } from './TableView'

const NOTE_FONT_CM = 18
const NOTE_LINE_WIDTH_CM = 3

function pathPoints(note: Note): Point[] {
  if (note.points && note.points.length >= 2) return note.points
  return [
    { x: -note.width / 2, y: 0 },
    { x: note.width / 2, y: 0 },
  ]
}

/** An arrowhead at the last point, pointing along the last segment. */
function arrowHead(points: readonly Point[], size: number): string | null {
  const a = points[points.length - 2]
  const b = points[points.length - 1]
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  if (len === 0) return null
  const ux = (b.x - a.x) / len
  const uy = (b.y - a.y) / len
  const back = { x: b.x - ux * size, y: b.y - uy * size }
  const left = { x: back.x - uy * size * 0.5, y: back.y + ux * size * 0.5 }
  const right = { x: back.x + uy * size * 0.5, y: back.y - ux * size * 0.5 }
  return pointsAttr([left, b, right])
}

/** Lines of text from the top left of a w by h box, cut to what fits. */
function BoxText({ text, width, height }: { text: string; width: number; height: number }) {
  const pad = Math.min(12, width * 0.08)
  const step = NOTE_FONT_CM * 1.25
  const room = Math.max(1, Math.floor((height - 2 * pad) / step))
  const lines = text.split('\n').slice(0, room)
  return (
    <text fontSize={NOTE_FONT_CM} fill={INK} textRendering="geometricPrecision">
      {lines.map((line, i) => (
        <tspan key={i} x={-width / 2 + pad} y={-height / 2 + pad + NOTE_FONT_CM * 0.9 + i * step}>
          {fitText(line, width - 2 * pad, NOTE_FONT_CM, NOTE_FONT_CM).text || ' '}
        </tspan>
      ))}
    </text>
  )
}

export const NoteView = memo(function NoteView({ note, selected }: { note: Note; selected: boolean }) {
  const { width: w, height: h } = note
  const fill = NOTE_COLORS[note.color]
  const stroke = NOTE_STROKES[note.color]
  let body: ReactNode
  switch (note.type) {
    case 'sticky':
      body = (
        <>
          <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={2} fill={fill} stroke={stroke} strokeOpacity={0.4} strokeWidth={1.5} />
          <BoxText text={note.text} width={w} height={h} />
        </>
      )
      break
    case 'text':
      body = <BoxText text={note.text} width={w} height={h} />
      break
    case 'arrow':
    case 'line': {
      const pts = pathPoints(note)
      const head = note.type === 'arrow' ? arrowHead(pts, NOTE_LINE_WIDTH_CM * 6) : null
      body = (
        <>
          <polyline points={pointsAttr(pts)} fill="none" stroke={stroke} strokeWidth={NOTE_LINE_WIDTH_CM} strokeLinecap="round" strokeLinejoin="round" />
          {head && <polyline points={head} fill="none" stroke={stroke} strokeWidth={NOTE_LINE_WIDTH_CM} strokeLinecap="round" strokeLinejoin="round" />}
        </>
      )
      break
    }
    case 'box':
      body = <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={3} fill="none" stroke={stroke} strokeWidth={NOTE_LINE_WIDTH_CM} />
      break
    case 'circle':
      body = <ellipse rx={w / 2} ry={h / 2} fill="none" stroke={stroke} strokeWidth={NOTE_LINE_WIDTH_CM} />
      break
  }
  return (
    <g
      data-item-id={note.id}
      data-kind="note"
      data-note-type={note.type}
      data-selected={selected ? 'true' : undefined}
      data-locked={note.locked ? 'true' : undefined}
      opacity={note.done ? 0.5 : undefined}
      transform={itemTransform(note)}
    >
      {body}
    </g>
  )
})
