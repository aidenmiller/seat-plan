/**
 * The guest list as CSV: the sample file's ten columns, then guest_id, so a
 * re-import matches on the id first (PLAN change 10), then nickname, which
 * the sample leaves out (DECISIONS 70). Starts with a byte order mark so
 * Excel reads accents, ends lines with CRLF, and puts an apostrophe before
 * any cell that starts with = + - @ tab or CR (after any apostrophes of its
 * own), so Excel shows it as text and never runs it as a formula. The import
 * removes that one apostrophe again (unguardCell), so an export re-imports
 * with no changes.
 */
import { sideKey, sideLabel, sideWordMap, type GuestSide, type PartnerNames } from '../partners'
import { GUARDED_CELL_RE, GUEST_ID_COLUMN, NICKNAME_COLUMN, SAMPLE_COLUMNS, type GuestRsvp } from './columns'

export const EXPORT_COLUMNS = [...SAMPLE_COLUMNS, GUEST_ID_COLUMN, NICKNAME_COLUMN] as const
export const CSV_BOM = '﻿'

export type ExportGuest = {
  id: string
  firstName: string
  lastName: string
  nickname: string | null
  partnerId: string | null
  household: string | null
  side: GuestSide
  rsvp: GuestRsvp
  meal: string | null
  isChild: boolean
  notes: string | null
  groupIds: readonly string[]
}

export type ExportGroup = { id: string; name: string }

/** Apostrophe before a cell Excel would read as a formula. */
export function guardCell(value: string): string {
  return GUARDED_CELL_RE.test(value) ? `'${value}` : value
}

/** One cell: guarded, then quoted when it holds a delimiter, quote, line break or edge spaces. */
export function csvCell(value: string): string {
  const v = guardCell(value)
  return /[",;\r\n]|^\s|\s$/.test(v) ? `"${v.replaceAll('"', '""')}"` : v
}

/** Rows to CSV text with CRLF line ends, ending with one. No byte order mark. */
export function csvLines(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

/**
 * A guest's groups for the groups cell, joined with "; ". Group names never
 * hold ";" (the API refuses it), but they may hold a comma, and the import
 * splits a cell with no ";" on commas. So a lone group whose name holds a
 * comma ends with ";", which keeps it whole.
 */
export function groupsCell(names: readonly string[]): string {
  const cell = names.join('; ')
  return names.length === 1 && names[0]!.includes(',') ? `${cell};` : cell
}

const UNNAMED: PartnerNames = { partner1: null, partner2: null }

/**
 * The side cell: the wedding's name for it ("Sam", "Both"), which the import
 * reads back. When it would not read back as the same side (two partners who
 * share a first name), "Partner 1" or "Partner 2", which always does.
 */
function sideCellFor(partners: PartnerNames): (side: GuestSide) => string {
  const words = sideWordMap(partners)
  return (side) => {
    const label = sideLabel(partners, side)
    return words.get(sideKey(label)) === side ? label : sideLabel(UNNAMED, side)
  }
}

/**
 * The guest list file, in the order given. Groups are listed in the order of
 * `groups` (see groupsCell). The partner is written as a full name, and the
 * side as the wedding's name for it.
 */
export function guestsToCsv(guests: readonly ExportGuest[], groups: readonly ExportGroup[], partners: PartnerNames): string {
  const byId = new Map(guests.map((g) => [g.id, g]))
  const sideCell = sideCellFor(partners)
  const lines: string[][] = [[...EXPORT_COLUMNS]]
  for (const g of guests) {
    const partner = g.partnerId ? byId.get(g.partnerId) : undefined
    const mine = new Set(g.groupIds)
    lines.push([
      g.firstName,
      g.lastName,
      partner ? `${partner.firstName} ${partner.lastName}` : '',
      g.household ?? '',
      sideCell(g.side),
      groupsCell(groups.filter((group) => mine.has(group.id)).map((group) => group.name)),
      g.rsvp,
      g.meal ?? '',
      g.isChild ? 'yes' : 'no',
      g.notes ?? '',
      g.id,
      g.nickname ?? '',
    ])
  }
  return CSV_BOM + csvLines(lines)
}

/** "Noa and Aiden guests 2027-06-12.csv" style name, safe on every system. */
export function guestsCsvFileName(weddingName: string, today: Date = new Date()): string {
  const safe = weddingName
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  const y = today.getFullYear()
  const m = String(today.getMonth() + 1).padStart(2, '0')
  const d = String(today.getDate()).padStart(2, '0')
  return `${safe ? `${safe} guests` : 'Guests'} ${y}-${m}-${d}.csv`
}
