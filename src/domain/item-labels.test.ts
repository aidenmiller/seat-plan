import { describe, expect, it } from 'vitest'
import type { ChairRow, Table } from './canvas-schema'
import { itemLabel } from './item-labels'

function table(number: number, name: string): Table {
  return {
    id: 't',
    kind: 'table',
    x: 0,
    y: 0,
    rotation: 0,
    locked: false,
    shape: 'round',
    width: 152.4,
    height: 152.4,
    number,
    name,
    seatCount: 0,
    seatSides: 'all',
    seats: [],
  }
}

function row(rowNumber: number, rowLabel: string, blockLabel: string | null): ChairRow {
  return {
    id: 'r',
    kind: 'chairRow',
    x: 0,
    y: 0,
    rotation: 0,
    locked: false,
    chairCount: 1,
    spacing: 50.8,
    blockId: blockLabel ? 'b' : null,
    blockLabel,
    rowNumber,
    rowLabel,
    reservedFor: null,
    seats: [{ index: 0, guestId: null }],
  }
}

describe('itemLabel', () => {
  it('a table still named after its number is "Table N"', () => {
    expect(itemLabel(table(3, 'Table 3'))).toBe('Table 3')
  })

  it('a renamed table keeps its number in brackets', () => {
    expect(itemLabel(table(3, 'Family'))).toBe('Family (table 3)')
  })

  it('a table named after another number counts as renamed', () => {
    expect(itemLabel(table(3, 'Table 4'))).toBe('Table 4 (table 3)')
  })

  it('a blank table name falls back to "Table N"', () => {
    expect(itemLabel(table(7, '  '))).toBe('Table 7')
  })

  it('a chair row gives its label, or "Row N"', () => {
    expect(itemLabel(row(2, 'Front', null))).toBe('Front')
    expect(itemLabel(row(2, '', null))).toBe('Row 2')
  })

  it('a chair row in a labelled block names the block first', () => {
    expect(itemLabel(row(1, 'Row 1', "Noa's side"))).toBe("Noa's side, Row 1")
    expect(itemLabel(row(4, ' ', 'Left'))).toBe('Left, Row 4')
    expect(itemLabel(row(4, 'Row 4', ' '))).toBe('Row 4')
  })
})
