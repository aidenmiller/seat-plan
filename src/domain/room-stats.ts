/**
 * The Room panel (spec section 4, "Space check"; PLAN section 7, "Room
 * panel"; spec section 8 for ceremonies). Shown in Properties when nothing
 * is selected. Warnings only: nothing here blocks a change.
 *
 * Reception: total seats against guests who said yes or have not answered,
 * the shortfall, the most common table size among tables that are not
 * one-sided (ties go to the larger), how many more of those tables would
 * cover the shortfall, and the dance floor's area per guest.
 *
 * Ceremony: total chairs against guests who said yes and against guests who
 * said yes or have not answered, and the chairs in reserved rows.
 *
 * Areas show as whole square feet or square meters to one decimal (DECISIONS 2).
 */
import type { Canvas, Item, Table } from './canvas-schema'
import { isBackArc } from './seats'
import { CM_PER_FOOT, type LengthUnit } from './units'

export type StatsGuest = { rsvp: 'yes' | 'no' | 'pending' }

export type ReceptionStats = {
  kind: 'reception'
  /** Seats at every table (and chair row, if any). */
  seats: number
  /** Guests who said yes or have not answered. */
  guests: number
  /** Seats still needed: guests over seats, or 0. */
  shortfall: number
  /** Seats over guests, or 0. */
  spare: number
  /** The most frequent seat count among tables that are not one-sided; null with none. */
  commonSize: number | null
  /** More tables of commonSize to cover the shortfall: 0 when there is none; null when there is no size to count in. */
  tablesNeeded: number | null
  /** The dance floors' area in cm², 0 with none. */
  danceFloorCm2: number
  /** Dance floor area per guest in cm²; null with no dance floor or no guests. */
  danceFloorPerGuestCm2: number | null
}

export type CeremonyStats = {
  kind: 'ceremony'
  chairs: number
  /** Guests who said yes. */
  yes: number
  /** Guests who said yes or have not answered. */
  yesOrPending: number
  /** Chairs still needed for yes, and for yes or pending: 0 when there are enough. */
  shortForYes: number
  shortForYesOrPending: number
  /** Chairs in rows reserved with a label, and how many such rows. */
  reservedChairs: number
  reservedRows: number
}

export type RoomStats = ReceptionStats | CeremonyStats

export type RoomStatsInput = {
  layoutKind: 'reception' | 'ceremony'
  canvas: Pick<Canvas, 'items'>
  guests: readonly StatsGuest[]
}

function seatsOf(item: Item): number {
  if (item.kind === 'table') return Math.max(0, item.seatCount)
  if (item.kind === 'chairRow') return Math.max(0, item.chairCount)
  return 0
}

/** Head tables, sweetheart tables and round tables seated on the back arc only. */
export function isOneSided(table: Pick<Table, 'shape' | 'seatSides' | 'seatCount'>): boolean {
  return table.seatSides === 'oneSide' || isBackArc(table)
}

/** The most frequent seat count among tables that are not one-sided and have seats; ties go to the larger. */
export function commonTableSize(items: readonly Item[]): number | null {
  const counts = new Map<number, number>()
  for (const item of items) {
    if (item.kind !== 'table' || item.seatCount <= 0 || isOneSided(item)) continue
    counts.set(item.seatCount, (counts.get(item.seatCount) ?? 0) + 1)
  }
  let best: number | null = null
  let bestCount = 0
  for (const [size, n] of counts) {
    if (n > bestCount || (n === bestCount && best !== null && size > best)) {
      best = size
      bestCount = n
    }
  }
  return best
}

export function roomStats(input: RoomStatsInput): RoomStats {
  const items = input.canvas.items
  let yes = 0
  let pending = 0
  for (const g of input.guests) {
    if (g.rsvp === 'yes') yes++
    else if (g.rsvp === 'pending') pending++
  }
  let seats = 0
  for (const item of items) seats += seatsOf(item)

  if (input.layoutKind === 'ceremony') {
    let reservedChairs = 0
    let reservedRows = 0
    for (const item of items) {
      if (item.kind !== 'chairRow' || !item.reservedFor?.trim()) continue
      reservedRows++
      reservedChairs += item.chairCount
    }
    return {
      kind: 'ceremony',
      chairs: seats,
      yes,
      yesOrPending: yes + pending,
      shortForYes: Math.max(0, yes - seats),
      shortForYesOrPending: Math.max(0, yes + pending - seats),
      reservedChairs,
      reservedRows,
    }
  }

  const guests = yes + pending
  const shortfall = Math.max(0, guests - seats)
  const commonSize = commonTableSize(items)
  let danceFloorCm2 = 0
  for (const item of items) if (item.kind === 'fixture' && item.type === 'danceFloor') danceFloorCm2 += item.width * item.height
  return {
    kind: 'reception',
    seats,
    guests,
    shortfall,
    spare: Math.max(0, seats - guests),
    commonSize,
    tablesNeeded: shortfall === 0 ? 0 : commonSize === null ? null : Math.ceil(shortfall / commonSize),
    danceFloorCm2,
    danceFloorPerGuestCm2: danceFloorCm2 > 0 && guests > 0 ? danceFloorCm2 / guests : null,
  }
}

const CM2_PER_SQ_FT = CM_PER_FOOT * CM_PER_FOOT

/** "54 sq ft" or "5.0 m²" (DECISIONS 2). */
export function formatArea(cm2: number, unit: LengthUnit): string {
  if (!Number.isFinite(cm2)) return ''
  if (unit === 'm') return `${(cm2 / 10_000).toFixed(1)} m²`
  return `${Math.round(cm2 / CM2_PER_SQ_FT)} sq ft`
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * The Room panel's lines, plain and short. Reception: "112 seats for 120
 * guests", "8 seats short: 1 more table of 10", "Dance floor: 2 sq ft per
 * guest". Ceremony: "120 chairs", "80 said yes: enough", "130 said yes or
 * not yet: 10 short", "10 chairs reserved in 1 row".
 */
export function roomStatsLines(stats: RoomStats, unit: LengthUnit): string[] {
  if (stats.kind === 'ceremony') {
    const enough = (short: number) => (short > 0 ? `${short} short` : 'enough')
    const lines = [
      plural(stats.chairs, 'chair', 'chairs'),
      `${stats.yes} said yes: ${enough(stats.shortForYes)}`,
      `${stats.yesOrPending} said yes or not yet: ${enough(stats.shortForYesOrPending)}`,
    ]
    if (stats.reservedRows > 0) lines.push(`${plural(stats.reservedChairs, 'chair', 'chairs')} reserved in ${plural(stats.reservedRows, 'row', 'rows')}`)
    return lines
  }
  const lines = [`${plural(stats.seats, 'seat', 'seats')} for ${plural(stats.guests, 'guest', 'guests')}`]
  if (stats.shortfall > 0) {
    const short = `${plural(stats.shortfall, 'seat', 'seats')} short`
    lines.push(
      stats.tablesNeeded !== null && stats.commonSize !== null
        ? `${short}: ${plural(stats.tablesNeeded, 'more table', 'more tables')} of ${stats.commonSize}`
        : short,
    )
  } else {
    lines.push(stats.spare > 0 ? `${plural(stats.spare, 'seat', 'seats')} spare` : 'Enough seats')
  }
  if (stats.danceFloorPerGuestCm2 !== null) lines.push(`Dance floor: ${formatArea(stats.danceFloorPerGuestCm2, unit)} per guest`)
  else if (stats.danceFloorCm2 === 0) lines.push('No dance floor')
  return lines
}
