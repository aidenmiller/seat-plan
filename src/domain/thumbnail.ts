/**
 * The small vector preview on the layouts list (PLAN section 4, layouts.thumb_svg).
 *
 * Draws walls and room outlines as thin grey lines, tables filled darker the
 * fuller they are, fixtures as light grey boxes and chair rows as short lines.
 * Notes, labels and every other piece of text are left out.
 *
 * Safe to inline: the output holds fixed tag and attribute names, fixed colors
 * and numbers computed here. No string from the canvas or the template ever
 * reaches the output, so nothing a person typed can add markup.
 */
import type { Canvas, ChairRow, Fixture, Shape, Table } from './canvas-schema'
import type { FixedItem } from './venue-schema'

export const THUMB_WIDTH = 320
export const THUMB_HEIGHT = 200

const BACKGROUND = '#f8fafc'
const LINE = '#9ca3af'
const FIXTURE_FILL = '#e5e7eb'
const FIXTURE_STROKE = '#cbd5e1'
const TABLE_STROKE = '#1e3a8a'
type Rgb = readonly [number, number, number]
/** Tables: #dbeafe at empty, #1e3a8a at full. */
const EMPTY_RGB: Rgb = [0xdb, 0xea, 0xfe]
const FULL_RGB: Rgb = [0x1e, 0x3a, 0x8a]
/** Chair rows have no outline, so their empty color is a little darker (#93c5fd). */
const EMPTY_ROW_RGB: Rgb = [0x93, 0xc5, 0xfd]
/** Seat circle size (DECISIONS 4), used for the length and weight of chair rows. */
const SEAT_CM = 45

type Point = { x: number; y: number }

/** A finite number rounded to 0.1, as text. Anything else becomes 0. */
function num(value: number): string {
  if (!Number.isFinite(value)) return '0'
  const rounded = Math.round(value * 10) / 10
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

function rotatePoint(p: Point, degrees: number): Point {
  const r = (degrees * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }
}

/** Fill for a table or row from how many of its seats are taken. */
export function fullnessColor(seated: number, seats: number, empty: Rgb = EMPTY_RGB): string {
  const t = seats > 0 ? Math.min(1, Math.max(0, seated / seats)) : 0
  const channel = (i: 0 | 1 | 2) => Math.round(empty[i] + (FULL_RGB[i] - empty[i]) * t)
  const hex = (v: number) => v.toString(16).padStart(2, '0')
  return `#${hex(channel(0))}${hex(channel(1))}${hex(channel(2))}`
}

class Bounds {
  minX = Infinity
  minY = Infinity
  maxX = -Infinity
  maxY = -Infinity
  add(x: number, y: number) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    this.minX = Math.min(this.minX, x)
    this.minY = Math.min(this.minY, y)
    this.maxX = Math.max(this.maxX, x)
    this.maxY = Math.max(this.maxY, y)
  }
  addBox(cx: number, cy: number, w: number, h: number, rotation: number) {
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      const p = rotatePoint({ x: (sx * w) / 2, y: (sy * h) / 2 }, rotation)
      this.add(cx + p.x, cy + p.y)
    }
  }
  get empty() {
    return this.minX > this.maxX
  }
}

/** Mark-up pieces, each built from fixed text and num() only. */
type Drawn = string[]

function line(points: Point[], stroke: string, width: number, closed: boolean): string {
  const pts = points.map((p) => `${num(p.x)},${num(p.y)}`).join(' ')
  const tag = closed ? 'polygon' : 'polyline'
  return `<${tag} points="${pts}" fill="none" stroke="${stroke}" stroke-width="${num(width)}" stroke-linejoin="round"/>`
}

function box(cx: number, cy: number, w: number, h: number, rotation: number, fill: string, stroke: string, sw: number) {
  return (
    `<rect x="${num(-w / 2)}" y="${num(-h / 2)}" width="${num(w)}" height="${num(h)}" ` +
    `transform="translate(${num(cx)} ${num(cy)}) rotate(${num(rotation)})" ` +
    `fill="${fill}" stroke="${stroke}" stroke-width="${num(sw)}"/>`
  )
}

function circle(cx: number, cy: number, r: number, fill: string, stroke: string, sw: number) {
  return `<circle cx="${num(cx)}" cy="${num(cy)}" r="${num(r)}" fill="${fill}" stroke="${stroke}" stroke-width="${num(sw)}"/>`
}

/** Canvas shape points are offsets from the shape's center, turned with it. */
function shapeWorldPoints(shape: Shape): Point[] | null {
  if (!shape.points || shape.points.length < 2) return null
  return shape.points.map((p) => {
    const r = rotatePoint(p, shape.rotation)
    return { x: shape.x + r.x, y: shape.y + r.y }
  })
}

function rowLength(row: ChairRow): number {
  return Math.max(0, row.chairCount - 1) * row.spacing + SEAT_CM
}

function seatedCount(item: Table | ChairRow): number {
  return item.seats.reduce((n, s) => n + (s.guestId === null ? 0 : 1), 0)
}

function emptySvg(): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${THUMB_WIDTH}" height="${THUMB_HEIGHT}" ` +
    `viewBox="0 0 ${THUMB_WIDTH} ${THUMB_HEIGHT}" preserveAspectRatio="xMidYMid meet">` +
    `<rect width="${THUMB_WIDTH}" height="${THUMB_HEIGHT}" fill="${BACKGROUND}"/></svg>`
  )
}

export function renderThumbnailSvg(canvas: Canvas, fixedItems: readonly FixedItem[] = []): string {
  // First pass: the area to show.
  const bounds = new Bounds()
  for (const f of fixedItems) {
    switch (f.type) {
      case 'wall':
      case 'room':
      case 'patioEdge':
        for (const p of f.points) bounds.add(p.x, p.y)
        break
      case 'column':
      case 'stairs':
      case 'bar':
        bounds.addBox(f.x, f.y, f.width, f.height, f.rotation)
        break
      default:
        break
    }
  }
  for (const item of canvas.items) {
    switch (item.kind) {
      case 'table':
      case 'fixture':
        bounds.addBox(item.x, item.y, item.width, item.height, item.rotation)
        break
      case 'chairRow':
        bounds.addBox(item.x, item.y, rowLength(item), SEAT_CM, item.rotation)
        break
      case 'shape': {
        if (item.type !== 'wall' && item.type !== 'room') break
        const pts = shapeWorldPoints(item)
        if (pts) for (const p of pts) bounds.add(p.x, p.y)
        else bounds.addBox(item.x, item.y, item.width, item.type === 'wall' ? 0 : item.height, item.rotation)
        break
      }
      default:
        break
    }
  }
  if (bounds.empty) return emptySvg()

  // Pad, then widen the short side so the box matches 320 x 200 exactly and
  // the light background fills the whole picture.
  let w = Math.max(bounds.maxX - bounds.minX, 1)
  let h = Math.max(bounds.maxY - bounds.minY, 1)
  const pad = Math.max(Math.max(w, h) * 0.05, 30)
  const cx = (bounds.minX + bounds.maxX) / 2
  const cy = (bounds.minY + bounds.maxY) / 2
  w += pad * 2
  h += pad * 2
  const aspect = THUMB_WIDTH / THUMB_HEIGHT
  if (w / h > aspect) h = w / aspect
  else w = h * aspect
  const minX = cx - w / 2
  const minY = cy - h / 2
  /** Centimeters per thumbnail pixel. */
  const px = w / THUMB_WIDTH

  // Second pass: draw, venue first, then the layout in drawing order.
  const out: Drawn = []
  for (const f of fixedItems) {
    switch (f.type) {
      case 'wall':
      case 'patioEdge':
        out.push(line(f.points, LINE, px, false))
        break
      case 'room':
        out.push(line(f.points, LINE, px * 0.75, true))
        break
      case 'column':
        if (f.shape === 'round') out.push(circle(f.x, f.y, Math.max(f.width, f.height) / 2, FIXTURE_FILL, FIXTURE_STROKE, px * 0.5))
        else out.push(box(f.x, f.y, f.width, f.height, f.rotation, FIXTURE_FILL, FIXTURE_STROKE, px * 0.5))
        break
      case 'stairs':
      case 'bar':
        out.push(box(f.x, f.y, f.width, f.height, f.rotation, FIXTURE_FILL, FIXTURE_STROKE, px * 0.5))
        break
      default:
        break
    }
  }
  for (const item of canvas.items) {
    switch (item.kind) {
      case 'shape': {
        if (item.type !== 'wall' && item.type !== 'room') break
        const pts = shapeWorldPoints(item)
        const closed = item.type === 'room'
        if (pts) {
          out.push(line(pts, LINE, closed ? px * 0.75 : px, closed))
        } else if (closed) {
          out.push(box(item.x, item.y, item.width, item.height, item.rotation, 'none', LINE, px * 0.75))
        } else {
          const a = rotatePoint({ x: -item.width / 2, y: 0 }, item.rotation)
          out.push(line([{ x: item.x + a.x, y: item.y + a.y }, { x: item.x - a.x, y: item.y - a.y }], LINE, px, false))
        }
        break
      }
      case 'fixture':
        out.push(fixtureBox(item, px))
        break
      case 'table': {
        const fill = fullnessColor(seatedCount(item), item.seatCount)
        if (item.shape === 'round') out.push(circle(item.x, item.y, item.width / 2, fill, TABLE_STROKE, px * 0.75))
        else out.push(box(item.x, item.y, item.width, item.height, item.rotation, fill, TABLE_STROKE, px * 0.75))
        break
      }
      case 'chairRow': {
        const half = rotatePoint({ x: rowLength(item) / 2 - SEAT_CM / 2, y: 0 }, item.rotation)
        const color = fullnessColor(seatedCount(item), item.chairCount, EMPTY_ROW_RGB)
        const weight = Math.max(SEAT_CM * 0.6, px * 2)
        out.push(
          `<line x1="${num(item.x - half.x)}" y1="${num(item.y - half.y)}" x2="${num(item.x + half.x)}" y2="${num(item.y + half.y)}" ` +
            `stroke="${color}" stroke-width="${num(weight)}" stroke-linecap="round"/>`,
        )
        break
      }
      default:
        break
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${THUMB_WIDTH}" height="${THUMB_HEIGHT}" ` +
    `viewBox="${num(minX)} ${num(minY)} ${num(w)} ${num(h)}" preserveAspectRatio="xMidYMid meet">` +
    `<rect x="${num(minX)}" y="${num(minY)}" width="${num(w)}" height="${num(h)}" fill="${BACKGROUND}"/>` +
    out.join('') +
    `</svg>`
  )
}

function fixtureBox(item: Fixture, px: number): string {
  return box(item.x, item.y, item.width, item.height, item.rotation, FIXTURE_FILL, FIXTURE_STROKE, px * 0.5)
}
