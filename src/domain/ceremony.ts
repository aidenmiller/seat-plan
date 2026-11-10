/**
 * Ceremony layouts (spec section 8; PLAN section 7, "Ceremony", and change
 * 18; DECISIONS 34).
 *
 *  - generateSeatingBlock: rows of chairs either side of an aisle, one chair
 *    row item per side per row, numbered from the front. Each side is its
 *    own block (blockId), labelled with the side ("Noa's side").
 *  - addRowBehind: one more row behind a block's back row, with the next
 *    number.
 *  - setChairCount and setRowSpacing: the aisle end of the row stays put;
 *    chairs come and go at the other end, empty ones first, and guests keep
 *    their order. Guests who would lose their chair are named, highest seat
 *    numbers first, as on tables.
 *  - chairLocalXs: where each chair sits along the row.
 *  - chairNameLabels: names at close level, beside each taken chair,
 *    running back from the row into the space before the next row.
 *
 * A row's own frame: chairs along x, seat 1 at the left end; guests face
 * -y, so "behind" is +y. Lengths in cm. Pure.
 */
import type { Canvas, ChairRow, Seat } from './canvas-schema'
import { MAX_SEATS_RECT } from './canvas-schema'
import { MIN_NAME_PX } from './detail-level'
import { chairRowLength, localToWorld, normalizeDegrees, rotatePoint, worldToLocal, type Point } from './geometry'
import { fullLabel, shortLabel, initialsFor, LABEL_GAP_CM, MAX_LABEL_FONT_CM, type LabelName, type MeasureText } from './labels'
import { emptySeats, SEAT_DIAMETER_CM, SEAT_RADIUS_CM } from './seats'

/** 20 in from one chair's center to the next. */
export const CHAIR_PITCH_CM = 50.8
/** 36 in from one row to the next. */
export const ROW_PITCH_CM = 91.44
/** 6 ft between the two blocks' inner chairs. */
export const AISLE_WIDTH_CM = 182.88
export const DEFAULT_LEFT_LABEL = "Noa's side"
export const DEFAULT_RIGHT_LABEL = "Aiden's side"
export const MAX_BLOCK_ROWS = 60
export const MAX_CHAIRS_PER_ROW = MAX_SEATS_RECT

export type SeatingBlockOptions = {
  rows: number
  chairsPerRow: number
  aisleWidthCm?: number
  rowPitchCm?: number
  chairPitchCm?: number
  leftLabel?: string
  rightLabel?: string
  /** The middle of the aisle, level with the front row's chairs. */
  origin: Point
  /** Degrees clockwise. 0: the guests face up the plan (-y). */
  facing?: number
}

/** Chair centers along the row, in the row's own frame, seat 1 first. */
export function chairLocalXs(row: Pick<ChairRow, 'chairCount' | 'spacing'>): number[] {
  const first = -chairRowLength(row) / 2 + SEAT_RADIUS_CM
  return Array.from({ length: Math.max(0, row.chairCount) }, (_, i) => first + i * row.spacing)
}

/** Chair centers on the canvas, seat 1 first. */
export function chairPositions(row: Pick<ChairRow, 'x' | 'y' | 'rotation' | 'chairCount' | 'spacing'>): Point[] {
  return chairLocalXs(row).map((x) => localToWorld(row, { x, y: 0 }))
}

/** "Row 3" unless the row has its own label. */
export function rowName(row: Pick<ChairRow, 'rowLabel' | 'rowNumber'>): string {
  return row.rowLabel.trim() || `Row ${row.rowNumber}`
}

function clampInt(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(Number.isFinite(n) ? n : min)))
}

/**
 * Two blocks of chair rows either side of an aisle, row 1 at the front.
 * Returns the rows front to back, left side first in each row.
 */
export function generateSeatingBlock(options: SeatingBlockOptions, newId: () => string): ChairRow[] {
  const rows = clampInt(options.rows, 1, MAX_BLOCK_ROWS)
  const chairs = clampInt(options.chairsPerRow, 1, MAX_CHAIRS_PER_ROW)
  const aisle = Math.max(0, options.aisleWidthCm ?? AISLE_WIDTH_CM)
  const rowPitch = options.rowPitchCm ?? ROW_PITCH_CM
  const spacing = options.chairPitchCm ?? CHAIR_PITCH_CM
  const facing = options.facing ?? 0
  const leftLabel = options.leftLabel?.trim() || DEFAULT_LEFT_LABEL
  const rightLabel = options.rightLabel?.trim() || DEFAULT_RIGHT_LABEL
  const half = aisle / 2 + chairRowLength({ chairCount: chairs, spacing }) / 2
  const leftBlock = newId()
  const rightBlock = newId()
  const out: ChairRow[] = []
  for (let r = 0; r < rows; r++) {
    for (const side of ['left', 'right'] as const) {
      const local = { x: side === 'left' ? -half : half, y: r * rowPitch }
      const at = localToWorld({ x: options.origin.x, y: options.origin.y, rotation: facing }, local)
      out.push({
        id: newId(),
        kind: 'chairRow',
        x: at.x,
        y: at.y,
        rotation: facing,
        locked: false,
        chairCount: chairs,
        spacing,
        blockId: side === 'left' ? leftBlock : rightBlock,
        blockLabel: side === 'left' ? leftLabel : rightLabel,
        rowNumber: r + 1,
        rowLabel: '',
        reservedFor: null,
        aisleEnd: side === 'left' ? 'right' : 'left',
        seats: emptySeats(chairs),
      })
    }
  }
  return out
}

/** How deep a block is from its front row to its back row, for centering it. */
export function blockDepth(rows: number, rowPitchCm = ROW_PITCH_CM): number {
  return Math.max(0, clampInt(rows, 1, MAX_BLOCK_ROWS) - 1) * rowPitchCm
}

/** The rows of the row's block, front to back; the row alone when it has no block. */
export function blockRows(items: Canvas['items'], row: ChairRow): ChairRow[] {
  if (row.blockId === null) return [row]
  return items.filter((i): i is ChairRow => i.kind === 'chairRow' && i.blockId === row.blockId).sort((a, b) => a.rowNumber - b.rowNumber)
}

/**
 * A new empty row behind the block's back row (or behind this row when it
 * has no block): same chairs, spacing and side, the next row number, and
 * the block's own row pitch (36 in for a block of one row).
 */
export function addRowBehind(items: Canvas['items'], row: ChairRow, id: string): ChairRow {
  const rows = blockRows(items, row)
  const back = rows[rows.length - 1] ?? row
  let pitch = ROW_PITCH_CM
  if (rows.length >= 2) {
    const prev = rows[rows.length - 2]
    const gap = worldToLocal(prev, { x: back.x, y: back.y }).y
    if (gap > SEAT_DIAMETER_CM) pitch = gap
  }
  const at = localToWorld(back, { x: 0, y: pitch })
  const next: ChairRow = {
    ...back,
    id,
    x: at.x,
    y: at.y,
    locked: false,
    rowNumber: Math.min(999, Math.max(...rows.map((r) => r.rowNumber)) + 1),
    rowLabel: '',
    reservedFor: null,
    seats: emptySeats(back.chairCount),
  }
  return next
}

export type ChairCountPlan = {
  row: ChairRow
  /** Guests who lose their chair, highest seat numbers first. */
  unseated: string[]
}

/** Moves the row along its own x axis so the end `fixed` stays where it was. */
function keepEnd(row: ChairRow, next: ChairRow): Pick<ChairRow, 'x' | 'y'> {
  const delta = chairRowLength(next) - chairRowLength(row)
  const dir = row.aisleEnd === 'right' ? -1 : 1
  const shift = rotatePoint({ x: (dir * delta) / 2, y: 0 }, row.rotation)
  return { x: row.x + shift.x, y: row.y + shift.y }
}

function reindex(seats: readonly Seat[]): Seat[] {
  return seats.map((s, index) => (s.index === index ? s : { ...s, index }))
}

/**
 * A new chair count, 1 to 60. Chairs come and go at the end away from the
 * aisle. Fewer chairs take empty ones first, nearest that end, so seated
 * guests keep their order; when too few are empty, the guests in the
 * highest seat numbers from the aisle lose their chair.
 */
export function setChairCount(row: ChairRow, count: number): ChairCountPlan {
  const n = clampInt(count, 1, MAX_CHAIRS_PER_ROW)
  if (n === row.chairCount) return { row, unseated: [] }
  // Seats ordered from the fixed (aisle) end outward.
  const fromFixed = row.aisleEnd === 'right' ? [...row.seats].reverse() : [...row.seats]
  const unseated: string[] = []
  if (n > fromFixed.length) {
    for (let i = fromFixed.length; i < n; i++) fromFixed.push({ index: i, guestId: null })
  } else {
    let remove = fromFixed.length - n
    for (let i = fromFixed.length - 1; i >= 0 && remove > 0; i--) {
      if (fromFixed[i].guestId === null) {
        fromFixed.splice(i, 1)
        remove--
      }
    }
    while (remove > 0) {
      const gone = fromFixed.pop()
      if (gone?.guestId) unseated.push(gone.guestId)
      remove--
    }
  }
  const seats = reindex(row.aisleEnd === 'right' ? fromFixed.reverse() : fromFixed)
  const next: ChairRow = { ...row, chairCount: n, seats }
  return { row: { ...next, ...keepEnd(row, next) }, unseated }
}

/** A new spacing from chair to chair (at least a chair's width), keeping the aisle end where it is. */
export function setRowSpacing(row: ChairRow, spacingCm: number): ChairRow {
  if (!Number.isFinite(spacingCm)) return row
  const spacing = Math.max(SEAT_DIAMETER_CM, Math.min(500, spacingCm))
  if (Math.abs(spacing - row.spacing) < 1e-9) return row
  const next: ChairRow = { ...row, spacing }
  return { ...next, ...keepEnd(row, next) }
}

/** Chairs in the ceremony layout and chairs in rows reserved with a label. */
export function chairTotals(items: Canvas['items']): { chairs: number; reserved: number } {
  let chairs = 0
  let reserved = 0
  for (const item of items) {
    if (item.kind !== 'chairRow') continue
    chairs += item.chairCount
    if (item.reservedFor?.trim()) reserved += item.chairCount
  }
  return { chairs, reserved }
}

// ---------------------------------------------------------------- names at close level

/** A name never runs further back than this, with nothing behind the row. */
export const MAX_CHAIR_NAME_ROOM_CM = 120
const START_CM = SEAT_RADIUS_CM + LABEL_GAP_CM
const LANE_SHARE = 0.8
const LINE_HEIGHT_EM = 1.2

export type ChairNameLabel = {
  seatIndex: number
  guestId: string
  form: 'full' | 'short' | 'initials'
  text: string
  /** Font size in cm; 0 for initials (the chair circle shows them). */
  fontSize: number
  /** Where the text is anchored, in the row's own frame. */
  x: number
  y: number
  /** Degrees, in the row's own frame: 90 reads away from the chair, -90 (with 'end') reads toward it. */
  rotation: number
  anchor: 'start' | 'end'
}

export type ChairNameInput = {
  row: ChairRow
  /** Every chair row on the canvas: the ones behind this row stop its names. */
  rows: readonly ChairRow[]
  names: ReadonlyMap<string, LabelName>
  /** The settled zoom: 10 px on screen is 10 / zoom cm. */
  zoom: number
  measure: MeasureText
}

/** How far back from each chair a name can run before it meets another row's chairs. */
function roomBehind(row: ChairRow, xs: readonly number[], rows: readonly ChairRow[]): number[] {
  const room = xs.map(() => MAX_CHAIR_NAME_ROOM_CM)
  for (const other of rows) {
    if (other.id === row.id) continue
    for (const p of chairPositions(other)) {
      const local = worldToLocal(row, p)
      if (local.y <= 0) continue
      const free = local.y - SEAT_RADIUS_CM - LABEL_GAP_CM - START_CM
      xs.forEach((x, i) => {
        if (Math.abs(local.x - x) < SEAT_DIAMETER_CM && free < room[i]) room[i] = Math.max(0, free)
      })
    }
  }
  return room
}

/**
 * Each taken chair's name, running back from the chair: the full name,
 * else the first name and last initial, each shrunk as far as 10 px on
 * screen to fit before the next row, else initials inside the chair (as at
 * middle level).
 * The text turns so it never reads upside down.
 */
export function chairNameLabels(input: ChairNameInput): ChairNameLabel[] {
  const { row, names, measure } = input
  const xs = chairLocalXs(row)
  const room = roomBehind(row, xs, input.rows)
  const maxFont = Math.min(MAX_LABEL_FONT_CM, (row.spacing * LANE_SHARE) / LINE_HEIGHT_EM)
  const minFont = input.zoom > 0 ? MIN_NAME_PX / input.zoom : maxFont
  const world = normalizeDegrees(row.rotation + 90)
  const flipped = world > 90 && world <= 270
  const out: ChairNameLabel[] = []
  row.seats.forEach((seat, i) => {
    const guest = seat.guestId ? names.get(seat.guestId) : undefined
    if (!seat.guestId || !guest || xs[i] === undefined) return
    const base = { seatIndex: i, guestId: seat.guestId, x: xs[i], y: START_CM, rotation: flipped ? -90 : 90, anchor: flipped ? ('end' as const) : ('start' as const) }
    // Rows sit close, so both forms may shrink, down to 10 px on screen.
    for (const [form, text] of [
      ['full', fullLabel(guest)],
      ['short', shortLabel(guest)],
    ] as const) {
      const width = text ? measure(text, maxFont) : 0
      const size = width > 0 ? Math.min(maxFont, (maxFont * room[i]) / width) : 0
      if (size > 0 && size >= minFont) {
        out.push({ ...base, form, text, fontSize: size })
        return
      }
    }
    out.push({ ...base, form: 'initials', text: initialsFor(guest), fontSize: 0 })
  })
  return out
}
