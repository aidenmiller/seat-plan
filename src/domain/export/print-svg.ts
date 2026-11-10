/**
 * The floor plan for print (spec section 11; PLAN section 7, "Exports"): the
 * layout drawn as one plain SVG page, Letter or Tabloid landscape, with a
 * title and a date along the top and the plan fitted inside the margins.
 *
 * Draws the venue layer, then tables (with their seats), chair rows,
 * fixtures and plain shapes in canvas order, then the guest names at the
 * chosen level, then the notes when they are wanted:
 *
 *  - names: each taken seat's name beside it, laid out by labels.ts (tables)
 *    and ceremony.ts (chair rows) at the paper's scale, never under 6 pt.
 *    A name that does not fit becomes first name and last initial, then the
 *    initials inside its seat, as on screen.
 *  - initials: each taken seat's initials inside its circle.
 *  - tables: table names and counts only.
 *
 * Every look is a plain SVG attribute: no class, no style attribute and no
 * CSS variable, since the PDF library reads attributes only. Text sits on
 * its baseline (no dominant-baseline), for the same reason.
 *
 * Text measuring is injected (`measure`), so the browser can lay names out
 * with the font the PDF embeds and tests can use a stand-in. Pure.
 */
import { resolvedItems } from '../arrows'
import type { Canvas, ChairRow, Fixture, Item, Note, Shape, Table } from '../canvas-schema'
import { chairLocalXs, chairNameLabels, rowName, type ChairNameLabel } from '../ceremony'
import { MIN_NAME_PX } from '../detail-level'
import { boxOfPoints, chairRowLength, footprintBox, normalizeDegrees, unionBoxes, venueBox, type Box, type Point } from '../geometry'
import { initialsFor, labelCorners, layoutLabels, MAX_LABEL_FONT_CM, wallSegments, type LabelName, type MeasureText, type SeatLabel } from '../labels'
import { arrowParts, layoutNoteText, lineWidth, NOTE_INITIAL_FONT_CM, plainTextBox, stickyTextBox, type TextBox } from '../note-layout'
import { noteBounds, NOTE_COLOR_PRESETS, NOTE_DONE_OPACITY, NOTE_LINE_CM } from '../notes'
import { SEAT_EMPTY_COLOR, SEAT_RADIUS_CM, SEAT_TAKEN_COLOR, seatLocalLayout } from '../seats'
import { fitText, labelRotation, runsAcross, tableCenterLabels } from '../text-fit'
import type { FixedItem } from '../venue-schema'

export type PaperSize = 'letter' | 'tabloid'
export type PrintDetail = 'names' | 'initials' | 'tables'

/** Landscape pages in points (1/72 in). */
export const PAPER: Record<PaperSize, { label: string; width: number; height: number; widthIn: number; heightIn: number }> = {
  letter: { label: 'Letter', width: 792, height: 612, widthIn: 11, heightIn: 8.5 },
  tabloid: { label: 'Tabloid', width: 1224, height: 792, widthIn: 17, heightIn: 11 },
}

/** Half an inch round the page. */
export const PRINT_MARGIN_PT = 36
/** The title and date take this much at the top, above the plan. */
export const PRINT_HEADER_PT = 40
/** Names never print smaller than this (PLAN section 7, "Exports"). */
export const MIN_PRINT_NAME_PT = 6
/** The plan is never drawn larger than this many points per cm (a lone table should not fill a page). */
export const MAX_PRINT_SCALE = 1.2
/** The font the PDF embeds, then the same font by its usual name, then any sans. */
export const PRINT_FONT_FAMILY = "NotoSans, 'Noto Sans', sans-serif"
/** Where a line of text's middle sits above its baseline, in multiples of the font size (Noto Sans capitals). */
const MIDDLE_EM = 0.36

const INK = '#1c1917'
const INK_SOFT = '#57534e'
const TABLE_STROKE = '#57534e'
const TABLE_STROKE_CM = 2.5
const FIXTURE_STROKE_CM = 2
const FIXTURE_LABEL = '#292524'
const RESERVED_INK = '#92400e'
const VENUE = { wall: '#44403c', outline: '#78716c', zone: '#a8a29e', fill: '#e7e5e4', label: '#78716c', gapCm: 24 } as const
const VENUE_OUTLINE_CM = 3
const FIXTURE_COLORS: Record<Fixture['type'], { fill: string; stroke: string }> = {
  food: { fill: '#fef3c7', stroke: '#b45309' },
  bar: { fill: '#e0f2fe', stroke: '#0369a1' },
  dj: { fill: '#ede9fe', stroke: '#6d28d9' },
  danceFloor: { fill: '#fdf4ff', stroke: '#a21caf' },
  stage: { fill: '#f5f5f4', stroke: '#57534e' },
  cake: { fill: '#fce7f3', stroke: '#be185d' },
  gifts: { fill: '#dcfce7', stroke: '#15803d' },
  photoBooth: { fill: '#ffedd5', stroke: '#c2410c' },
  ceremonyStructure: { fill: '#f5f5f4', stroke: '#57534e' },
  officiant: { fill: '#f5f5f4', stroke: '#57534e' },
  aisleRunner: { fill: '#f5f5f4', stroke: '#57534e' },
  musicians: { fill: '#ede9fe', stroke: '#6d28d9' },
  soundDesk: { fill: '#ede9fe', stroke: '#6d28d9' },
  welcomeSign: { fill: '#f5f5f4', stroke: '#57534e' },
  entrance: { fill: '#f5f5f4', stroke: '#57534e' },
  custom: { fill: '#f5f5f4', stroke: '#57534e' },
}
/** Initials inside a seat: at least the screen size, larger when print needs it, never wider than the circle allows. */
const INITIALS_MIN_CM = 16
const INITIALS_MAX_CM = 26

export type PrintPlanInput = {
  canvas: Canvas
  /** The venue template's fixed items (none on a blank canvas). */
  venue?: readonly FixedItem[]
  /** Guest names by id. Seats whose guest is missing print as empty. */
  names: ReadonlyMap<string, LabelName>
  detail: PrintDetail
  notes: boolean
  paper: PaperSize
  title: string
  /** A second, smaller line under the title, such as the wedding and its date. */
  subtitle?: string
  /** Printed at the top right, such as "Printed Nov 10, 2026". */
  date: string
  /** Text width in cm at a font size in cm, for the print font. */
  measure: MeasureText
}

export type PrintedName = {
  itemId: string
  seatIndex: number
  guestId: string
  form: 'full' | 'short' | 'initials'
  text: string
  /** On paper, in points. */
  fontPt: number
}

export type PrintPlan = {
  svg: string
  width: number
  height: number
  /** Points on paper per cm on the floor. */
  scale: number
  /** Every seated guest's label, in drawing order (none at 'tables'). */
  names: PrintedName[]
  /** Table names laid out at 'names' level, for checking overlaps. */
  tableLabels: SeatLabel[]
  /** How many names did not fit in full at 6 pt or more (short form or initials). */
  squeezed: number
}

// ---------------------------------------------------------------- markup helpers

/** A finite number rounded to 0.001, as text. */
function n(value: number): string {
  if (!Number.isFinite(value)) return '0'
  const r = Math.round(value * 1000) / 1000
  return Object.is(r, -0) || r === 0 ? '0' : String(r)
}

/** Text safe inside an element or a double-quoted attribute. */
export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

type Attrs = Record<string, string | number | null | undefined | false>

function attrs(a: Attrs): string {
  let out = ''
  for (const [k, v] of Object.entries(a)) {
    if (v === null || v === undefined || v === false) continue
    out += ` ${k}="${typeof v === 'number' ? n(v) : escapeXml(v)}"`
  }
  return out
}

function el(tag: string, a: Attrs, children?: string): string {
  return children === undefined ? `<${tag}${attrs(a)}/>` : `<${tag}${attrs(a)}>${children}</${tag}>`
}

function pointsAttr(points: readonly Point[]): string {
  return points.map((p) => `${n(p.x)},${n(p.y)}`).join(' ')
}

function poseTransform(item: { x: number; y: number; rotation: number }): string {
  return item.rotation ? `translate(${n(item.x)} ${n(item.y)}) rotate(${n(item.rotation)})` : `translate(${n(item.x)} ${n(item.y)})`
}

/** One line of text with its middle at (x, y): moved down to its baseline. */
function textAt(x: number, y: number, size: number, text: string, a: Attrs = {}): string {
  return el('text', { x, y: y + size * MIDDLE_EM, 'font-size': size, ...a }, escapeXml(text))
}

/** Lines of text centered on (0, 0). */
function centeredLines(text: string, size: number, a: Attrs, lineHeight = 1.2): string {
  const lines = text.split('\n')
  const step = size * lineHeight
  const first = (-(lines.length - 1) * step) / 2
  return lines.map((line, i) => (line.trim() === '' ? '' : textAt(0, first + i * step, size, line, { 'text-anchor': 'middle', ...a }))).join('')
}

// ---------------------------------------------------------------- venue

function areaName(name: string | undefined, points: readonly Point[], italic: boolean): string {
  const text = name?.trim() ?? ''
  const box = boxOfPoints(points)
  if (text === '' || !box) return ''
  const w = box.maxX - box.minX
  const h = box.maxY - box.minY
  const fitted = fitText(text, w * 0.8, Math.min(60, h * 0.12))
  return textAt((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2, fitted.fontSize, fitted.text, {
    'text-anchor': 'middle',
    // No italic: the PDF embeds Regular and Bold only.
    'font-weight': italic ? undefined : 700,
    fill: VENUE.label,
  })
}

function doorSymbol(width: number, depth: number, swing: 'left' | 'right' | 'double' | 'none', stroke: string, sw: number, gap: number): string {
  const w2 = width / 2
  const leaf = sw * 1.6
  const arc = Math.max(1, sw * 0.6)
  const dash = `${n(arc * 4)} ${n(arc * 3)}`
  let out = ''
  if (gap > 0) {
    out += el('rect', { x: -w2, y: -gap / 2, width, height: gap, fill: '#ffffff', stroke: 'none' })
    out += el('path', { d: `M${n(-w2)} ${n(-gap / 2)}V${n(gap / 2)}M${n(w2)} ${n(-gap / 2)}V${n(gap / 2)}`, fill: 'none', stroke, 'stroke-width': sw })
  }
  if (swing === 'left') {
    out += el('path', { d: `M${n(-w2)} 0V${n(depth)}`, fill: 'none', stroke, 'stroke-width': leaf })
    out += el('path', { d: `M${n(-w2)} ${n(depth)}A${n(width)} ${n(depth)} 0 0 0 ${n(w2)} 0`, fill: 'none', stroke, 'stroke-width': arc, 'stroke-dasharray': dash })
  } else if (swing === 'right') {
    out += el('path', { d: `M${n(w2)} 0V${n(depth)}`, fill: 'none', stroke, 'stroke-width': leaf })
    out += el('path', { d: `M${n(w2)} ${n(depth)}A${n(width)} ${n(depth)} 0 0 1 ${n(-w2)} 0`, fill: 'none', stroke, 'stroke-width': arc, 'stroke-dasharray': dash })
  } else if (swing === 'double') {
    out += el('path', { d: `M${n(-w2)} 0V${n(depth / 2)}M${n(w2)} 0V${n(depth / 2)}`, fill: 'none', stroke, 'stroke-width': leaf })
    out += el('path', {
      d: `M${n(-w2)} ${n(depth / 2)}A${n(w2)} ${n(depth / 2)} 0 0 0 0 0M${n(w2)} ${n(depth / 2)}A${n(w2)} ${n(depth / 2)} 0 0 1 0 0`,
      fill: 'none',
      stroke,
      'stroke-width': arc,
      'stroke-dasharray': dash,
    })
  }
  return out
}

function windowSymbol(width: number, depth: number, stroke: string, sw: number, fill: string): string {
  return (
    el('rect', { x: -width / 2, y: -depth / 2, width, height: depth, fill, stroke, 'stroke-width': sw }) +
    el('path', { d: `M${n(-width / 2)} 0H${n(width / 2)}`, fill: 'none', stroke, 'stroke-width': Math.max(0.5, sw * 0.6) })
  )
}

function fixedItemSvg(f: FixedItem): string {
  switch (f.type) {
    case 'wall':
      return el('polyline', {
        points: pointsAttr(f.points),
        fill: 'none',
        stroke: VENUE.wall,
        'stroke-width': f.thickness,
        'stroke-linecap': 'square',
        'stroke-linejoin': 'miter',
      })
    case 'room':
      return (
        el('polygon', { points: pointsAttr(f.points), fill: 'none', stroke: VENUE.outline, 'stroke-width': VENUE_OUTLINE_CM }) + areaName(f.name, f.points, false)
      )
    case 'zone':
      return (
        el('polygon', { points: pointsAttr(f.points), fill: 'none', stroke: VENUE.zone, 'stroke-width': VENUE_OUTLINE_CM, 'stroke-dasharray': '24 14' }) +
        areaName(f.name, f.points, true)
      )
    case 'patioEdge':
      return el('polyline', { points: pointsAttr(f.points), fill: 'none', stroke: VENUE.zone, 'stroke-width': VENUE_OUTLINE_CM, 'stroke-dasharray': '24 14' })
    case 'door':
      return el('g', { transform: poseTransform(f) }, doorSymbol(f.width, f.width, f.swing, VENUE.wall, VENUE_OUTLINE_CM, VENUE.gapCm))
    case 'window':
      return el('g', { transform: poseTransform(f) }, windowSymbol(f.width, VENUE.gapCm * 0.6, VENUE.wall, VENUE_OUTLINE_CM * 0.6, '#ffffff'))
    case 'column':
      return el(
        'g',
        { transform: poseTransform(f) },
        f.shape === 'round'
          ? el('ellipse', { rx: f.width / 2, ry: f.height / 2, fill: VENUE.fill, stroke: VENUE.wall, 'stroke-width': VENUE_OUTLINE_CM })
          : el('rect', { x: -f.width / 2, y: -f.height / 2, width: f.width, height: f.height, fill: VENUE.fill, stroke: VENUE.wall, 'stroke-width': VENUE_OUTLINE_CM }),
      )
    case 'stairs': {
      const treads: string[] = []
      const count = Math.min(80, Math.floor(f.width / 28))
      for (let i = 1; i < count; i++) {
        const x = -f.width / 2 + (i * f.width) / count
        treads.push(`M${n(x)} ${n(-f.height / 2)}V${n(f.height / 2)}`)
      }
      return el(
        'g',
        { transform: poseTransform(f) },
        el('rect', { x: -f.width / 2, y: -f.height / 2, width: f.width, height: f.height, fill: '#ffffff', stroke: VENUE.outline, 'stroke-width': VENUE_OUTLINE_CM }) +
          (treads.length ? el('path', { d: treads.join(''), fill: 'none', stroke: VENUE.outline, 'stroke-width': VENUE_OUTLINE_CM * 0.5 }) : ''),
      )
    }
    case 'bar': {
      const label = fitText(f.label, f.width * 0.85, Math.min(30, f.height * 0.4))
      return el(
        'g',
        { transform: poseTransform(f) },
        el('rect', { x: -f.width / 2, y: -f.height / 2, width: f.width, height: f.height, rx: 6, fill: VENUE.fill, stroke: VENUE.outline, 'stroke-width': VENUE_OUTLINE_CM }) +
          (label.text ? centeredLines(label.text, label.fontSize, { fill: VENUE.label, 'font-weight': 700 }) : ''),
      )
    }
    case 'label':
      return el('g', { transform: poseTransform(f) }, centeredLines(f.text, f.fontSize, { fill: VENUE.label }))
  }
}

// ---------------------------------------------------------------- the layout's own items

function tableSvg(table: Table): string {
  const places = seatLocalLayout(table)
  const labels = tableCenterLabels(table)
  const body =
    table.shape === 'round'
      ? el('circle', { r: table.width / 2, fill: '#ffffff', stroke: TABLE_STROKE, 'stroke-width': TABLE_STROKE_CM })
      : el('rect', { x: -table.width / 2, y: -table.height / 2, width: table.width, height: table.height, rx: 3, fill: '#ffffff', stroke: TABLE_STROKE, 'stroke-width': TABLE_STROKE_CM })
  const seats = places
    .map((p) => el('circle', { cx: p.x, cy: p.y, r: SEAT_RADIUS_CM, fill: (table.seats[p.index]?.guestId ?? null) !== null ? SEAT_TAKEN_COLOR : SEAT_EMPTY_COLOR }))
    .join('')
  const text =
    textAt(0, labels.name.y, labels.name.fontSize, labels.name.text, { 'text-anchor': 'middle', 'font-weight': 700, fill: INK }) +
    textAt(0, labels.count.y, labels.count.fontSize, labels.count.text, { 'text-anchor': 'middle', fill: INK_SOFT })
  return el('g', { transform: poseTransform(table) }, body + seats + el('g', { transform: labels.rotation ? `rotate(${n(labels.rotation)})` : undefined }, text))
}

function upsideDown(rotation: number): boolean {
  const r = normalizeDegrees(rotation)
  return r > 90 && r <= 270
}

function chairRowSvg(row: ChairRow): string {
  const length = chairRowLength(row)
  const xs = chairLocalXs(row)
  const chairs = xs.map((x, i) => el('circle', { cx: x, cy: 0, r: SEAT_RADIUS_CM, fill: (row.seats[i]?.guestId ?? null) !== null ? SEAT_TAKEN_COLOR : SEAT_EMPTY_COLOR })).join('')
  const reserved = row.reservedFor?.trim() ?? ''
  const side = row.rowNumber === 1 ? (row.blockLabel?.trim() ?? '') : ''
  const atRight = row.aisleEnd === 'left'
  const flipped = upsideDown(row.rotation)
  const labelX = atRight ? length / 2 + 10 : -length / 2 - 10
  const anchor = atRight !== flipped ? 'start' : 'end'
  let labels = textAt(labelX, reserved ? -15 * 0.6 : 0, 20, rowName(row), { 'text-anchor': anchor, fill: INK_SOFT })
  if (reserved) labels += textAt(labelX, 20 * 0.65, 15, reserved, { 'text-anchor': anchor, fill: RESERVED_INK })
  let out = chairs + el('g', { transform: flipped ? `rotate(180 ${n(labelX)} 0)` : undefined }, labels)
  if (side) {
    const sideY = flipped ? SEAT_RADIUS_CM + 16 : -SEAT_RADIUS_CM - 16
    out += el('g', { transform: flipped ? `rotate(180 0 ${n(sideY)})` : undefined }, textAt(0, sideY, 18, side, { 'text-anchor': 'middle', 'font-weight': 700, fill: INK_SOFT }))
  }
  return el('g', { transform: poseTransform(row) }, out)
}

function fixtureSvg(f: Fixture): string {
  const colors = FIXTURE_COLORS[f.type] ?? FIXTURE_COLORS.custom
  // No icon in print: the label alone, in the middle, along the long side.
  const rotation = labelRotation(f)
  const across = runsAcross(rotation)
  const along = (across ? f.height : f.width) * 0.86
  const depth = (across ? f.width : f.height) * 0.84
  const label = fitText(f.label, along, Math.min(30, depth * 0.4))
  let out = el('rect', {
    x: -f.width / 2,
    y: -f.height / 2,
    width: f.width,
    height: f.height,
    rx: Math.min(8, f.width / 6, f.height / 6),
    fill: colors.fill,
    stroke: colors.stroke,
    'stroke-width': FIXTURE_STROKE_CM,
  })
  if (label.text) {
    out += el('g', { transform: rotation ? `rotate(${n(rotation)})` : undefined }, textAt(0, 0, label.fontSize, label.text, { 'text-anchor': 'middle', 'font-weight': 700, fill: FIXTURE_LABEL }))
  }
  return el('g', { transform: poseTransform(f) }, out)
}

function shapeInsideLabel(shape: Shape, color: string): string {
  const text = shape.text?.trim() ?? ''
  if (text === '') return ''
  const rotation = labelRotation(shape)
  const across = runsAcross(rotation)
  const along = (across ? shape.height : shape.width) * 0.86
  const depth = (across ? shape.width : shape.height) * 0.8
  const lines = text.split('\n')
  const longest = lines.reduce((a, b) => (b.length > a.length ? b : a), '')
  const max = shape.style.fontSize ?? Math.min(48, depth / (lines.length * 1.3))
  const size = fitText(longest, along, Math.min(max, depth / (lines.length * 1.2))).fontSize
  return el('g', { transform: rotation ? `rotate(${n(rotation)})` : undefined }, centeredLines(text, size, { fill: color }))
}

function shapeSvg(shape: Shape): string {
  const { width: w, height: h, style } = shape
  const stroke = style.stroke || 'none'
  const fill = style.fill || 'none'
  const sw = style.strokeWidth
  const line = shape.points && shape.points.length >= 2 ? shape.points : [{ x: -w / 2, y: 0 }, { x: w / 2, y: 0 }]
  const outline =
    shape.points && shape.points.length >= 3
      ? shape.points
      : [
          { x: -w / 2, y: -h / 2 },
          { x: w / 2, y: -h / 2 },
          { x: w / 2, y: h / 2 },
          { x: -w / 2, y: h / 2 },
        ]
  let body = ''
  switch (shape.type) {
    case 'rect':
      body = el('rect', { x: -w / 2, y: -h / 2, width: w, height: h, fill, stroke, 'stroke-width': sw }) + shapeInsideLabel(shape, INK_SOFT)
      break
    case 'ellipse':
      body = el('ellipse', { rx: w / 2, ry: h / 2, fill, stroke, 'stroke-width': sw }) + shapeInsideLabel(shape, INK_SOFT)
      break
    case 'line':
      body = el('polyline', { points: pointsAttr(line), fill: 'none', stroke, 'stroke-width': sw, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })
      break
    case 'wall':
      body = el('polyline', { points: pointsAttr(line), fill: 'none', stroke, 'stroke-width': Math.max(sw, h), 'stroke-linecap': 'square', 'stroke-linejoin': 'miter' })
      break
    case 'room':
      body = el('polygon', { points: pointsAttr(outline), fill, stroke, 'stroke-width': sw }) + shapeInsideLabel(shape, stroke === 'none' ? INK_SOFT : stroke)
      break
    case 'door':
      body = el('g', { transform: `translate(0 ${n(-h / 2)})` }, doorSymbol(w, h, 'left', stroke, sw, 16))
      break
    case 'window':
      body = windowSymbol(w, h, stroke, sw, fill === 'none' ? '#ffffff' : fill)
      break
    case 'text':
      body = centeredLines(shape.text ?? '', style.fontSize ?? 28, { fill: fill === 'none' ? INK_SOFT : fill })
      break
  }
  return el('g', { transform: poseTransform(shape) }, body)
}

// ---------------------------------------------------------------- notes

function noteTextSvg(text: string, box: TextBox, fill: string, strike: boolean): string {
  const layout = layoutNoteText(text, box.width, box.height)
  if (layout.lines.length === 0) return ''
  const first = box.y + layout.fontSize * 0.85
  let out = ''
  layout.lines.forEach((line, i) => {
    if (line.trim() === '') return
    const y = first + i * layout.lineStep
    out += el('text', { x: box.x, y, 'font-size': layout.fontSize, fill }, escapeXml(line))
    if (strike) {
      const sy = y - layout.fontSize * 0.3
      out += el('line', { x1: box.x, y1: sy, x2: box.x + Math.min(box.width, lineWidth(line, layout.fontSize)), y2: sy, stroke: fill, 'stroke-width': Math.max(1, layout.fontSize * 0.08), 'stroke-linecap': 'round' })
    }
  })
  return out
}

function noteSvg(note: Note): string {
  const { width: w, height: h } = note
  const color = NOTE_COLOR_PRESETS[note.color] ?? NOTE_COLOR_PRESETS.yellow
  let body = ''
  switch (note.type) {
    case 'sticky': {
      const box = stickyTextBox(w, h)
      const initialFont = Math.min(NOTE_INITIAL_FONT_CM, Math.max(4, Math.min(w, h) * 0.12))
      body =
        el('rect', { x: -w / 2, y: -h / 2, width: w, height: h, rx: 2, fill: color.fill, stroke: color.stroke, 'stroke-opacity': 0.45, 'stroke-width': 1.5 }) +
        noteTextSvg(note.text, box, color.text, note.done) +
        el('text', { x: w / 2 - box.pad * 0.6, y: h / 2 - box.pad * 0.45, 'font-size': initialFont, 'font-weight': 700, 'text-anchor': 'end', fill: color.stroke }, escapeXml(note.author.slice(0, 1)))
      break
    }
    case 'text':
      body = noteTextSvg(note.text, plainTextBox(w, h), color.stroke, false)
      break
    case 'box':
      body = el('rect', { x: -w / 2, y: -h / 2, width: w, height: h, rx: 4, fill: color.fill, 'fill-opacity': 0.22, stroke: color.stroke, 'stroke-width': NOTE_LINE_CM })
      break
    case 'circle':
      body = el('ellipse', { rx: w / 2, ry: h / 2, fill: color.fill, 'fill-opacity': 0.22, stroke: color.stroke, 'stroke-width': NOTE_LINE_CM })
      break
    case 'arrow':
    case 'line': {
      const pts = note.points && note.points.length >= 2 ? note.points : [{ x: -w / 2, y: 0 }, { x: w / 2, y: 0 }]
      const parts = arrowParts(pts[0], pts[pts.length - 1], note.type === 'arrow')
      body = el('line', { x1: parts.from.x, y1: parts.from.y, x2: parts.to.x, y2: parts.to.y, stroke: color.stroke, 'stroke-width': NOTE_LINE_CM, 'stroke-linecap': 'round' })
      if (parts.head) body += el('polygon', { points: pointsAttr(parts.head), fill: color.stroke, stroke: color.stroke, 'stroke-width': 1, 'stroke-linejoin': 'round' })
      break
    }
  }
  return el('g', { transform: poseTransform(note), opacity: note.done ? NOTE_DONE_OPACITY : undefined }, body)
}

// ---------------------------------------------------------------- names

/** The scale and label settings for a paper scale of `scale` points per cm. */
function nameSettings(scale: number): { zoom: number; minFont: number; maxFont: number; initialsFont: number } {
  const minFont = MIN_PRINT_NAME_PT / scale
  return {
    // labels.ts and ceremony.ts floor names at MIN_NAME_PX / zoom cm; this zoom makes that floor 6 pt on paper.
    zoom: (MIN_NAME_PX * scale) / MIN_PRINT_NAME_PT,
    minFont,
    maxFont: Math.max(MAX_LABEL_FONT_CM, minFont),
    initialsFont: Math.min(INITIALS_MAX_CM, Math.max(INITIALS_MIN_CM, minFont)),
  }
}

type NameLayout = {
  tables: Map<string, SeatLabel[]>
  rows: Map<string, ChairNameLabel[]>
}

function layoutNames(furniture: readonly Item[], venue: readonly FixedItem[], names: ReadonlyMap<string, LabelName>, scale: number, measure: MeasureText): NameLayout {
  const s = nameSettings(scale)
  const tables = furniture.filter((i): i is Table => i.kind === 'table')
  const rowsAll = furniture.filter((i): i is ChairRow => i.kind === 'chairRow')
  const walls = wallSegments(venue, furniture)
  const out: NameLayout = {
    tables: tables.length ? layoutLabels({ tables, walls, zoom: s.zoom, measure, names, maxFont: s.maxFont }) : new Map(),
    rows: new Map(),
  }
  for (const row of rowsAll) {
    if (!row.seats.some((seat) => seat.guestId !== null && names.has(seat.guestId))) continue
    out.rows.set(row.id, chairNameLabels({ row, rows: rowsAll, names, zoom: s.zoom, measure, maxFont: s.maxFont }))
  }
  return out
}

/** The box round every name that prints beside its seat. */
function namesBox(layout: NameLayout): Box | null {
  const points: Point[] = []
  for (const labels of layout.tables.values()) for (const l of labels) points.push(...labelCorners(l))
  return boxOfPoints(points)
}

function initialsText(x: number, y: number, size: number, text: string, rotation: number, guestId: string): string {
  return el(
    'text',
    {
      x,
      y: y + size * MIDDLE_EM,
      transform: rotation ? `rotate(${n(rotation)} ${n(x)} ${n(y)})` : undefined,
      'text-anchor': 'middle',
      'font-size': size,
      'font-weight': 700,
      fill: '#ffffff',
      'data-guest': guestId,
    },
    escapeXml(text),
  )
}

// ---------------------------------------------------------------- the page

function drawnItems(canvas: Canvas, withNotes: boolean): { furniture: Item[]; notes: Note[] } {
  const items = resolvedItems(canvas)
  const furniture: Item[] = []
  const notes: Note[] = []
  for (const item of items) {
    if (item.kind === 'note') {
      if (withNotes) notes.push(item)
    } else furniture.push(item)
  }
  return { furniture, notes }
}

function contentBox(furniture: readonly Item[], notes: readonly Note[], venue: readonly FixedItem[], canvas: Canvas): Box | null {
  return unionBoxes([...furniture.map(footprintBox), ...notes.map((note) => noteBounds(note, canvas)), venueBox(venue)])
}

type Frame = { x: number; y: number; width: number; height: number }

function planFrame(width: number, height: number): Frame {
  return {
    x: PRINT_MARGIN_PT,
    y: PRINT_MARGIN_PT + PRINT_HEADER_PT,
    width: width - 2 * PRINT_MARGIN_PT,
    height: height - 2 * PRINT_MARGIN_PT - PRINT_HEADER_PT,
  }
}

function fitScale(box: Box, frame: Frame): number {
  const w = Math.max(1, box.maxX - box.minX)
  const h = Math.max(1, box.maxY - box.minY)
  return Math.min(MAX_PRINT_SCALE, frame.width / w, frame.height / h)
}

/** The plan as one landscape page of SVG, and what its names came to. */
export function renderPrintPlan(input: PrintPlanInput): PrintPlan {
  const paper = PAPER[input.paper]
  const { width, height } = paper
  const venue = input.venue ?? []
  const { furniture, notes } = drawnItems(input.canvas, input.notes)
  const frame = planFrame(width, height)
  const content = contentBox(furniture, notes, venue, input.canvas)

  let scale = 1
  let names: NameLayout = { tables: new Map(), rows: new Map() }
  let box: Box | null = content
  if (content) {
    scale = fitScale(content, frame)
    if (input.detail === 'names') {
      // Names reach past their tables: fit once with them, then lay them out again at the final scale.
      names = layoutNames(furniture, venue, input.names, scale, input.measure)
      box = unionBoxes([content, namesBox(names)])!
      scale = fitScale(box, frame)
      names = layoutNames(furniture, venue, input.names, scale, input.measure)
    }
  }
  const settings = nameSettings(scale)

  // Furniture in canvas order, with the venue under it.
  let world = venue.map(fixedItemSvg).join('')
  for (const item of furniture) {
    if (item.kind === 'table') world += tableSvg(item)
    else if (item.kind === 'chairRow') world += chairRowSvg(item)
    else if (item.kind === 'fixture') world += fixtureSvg(item)
    else if (item.kind === 'shape') world += shapeSvg(item)
  }

  // Names or initials, above the furniture.
  const printed: PrintedName[] = []
  const tableLabels: SeatLabel[] = []
  let squeezed = 0
  let nameLayer = ''
  if (input.detail !== 'tables') {
    for (const item of furniture) {
      if (item.kind !== 'table' && item.kind !== 'chairRow') continue
      const local: Point[] =
        item.kind === 'table' ? seatLocalLayout(item).map((p) => ({ x: p.x, y: p.y })) : chairLocalXs(item).map((x) => ({ x, y: 0 }))
      let inner = ''
      if (input.detail === 'initials') {
        item.seats.forEach((seat, i) => {
          const guest = seat.guestId ? input.names.get(seat.guestId) : undefined
          if (!seat.guestId || !guest || !local[i]) return
          const text = initialsFor(guest)
          inner += initialsText(local[i].x, local[i].y, settings.initialsFont, text, -item.rotation, seat.guestId)
          printed.push({ itemId: item.id, seatIndex: i, guestId: seat.guestId, form: 'initials', text, fontPt: settings.initialsFont * scale })
        })
      } else if (item.kind === 'table') {
        const labels = (names.tables.get(item.id) ?? []).filter((l) => item.seats[l.seatIndex]?.guestId === l.guestId)
        for (const l of labels) {
          tableLabels.push(l)
          if (l.form !== 'full') squeezed++
          if (l.form === 'initials') {
            const p = local[l.seatIndex]
            if (!p) continue
            inner += initialsText(p.x, p.y, settings.initialsFont, l.text, -item.rotation, l.guestId)
            printed.push({ itemId: item.id, seatIndex: l.seatIndex, guestId: l.guestId, form: 'initials', text: l.text, fontPt: settings.initialsFont * scale })
            continue
          }
          inner += el(
            'text',
            {
              x: 0,
              y: l.fontSize * MIDDLE_EM,
              transform: `translate(${n(l.local.x)} ${n(l.local.y)})${l.local.rotation ? ` rotate(${n(l.local.rotation)})` : ''}`,
              'text-anchor': l.anchor,
              'font-size': l.fontSize,
              fill: INK,
              'data-guest': l.guestId,
            },
            escapeXml(l.text),
          )
          printed.push({ itemId: item.id, seatIndex: l.seatIndex, guestId: l.guestId, form: l.form, text: l.text, fontPt: l.fontSize * scale })
        }
      } else {
        for (const l of names.rows.get(item.id) ?? []) {
          if (l.form !== 'full') squeezed++
          if (l.form === 'initials') {
            const p = local[l.seatIndex]
            if (!p) continue
            inner += initialsText(p.x, p.y, settings.initialsFont, l.text, -item.rotation, l.guestId)
            printed.push({ itemId: item.id, seatIndex: l.seatIndex, guestId: l.guestId, form: 'initials', text: l.text, fontPt: settings.initialsFont * scale })
            continue
          }
          inner += el(
            'text',
            {
              x: 0,
              y: l.fontSize * MIDDLE_EM,
              transform: `translate(${n(l.x)} ${n(l.y)}) rotate(${n(l.rotation)})`,
              'text-anchor': l.anchor,
              'font-size': l.fontSize,
              fill: INK,
              'data-guest': l.guestId,
            },
            escapeXml(l.text),
          )
          printed.push({ itemId: item.id, seatIndex: l.seatIndex, guestId: l.guestId, form: l.form, text: l.text, fontPt: l.fontSize * scale })
        }
      }
      if (inner) nameLayer += el('g', { transform: poseTransform(item) }, inner)
    }
  }
  world += nameLayer
  world += notes.map(noteSvg).join('')

  // Placed in the middle of the frame.
  let placed = ''
  if (box) {
    const tx = frame.x + (frame.width - (box.maxX - box.minX) * scale) / 2 - box.minX * scale
    const ty = frame.y + (frame.height - (box.maxY - box.minY) * scale) / 2 - box.minY * scale
    placed = el('g', { transform: `matrix(${n(scale)} 0 0 ${n(scale)} ${n(tx)} ${n(ty)})` }, world)
  } else {
    placed = textAt(width / 2, frame.y + frame.height / 2, 14, 'Nothing on this plan yet.', { 'text-anchor': 'middle', fill: INK_SOFT })
  }

  // Title, subtitle and date along the top.
  const titleWidth = (width - 2 * PRINT_MARGIN_PT) * 0.7
  const title = fitText(input.title, titleWidth, 16, 10)
  let header = el('text', { x: PRINT_MARGIN_PT, y: PRINT_MARGIN_PT + 14, 'font-size': title.fontSize, 'font-weight': 700, fill: INK }, escapeXml(title.text))
  if (input.subtitle?.trim()) {
    const sub = fitText(input.subtitle, titleWidth, 10, 8)
    header += el('text', { x: PRINT_MARGIN_PT, y: PRINT_MARGIN_PT + 30, 'font-size': sub.fontSize, fill: INK_SOFT }, escapeXml(sub.text))
  }
  header += el('text', { x: width - PRINT_MARGIN_PT, y: PRINT_MARGIN_PT + 14, 'font-size': 10, 'text-anchor': 'end', fill: INK_SOFT }, escapeXml(input.date))

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg"${attrs({ width: `${paper.widthIn}in`, height: `${paper.heightIn}in`, viewBox: `0 0 ${width} ${height}`, 'font-family': PRINT_FONT_FAMILY })}>` +
    el('rect', { x: 0, y: 0, width, height, fill: '#ffffff' }) +
    header +
    placed +
    '</svg>'

  return { svg, width, height, scale, names: printed, tableLabels, squeezed }
}
