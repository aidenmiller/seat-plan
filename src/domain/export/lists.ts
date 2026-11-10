/**
 * The lists that go with a layout (spec section 11; PLAN section 7,
 * "Exports"), as rows for a PDF table and as CSV:
 *
 *  - Table list: each table by number with its guests and meal counts. Guest
 *    notes are left out, since the venue sees this list.
 *  - Escort cards: every seated guest sorted by last name, then first name,
 *    with their table number. In a ceremony layout, their row and chair.
 *  - Ceremony list: reserved rows and named seats, front row first.
 *
 * CSV files start with a byte order mark so Excel reads accents, and a cell
 * that starts with =, +, - or @ gets a leading apostrophe so Excel shows it
 * as text and never runs it (csv/export.ts). Pure.
 */
import type { Canvas, ChairRow, Table } from '../canvas-schema'
import { rowName } from '../ceremony'
import { CSV_BOM, csvLines } from '../csv/export'

export type ListGuest = { id: string; firstName: string; lastName: string; meal: string | null }

/** "Ava Martin". */
export function guestName(g: Pick<ListGuest, 'firstName' | 'lastName'>): string {
  return `${g.firstName.trim()} ${g.lastName.trim()}`.trim()
}

/** The name a table prints under: its own name, or "Table N". */
export function tableTitle(table: Pick<Table, 'name' | 'number'>): string {
  return table.name.trim() || `Table ${table.number}`
}

/** What a guest with no meal counts as. */
export const NO_MEAL = 'No meal given'

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

// ---------------------------------------------------------------- table list

export type MealCount = { meal: string; count: number }

export type TableListEntry = {
  number: number
  name: string
  seats: number
  /** Seated guests in seat order. */
  guests: ListGuest[]
  /** Meals at this table, most first, then by name; guests with no meal last as "No meal given". */
  meals: MealCount[]
}

/** Meals counted with case and spaces ignored, each shown as first written. */
export function countMeals(guests: readonly Pick<ListGuest, 'meal'>[]): MealCount[] {
  const counts = new Map<string, MealCount>()
  let none = 0
  for (const g of guests) {
    const meal = g.meal?.trim() ?? ''
    if (meal === '') {
      none++
      continue
    }
    const key = meal.toLocaleLowerCase('en')
    const found = counts.get(key)
    if (found) found.count++
    else counts.set(key, { meal, count: 1 })
  }
  const out = [...counts.values()].sort((a, b) => b.count - a.count || collator.compare(a.meal, b.meal))
  if (none > 0) out.push({ meal: NO_MEAL, count: none })
  return out
}

function seatedGuests(seats: readonly { guestId: string | null }[], byId: ReadonlyMap<string, ListGuest>): ListGuest[] {
  const out: ListGuest[] = []
  for (const seat of seats) {
    const g = seat.guestId ? byId.get(seat.guestId) : undefined
    if (g) out.push(g)
  }
  return out
}

/** Every table, by number (then name), with its seated guests and meal counts. */
export function tableList(canvas: Pick<Canvas, 'items'>, guests: readonly ListGuest[]): TableListEntry[] {
  const byId = new Map(guests.map((g) => [g.id, g]))
  return canvas.items
    .filter((i): i is Table => i.kind === 'table')
    .map((t) => {
      const seated = seatedGuests(t.seats, byId)
      return { number: t.number, name: tableTitle(t), seats: t.seatCount, guests: seated, meals: countMeals(seated) }
    })
    .sort((a, b) => a.number - b.number || collator.compare(a.name, b.name))
}

export function mealsText(meals: readonly MealCount[], separator = ', '): string {
  return meals.map((m) => `${m.meal} ${m.count}`).join(separator)
}

/** One row per table: number, name, seated of seats, meals, then the guests' names. */
export function tableListCsv(entries: readonly TableListEntry[]): string {
  const rows: string[][] = [['Table', 'Name', 'Seated', 'Seats', 'Meals', 'Guests']]
  for (const e of entries) {
    rows.push([String(e.number), e.name, String(e.guests.length), String(e.seats), mealsText(e.meals, '; '), e.guests.map(guestName).join('; ')])
  }
  return CSV_BOM + csvLines(rows)
}

/** The table list as a PDF table: one row per table, guests and meals one per line. */
export function tableListTable(entries: readonly TableListEntry[]): { head: string[]; body: string[][] } {
  return {
    head: ['Table', 'Guests', 'Meals'],
    body: entries.map((e) => [
      `${e.number}${e.name === `Table ${e.number}` ? '' : `\n${e.name}`}\n${e.guests.length} of ${e.seats} seats`,
      e.guests.length ? e.guests.map(guestName).join('\n') : 'Nobody seated',
      e.meals.length ? mealsText(e.meals, '\n') : '',
    ]),
  }
}

// ---------------------------------------------------------------- escort cards

export type EscortEntry = {
  guestId: string
  firstName: string
  lastName: string
  /** Reception: the table number. Ceremony: the row's name. */
  place: string
  /** Reception: the table's name. Ceremony: the chair number, from 1. */
  detail: string
}

/** The sort used by escort cards: last name, then first name, ignoring case and accents. */
export function compareByLastName(a: Pick<ListGuest, 'firstName' | 'lastName'>, b: Pick<ListGuest, 'firstName' | 'lastName'>): number {
  return collator.compare(a.lastName.trim(), b.lastName.trim()) || collator.compare(a.firstName.trim(), b.firstName.trim())
}

/** Every seated guest, sorted by last name, with where they sit. */
export function escortList(canvas: Pick<Canvas, 'items'>, guests: readonly ListGuest[]): EscortEntry[] {
  const byId = new Map(guests.map((g) => [g.id, g]))
  const out: EscortEntry[] = []
  for (const item of canvas.items) {
    if (item.kind !== 'table' && item.kind !== 'chairRow') continue
    item.seats.forEach((seat, i) => {
      const g = seat.guestId ? byId.get(seat.guestId) : undefined
      if (!g) return
      out.push(
        item.kind === 'table'
          ? { guestId: g.id, firstName: g.firstName, lastName: g.lastName, place: String(item.number), detail: tableTitle(item) }
          : { guestId: g.id, firstName: g.firstName, lastName: g.lastName, place: rowTitle(item), detail: String(i + 1) },
      )
    })
  }
  return out.sort(compareByLastName)
}

function escortHead(ceremony: boolean): string[] {
  return ceremony ? ['Last name', 'First name', 'Row', 'Chair'] : ['Last name', 'First name', 'Table', 'Table name']
}

export function escortCsv(entries: readonly EscortEntry[], ceremony: boolean): string {
  const rows: string[][] = [escortHead(ceremony)]
  for (const e of entries) rows.push([e.lastName.trim(), e.firstName.trim(), e.place, e.detail])
  return CSV_BOM + csvLines(rows)
}

export function escortTable(entries: readonly EscortEntry[], ceremony: boolean): { head: string[]; body: string[][] } {
  return {
    head: ceremony ? ['Name', 'Row', 'Chair'] : ['Name', 'Table'],
    body: entries.map((e) => {
      const name = e.lastName.trim() ? `${e.lastName.trim()}, ${e.firstName.trim()}` : e.firstName.trim()
      if (ceremony) return [name, e.place, e.detail]
      return [name, e.detail === `Table ${e.place}` ? e.place : `${e.place} (${e.detail})`]
    }),
  }
}

// ---------------------------------------------------------------- ceremony

/** "Noa's side, Row 3": the row's name after its block's side label. */
export function rowTitle(row: Pick<ChairRow, 'rowLabel' | 'rowNumber' | 'blockLabel'>): string {
  const block = row.blockLabel?.trim() ?? ''
  return block ? `${block}, ${rowName(row)}` : rowName(row)
}

export type CeremonyListEntry = {
  row: string
  rowNumber: number
  reservedFor: string | null
  chairs: number
  /** Named chairs, from the left end: chair number and guest name. */
  seats: { chair: number; name: string }[]
}

/** Rows that are reserved or hold named guests, front row first, then by side. */
export function ceremonyList(canvas: Pick<Canvas, 'items'>, guests: readonly ListGuest[]): CeremonyListEntry[] {
  const byId = new Map(guests.map((g) => [g.id, g]))
  const out: (CeremonyListEntry & { block: string })[] = []
  for (const item of canvas.items) {
    if (item.kind !== 'chairRow') continue
    const reserved = item.reservedFor?.trim() || null
    const seats: CeremonyListEntry['seats'] = []
    item.seats.forEach((seat, i) => {
      const g = seat.guestId ? byId.get(seat.guestId) : undefined
      if (g) seats.push({ chair: i + 1, name: guestName(g) })
    })
    if (!reserved && seats.length === 0) continue
    out.push({ row: rowTitle(item), rowNumber: item.rowNumber, reservedFor: reserved, chairs: item.chairCount, seats, block: item.blockLabel?.trim() ?? '' })
  }
  out.sort((a, b) => a.rowNumber - b.rowNumber || collator.compare(a.block, b.block) || collator.compare(a.row, b.row))
  return out.map((e) => ({ row: e.row, rowNumber: e.rowNumber, reservedFor: e.reservedFor, chairs: e.chairs, seats: e.seats }))
}

export function ceremonyTable(entries: readonly CeremonyListEntry[]): { head: string[]; body: string[][] } {
  return {
    head: ['Row', 'Reserved for', 'Named seats'],
    body: entries.map((e) => [e.row, e.reservedFor ?? '', e.seats.map((s) => `Chair ${s.chair}: ${s.name}`).join('\n')]),
  }
}

// ---------------------------------------------------------------- file names

/** "Reception plan floor plan.pdf": the layout's name and what the file holds, safe on every system. */
export function exportFileName(layoutName: string, what: string, extension: 'pdf' | 'svg' | 'csv'): string {
  const safe = layoutName
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return `${safe ? `${safe} ${what}` : what.charAt(0).toUpperCase() + what.slice(1)}.${extension}`
}

// ---------------------------------------------------------------- headings

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Printed Nov 10, 2026", in local time. */
export function printedLine(now: Date): string {
  return `Printed ${MONTHS[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`
}

/** "Noa & Aiden · Saturday, June 19, 2027": the wedding and its day, whichever are known. */
export function weddingLine(name: string | null | undefined, dateText: string | null | undefined): string {
  return [name?.trim() ?? '', dateText?.trim() ?? ''].filter((s) => s !== '').join(' · ')
}
