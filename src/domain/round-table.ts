/**
 * The bare canvas's round tables (milestone 2), now a thin layer over the
 * full modules: seat placement in seats.ts, footprints in geometry.ts and
 * presets and table numbers in presets.ts. Kept for its callers; new code
 * should use those modules directly.
 */
import type { Canvas, Item, Table } from './canvas-schema'
import { contentBox, footprintBox, type Box, type Point } from './geometry'
import { makeItem, nextTableNumber, presetFootprintSize, TABLE_PRESETS } from './presets'
import { seatLocalPositions } from './seats'
import { DEFAULT_MIN_GAP_CM } from './spacing'

export type { Box, Point }
export { nextTableNumber }
export { SEAT_DIAMETER_CM, SEAT_GAP_CM } from './seats'

const ROUND = TABLE_PRESETS.find((p) => p.id === 'round') as (typeof TABLE_PRESETS)[number]
/** The Round preset: 60 in across, 8 seats (PLAN section 6, "Tables and seats"). */
export const ROUND_PRESET_CM = ROUND.width
export const ROUND_PRESET_SEATS = ROUND.seatCount
/** The default minimum gap between tables, 5 ft (PLAN section 4, weddings.min_gap_cm). */
export const DEFAULT_GAP_CM = DEFAULT_MIN_GAP_CM

/** Seat centers in the table's own frame (before its rotation), in seat order. See seats.ts. */
export function seatPositions(table: Pick<Table, 'shape' | 'width' | 'height' | 'seatCount'> & Partial<Pick<Table, 'seatSides'>>): Point[] {
  return seatLocalPositions({ ...table, seatSides: table.seatSides ?? 'all' })
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000
}

/** The area an item covers, seats included, as an upright box. */
export function footprint(item: Item): Box | null {
  return footprintBox(item)
}

/** The box around every item, or null for an empty canvas. */
export function contentBounds(canvas: Canvas): Box | null {
  return contentBox(canvas)
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
  const { width } = presetFootprintSize('round')
  return makeItem('round', freeSpot(canvas, width, gap), id, canvas) as Table
}

/** The canvas with a new round table added on top. */
export function addRoundTable(canvas: Canvas, id: string, gap = DEFAULT_GAP_CM): Canvas {
  return { ...canvas, items: [...canvas.items, newRoundTable(canvas, id, gap)] }
}
