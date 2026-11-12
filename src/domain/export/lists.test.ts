import { describe, expect, it } from 'vitest'
import { emptyCanvas, type Canvas, type ChairRow, type Table } from '../canvas-schema'
import { generateSeatingBlock } from '../ceremony'
import { makeItem } from '../presets'
import {
  ceremonyList,
  ceremonyTable,
  compareByLastName,
  countMeals,
  escortCsv,
  escortList,
  escortTable,
  exportFileName,
  NO_MEAL,
  printedLine,
  tableList,
  tableListCsv,
  tableListTable,
  weddingLine,
  type ListGuest,
} from './lists'

const BOM = '﻿'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
/** The side labels the seating block dialog offers for Noa and Aiden. */
const SIDES = { leftLabel: "Noa's side", rightLabel: "Aiden's side" }

const guests: ListGuest[] = [
  { id: id(1), firstName: 'Zoë', lastName: 'Shapiro', meal: 'Fish' },
  { id: id(2), firstName: 'Łukasz', lastName: 'Nowak', meal: 'Vegan' },
  { id: id(3), firstName: 'Ava', lastName: 'Ávila', meal: null },
  { id: id(4), firstName: 'Ben', lastName: 'avery', meal: 'fish ' },
  { id: id(5), firstName: '=SUM(A1)', lastName: '-Minus', meal: '@meal' },
  { id: id(6), firstName: 'Not', lastName: 'Seated', meal: 'Fish' },
]

function table(n: number, x: number, seated: (number | null)[], name?: string): Table {
  const t = makeItem('round', { x, y: 0 }, `t${n}`, emptyCanvas()) as Table
  return {
    ...t,
    number: n,
    name: name ?? `Table ${n}`,
    seats: t.seats.map((s, i) => ({ ...s, guestId: seated[i] === undefined || seated[i] === null ? null : id(seated[i]!) })),
  }
}

/** Table 2 placed before table 1, an unknown guest id in a seat, and a renamed table. */
function reception(): Canvas {
  const t1 = table(1, 0, [1, null, 2])
  const t2 = table(2, 400, [3, 4, 5], 'Family')
  const t3 = table(3, 800, [])
  return { ...emptyCanvas(), items: [t2, { ...t1, seats: t1.seats.map((s, i) => (i === 5 ? { ...s, guestId: id(99) } : s)) }, t3] }
}

describe('table list', () => {
  it('gives each table by number with its guests in seat order and its meal counts', () => {
    const list = tableList(reception(), guests)
    expect(list.map((t) => t.number)).toEqual([1, 2, 3])
    expect(list[0]).toMatchObject({ number: 1, name: 'Table 1', seats: 8 })
    expect(list[0]!.guests.map((g) => g.firstName)).toEqual(['Zoë', 'Łukasz'])
    expect(list[1]!.name).toBe('Family')
    expect(list[1]!.guests.map((g) => g.firstName)).toEqual(['Ava', 'Ben', '=SUM(A1)'])
    // "Fish" and "fish " count as one meal; no meal counts last.
    expect(list[1]!.meals).toEqual([
      { meal: '@meal', count: 1 },
      { meal: 'fish', count: 1 },
      { meal: NO_MEAL, count: 1 },
    ])
    expect(list[2]!.guests).toEqual([])
  })

  it('counts meals ignoring case and spaces, most first', () => {
    expect(countMeals([{ meal: 'Fish' }, { meal: ' fish' }, { meal: 'Vegan' }, { meal: null }, { meal: '' }])).toEqual([
      { meal: 'Fish', count: 2 },
      { meal: 'Vegan', count: 1 },
      { meal: NO_MEAL, count: 2 },
    ])
  })

  it('writes a CSV that starts with a byte order mark, one row per table, guarding formula cells', () => {
    const csv = tableListCsv(tableList(reception(), guests))
    expect(csv.startsWith(BOM)).toBe(true)
    const lines = csv.slice(1).split('\r\n')
    expect(lines[0]).toBe('Table,Name,Seated,Seats,Meals,Guests')
    // Cells holding ; are quoted, so Excel set to ; as its separator still reads one cell.
    expect(lines[1]).toBe('1,Table 1,2,8,"Fish 1; Vegan 1","Zoë Shapiro; Łukasz Nowak"')
    // The meals cell starts with @, so it gets an apostrophe; "=SUM" inside a cell is not at its start and stays.
    expect(lines[2]).toBe(`2,Family,3,8,"'@meal 1; fish 1; ${NO_MEAL} 1","Ava Ávila; Ben avery; =SUM(A1) -Minus"`)
    expect(lines[3]).toBe('3,Table 3,0,8,,')
  })

  it('leaves guest notes out', () => {
    const withNotes = guests.map((g) => ({ ...g, notes: 'Secret note' }))
    expect(tableListCsv(tableList(reception(), withNotes))).not.toContain('Secret note')
    expect(JSON.stringify(tableListTable(tableList(reception(), withNotes)))).not.toContain('Secret note')
  })

  it('makes PDF rows with the number, the guests and the meals', () => {
    const { head, body } = tableListTable(tableList(reception(), guests))
    expect(head).toEqual(['Table', 'Guests', 'Meals'])
    expect(body[0]).toEqual(['1\n2 of 8 seats', 'Zoë Shapiro\nŁukasz Nowak', 'Fish 1\nVegan 1'])
    expect(body[1]![0]).toBe('2\nFamily\n3 of 8 seats')
    expect(body[2]![1]).toBe('Nobody seated')
  })
})

describe('escort cards', () => {
  it('lists every seated guest by last name, then first name, ignoring case and accents, with their table', () => {
    const list = escortList(reception(), guests)
    expect(list.map((e) => e.lastName)).toEqual(['-Minus', 'avery', 'Ávila', 'Nowak', 'Shapiro'])
    expect(list.find((e) => e.lastName === 'Nowak')).toMatchObject({ place: '1', detail: 'Table 1' })
    expect(list.find((e) => e.lastName === 'avery')).toMatchObject({ place: '2', detail: 'Family' })
    expect(list.some((e) => e.lastName === 'Seated')).toBe(false)
    expect(compareByLastName({ firstName: 'B', lastName: 'Lee' }, { firstName: 'A', lastName: 'lee' })).toBeGreaterThan(0)
  })

  it('writes a CSV with a byte order mark, sorted, with formula cells guarded', () => {
    const csv = escortCsv(escortList(reception(), guests), false)
    expect(csv.startsWith(BOM)).toBe(true)
    const lines = csv.slice(1).trimEnd().split('\r\n')
    expect(lines).toEqual([
      'Last name,First name,Table,Table name',
      "'-Minus,'=SUM(A1),2,Family",
      'avery,Ben,2,Family',
      'Ávila,Ava,2,Family',
      'Nowak,Łukasz,1,Table 1',
      'Shapiro,Zoë,1,Table 1',
    ])
  })

  it('makes PDF rows as "Last, First" with the table number', () => {
    const { head, body } = escortTable(escortList(reception(), guests), false)
    expect(head).toEqual(['Name', 'Table'])
    expect(body).toContainEqual(['Nowak, Łukasz', '1'])
    expect(body).toContainEqual(['avery, Ben', '2 (Family)'])
  })

  it('gives row and chair in a ceremony layout', () => {
    const rows = generateSeatingBlock({ rows: 2, chairsPerRow: 4, ...SIDES, origin: { x: 0, y: 0 } }, (() => {
      let i = 0
      return () => `r${++i}`
    })())
    const front: ChairRow = { ...rows[0]!, seats: rows[0]!.seats.map((s, i) => (i === 2 ? { ...s, guestId: id(1) } : s)) }
    const back: ChairRow = { ...rows[3]!, seats: rows[3]!.seats.map((s, i) => (i === 0 ? { ...s, guestId: id(2) } : s)) }
    const canvas: Canvas = { ...emptyCanvas(), items: [front, rows[1]!, rows[2]!, back] }
    const list = escortList(canvas, guests)
    expect(list).toEqual([
      { guestId: id(2), firstName: 'Łukasz', lastName: 'Nowak', place: "Aiden's side, Row 2", detail: '1' },
      { guestId: id(1), firstName: 'Zoë', lastName: 'Shapiro', place: "Noa's side, Row 1", detail: '3' },
    ])
    const csv = escortCsv(list, true).slice(1).trimEnd().split('\r\n')
    expect(csv[0]).toBe('Last name,First name,Row,Chair')
    expect(csv[1]).toBe("Nowak,Łukasz,\"Aiden's side, Row 2\",1")
    expect(escortTable(list, true).head).toEqual(['Name', 'Row', 'Chair'])
  })
})

describe('ceremony list', () => {
  it('gives reserved rows and named seats, front row first, and skips empty rows', () => {
    const rows = generateSeatingBlock({ rows: 3, chairsPerRow: 4, ...SIDES, origin: { x: 0, y: 0 } }, (() => {
      let i = 0
      return () => `c${++i}`
    })())
    const items = rows.map((r) => {
      if (r.rowNumber === 1 && r.blockLabel === "Noa's side") return { ...r, reservedFor: 'Family, row 1' }
      if (r.rowNumber === 2 && r.blockLabel === "Aiden's side") return { ...r, seats: r.seats.map((s, i) => (i === 1 ? { ...s, guestId: id(2) } : s)) }
      return r
    })
    const list = ceremonyList({ items }, guests)
    expect(list).toEqual([
      { row: "Noa's side, Row 1", rowNumber: 1, reservedFor: 'Family, row 1', chairs: 4, seats: [] },
      { row: "Aiden's side, Row 2", rowNumber: 2, reservedFor: null, chairs: 4, seats: [{ chair: 2, name: 'Łukasz Nowak' }] },
    ])
    expect(ceremonyTable(list).body).toEqual([
      ["Noa's side, Row 1", 'Family, row 1', ''],
      ["Aiden's side, Row 2", '', 'Chair 2: Łukasz Nowak'],
    ])
  })
})

describe('headings and file names', () => {
  it('names files after the layout, safe on every system', () => {
    expect(exportFileName('Reception: plan/A', 'floor plan', 'pdf')).toBe('Reception plan A floor plan.pdf')
    expect(exportFileName('  ', 'escort cards', 'csv')).toBe('Escort cards.csv')
  })

  it('writes the printed date and the wedding line', () => {
    expect(printedLine(new Date(2026, 10, 10))).toBe('Printed Nov 10, 2026')
    expect(weddingLine('Noa & Aiden', 'Saturday, June 19, 2027')).toBe('Noa & Aiden · Saturday, June 19, 2027')
    expect(weddingLine('Noa & Aiden', null)).toBe('Noa & Aiden')
    expect(weddingLine(null, null)).toBe('')
  })
})
