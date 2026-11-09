/**
 * Just enough table geometry for milestone 2's bare canvas: seat positions
 * evenly spaced around a table, the next table number (PLAN change 3) and a
 * spot for a new round table where it overlaps nothing. Milestone 3's seat
 * module replaces the seat positions with the full rules (DECISIONS 4 to 8).
 */
import type { Canvas, Item, Table } from './canvas-schema'

/** The Round preset: 60 in across, 8 seats (PLAN section 6, "Tables and seats"). */
export const ROUND_PRESET_CM = 152.4
export const ROUND_PRESET_SEATS = 8
/** Seat circles are 45 cm across and sit 8 cm out from the table edge (DECISIONS 4). */
export const SEAT_DIAMETER_CM = 45
export const SEAT_GAP_CM = 8
/** The default minimum gap between tables, 5 ft (PLAN section 4, weddings.min_gap_cm). */
export const DEFAULT_GAP_CM = 152.4

export type Point = { x: number; y: number }
export type Box = { minX: number; minY: number; maxX: number; maxY: number }

const SEAT_OUT = SEAT_GAP_CM + SEAT_DIAMETER_CM / 2

/**
 * Seat centers in the table's own frame (before its rotation), in seat order.
 * Round tables: evenly around the circle, seat 0 at the top, going clockwise.
 * Square and rect tables: evenly along the outline, clockwise from the top
 * left corner.
 */
export function seatPositions(table: Pick<Table, 'shape' | 'width' | 'height' | 'seatCount'>): Point[] {
  const n = table.seatCount
  if (n <= 0) return []
  if (table.shape === 'round') {
    const r = table.width / 2 + SEAT_OUT
    return Array.from({ length: n }, (_, i) => {
      const a = (2 * Math.PI * i) / n
      return { x: round(r * Math.sin(a)), y: round(-r * Math.cos(a)) }
    })
  }
  const w = table.width + 2 * SEAT_OUT
  const h = table.height + 2 * SEAT_OUT
  const perimeter = 2 * (w + h)
  return Array.from({ length: n }, (_, i) => pointOnOutline(w, h, ((i + 0.5) / n) * perimeter))
}

/** The point `d` along a w by h rectangle's outline, from its top left corner, clockwise. */
function pointOnOutline(w: number, h: number, distance: number): Point {
  const perimeter = 2 * (w + h)
  let d = ((distance % perimeter) + perimeter) % perimeter
  if (d <= w) return { x: round(-w / 2 + d), y: round(-h / 2) }
  d -= w
  if (d <= h) return { x: round(w / 2), y: round(-h / 2 + d) }
  d -= h
  if (d <= w) return { x: round(w / 2 - d), y: round(h / 2) }
  d -= w
  return { x: round(-w / 2), y: round(h / 2 - d) }
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000
}

function rotate(p: Point, degrees: number): Point {
  const r = (degrees * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }
}

/** A box around a w by h rectangle centered on (cx, cy) and turned by `rotation`. */
function rotatedBox(cx: number, cy: number, w: number, h: number, rotation: number): Box {
  const box: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    const p = rotate({ x: (sx * w) / 2, y: (sy * h) / 2 }, rotation)
    box.minX = Math.min(box.minX, cx + p.x)
    box.minY = Math.min(box.minY, cy + p.y)
    box.maxX = Math.max(box.maxX, cx + p.x)
    box.maxY = Math.max(box.maxY, cy + p.y)
  }
  return box
}

/** The area an item covers, seats included, as an upright box. Null for items with no size to speak of. */
export function footprint(item: Item): Box | null {
  switch (item.kind) {
    case 'table': {
      const out = item.seatCount > 0 ? 2 * (SEAT_OUT + SEAT_DIAMETER_CM / 2) : 0
      if (item.shape === 'round') {
        const r = (item.width + out) / 2
        return { minX: item.x - r, minY: item.y - r, maxX: item.x + r, maxY: item.y + r }
      }
      return rotatedBox(item.x, item.y, item.width + out, item.height + out, item.rotation)
    }
    case 'chairRow': {
      const length = Math.max(0, item.chairCount - 1) * item.spacing + SEAT_DIAMETER_CM
      return rotatedBox(item.x, item.y, length, SEAT_DIAMETER_CM, item.rotation)
    }
    case 'fixture':
      return rotatedBox(item.x, item.y, item.width, item.height, item.rotation)
    case 'shape':
    case 'note': {
      if (item.points && item.points.length > 0) {
        const box: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
        for (const pt of item.points) {
          const p = rotate(pt, item.rotation)
          box.minX = Math.min(box.minX, item.x + p.x)
          box.minY = Math.min(box.minY, item.y + p.y)
          box.maxX = Math.max(box.maxX, item.x + p.x)
          box.maxY = Math.max(box.maxY, item.y + p.y)
        }
        return box
      }
      return rotatedBox(item.x, item.y, item.width, item.height, item.rotation)
    }
  }
}

/** The box around every item, or null for an empty canvas. */
export function contentBounds(canvas: Canvas): Box | null {
  let box: Box | null = null
  for (const item of canvas.items) {
    const f = footprint(item)
    if (!f) continue
    box = box
      ? { minX: Math.min(box.minX, f.minX), minY: Math.min(box.minY, f.minY), maxX: Math.max(box.maxX, f.maxX), maxY: Math.max(box.maxY, f.maxY) }
      : f
  }
  return box
}

/** The highest table number plus one (PLAN change 3), or 1 for the first table. */
export function nextTableNumber(canvas: Canvas): number {
  let max = 0
  for (const item of canvas.items) if (item.kind === 'table' && item.number > max) max = item.number
  return max + 1
}

function overlaps(a: Box, b: Box, gap: number): boolean {
  return a.minX < b.maxX + gap && b.minX < a.maxX + gap && a.minY < b.maxY + gap && b.minY < a.maxY + gap
}

/**
 * The center for a new item of the given footprint size, so that it keeps at
 * least `gap` from everything already there. Tries a grid from the top left
 * of the existing content, row by row, so new tables line up in rows.
 */
export function freeSpot(canvas: Canvas, size: number, gap = DEFAULT_GAP_CM, perRow = 5): Point {
  const boxes = canvas.items.map(footprint).filter((b): b is Box => b !== null)
  if (boxes.length === 0) return { x: 0, y: 0 }
  const bounds = contentBounds(canvas)!
  const step = size + gap
  const half = size / 2
  const columns = Math.max(perRow, Math.ceil((bounds.maxX - bounds.minX) / step) + 1)
  for (let row = 0; row < 10_000; row++) {
    for (let col = 0; col < columns; col++) {
      const x = round(bounds.minX + half + col * step)
      const y = round(bounds.minY + half + row * step)
      const box: Box = { minX: x - half, minY: y - half, maxX: x + half, maxY: y + half }
      if (!boxes.some((b) => overlaps(box, b, gap))) return { x, y }
    }
  }
  // Unreachable with a finite canvas: the rows below the content are always free.
  return { x: round(bounds.minX + half), y: round(bounds.maxY + gap + half) }
}

/** A new Round preset table with empty seats, numbered and placed so it overlaps nothing. */
export function newRoundTable(canvas: Canvas, id: string, gap = DEFAULT_GAP_CM): Table {
  const number = nextTableNumber(canvas)
  const size = ROUND_PRESET_CM + 2 * (SEAT_OUT + SEAT_DIAMETER_CM / 2)
  const { x, y } = freeSpot(canvas, size, gap)
  return {
    id,
    kind: 'table',
    shape: 'round',
    x,
    y,
    rotation: 0,
    locked: false,
    width: ROUND_PRESET_CM,
    height: ROUND_PRESET_CM,
    number,
    name: `Table ${number}`,
    seatCount: ROUND_PRESET_SEATS,
    seatSides: 'all',
    seats: Array.from({ length: ROUND_PRESET_SEATS }, (_, index) => ({ index, guestId: null })),
  }
}

/** The canvas with a new round table added on top. */
export function addRoundTable(canvas: Canvas, id: string, gap = DEFAULT_GAP_CM): Canvas {
  return { ...canvas, items: [...canvas.items, newRoundTable(canvas, id, gap)] }
}
