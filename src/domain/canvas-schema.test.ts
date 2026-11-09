import { describe, expect, it } from 'vitest'
import { canvasSchema, cleanText, emptyCanvas, wellFormedText, type Canvas, type Item } from './canvas-schema'
import { fixedItemSchema } from './venue-schema'

const GUEST = '0b9f6a3e-6c1d-4c8e-9f57-2a1d6f1e7a10'

function roundTable(overrides: Partial<Extract<Item, { kind: 'table' }>> = {}): Item {
  return {
    id: 't1',
    kind: 'table',
    shape: 'round',
    x: 0,
    y: 0,
    rotation: 0,
    locked: false,
    width: 152.4,
    height: 152.4,
    number: 1,
    name: 'Table 1',
    seatCount: 2,
    seatSides: 'all',
    seats: [
      { index: 0, guestId: GUEST },
      { index: 1, guestId: null },
    ],
    ...overrides,
  }
}

describe('canvasSchema', () => {
  it('accepts an empty canvas and a simple table', () => {
    expect(canvasSchema.safeParse(emptyCanvas()).success).toBe(true)
    expect(canvasSchema.safeParse({ schemaVersion: 1, items: [roundTable()] }).success).toBe(true)
  })

  it('rejects a seat list that does not match the seat count', () => {
    const bad = roundTable({ seatCount: 3 })
    expect(canvasSchema.safeParse({ schemaVersion: 1, items: [bad] }).success).toBe(false)
  })

  it('rejects seats out of order', () => {
    const bad = roundTable({
      seats: [
        { index: 1, guestId: null },
        { index: 0, guestId: null },
      ],
    })
    expect(canvasSchema.safeParse({ schemaVersion: 1, items: [bad] }).success).toBe(false)
  })

  it('rejects tables under 24 in and round tables that are not round', () => {
    expect(canvasSchema.safeParse({ schemaVersion: 1, items: [roundTable({ width: 50, height: 50 })] }).success).toBe(
      false,
    )
    expect(canvasSchema.safeParse({ schemaVersion: 1, items: [roundTable({ width: 160 })] }).success).toBe(false)
    expect(
      canvasSchema.safeParse({ schemaVersion: 1, items: [roundTable({ width: 60.96, height: 60.96 })] }).success,
    ).toBe(true)
  })

  it('rejects duplicate item ids and unknown kinds', () => {
    expect(canvasSchema.safeParse({ schemaVersion: 1, items: [roundTable(), roundTable()] }).success).toBe(false)
    expect(canvasSchema.safeParse({ schemaVersion: 1, items: [{ id: 'x', kind: 'sofa' }] }).success).toBe(false)
  })

  it('rejects other schema versions', () => {
    expect(canvasSchema.safeParse({ schemaVersion: 2, items: [] }).success).toBe(false)
  })
})

describe('text Postgres can store', () => {
  it('wellFormedText removes NUL and turns lone surrogates into U+FFFD, keeping real pairs', () => {
    expect(wellFormedText('a\u0000b\u0000')).toBe('ab')
    expect(wellFormedText('cake \ud83c')).toBe('cake �')
    expect(wellFormedText('\udc00x')).toBe('�x')
    expect(wellFormedText('cake 🎂')).toBe('cake 🎂')
    expect(wellFormedText('plain')).toBe('plain')
  })

  it('cleanText checks the length after cleaning', () => {
    expect(cleanText(3).parse('ab\u0000c')).toBe('abc')
    expect(cleanText(3).safeParse('abcd').success).toBe(false)
  })

  it('cleans every free-text field in the canvas', () => {
    const dirty = 'x\u0000\ud800'
    const clean = 'x�'
    const base = { x: 0, y: 0, rotation: 0, locked: false }
    const canvas = {
      schemaVersion: 1,
      items: [
        roundTable({ name: dirty }),
        { ...base, id: 'f1', kind: 'fixture', type: 'cake', width: 50, height: 50, label: dirty },
        {
          ...base,
          id: 'r1',
          kind: 'chairRow',
          chairCount: 1,
          spacing: 50,
          blockId: 'b1',
          blockLabel: dirty,
          rowNumber: 1,
          rowLabel: dirty,
          reservedFor: dirty,
          seats: [{ index: 0, guestId: null }],
        },
        {
          ...base,
          id: 's1',
          kind: 'shape',
          type: 'text',
          width: 10,
          height: 10,
          text: dirty,
          style: { stroke: dirty, fill: dirty, strokeWidth: 1 },
        },
        {
          ...base,
          id: 'n1',
          kind: 'note',
          type: 'sticky',
          width: 10,
          height: 10,
          text: dirty,
          color: 'yellow',
          author: 'Noa',
          done: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          attachedTo: { start: null, end: null },
        },
      ],
    }
    const parsed: Canvas = canvasSchema.parse(canvas)
    const [table, fixture, row, shape, note] = parsed.items
    expect(table).toMatchObject({ name: clean })
    expect(fixture).toMatchObject({ label: clean })
    expect(row).toMatchObject({ blockLabel: clean, rowLabel: clean, reservedFor: clean })
    expect(shape).toMatchObject({ text: clean, style: { stroke: clean, fill: clean } })
    expect(note).toMatchObject({ text: clean })
    expect(JSON.stringify(parsed)).not.toMatch(/\\u0000|\\ud800/)
  })

  it('refuses ids with a NUL or a lone surrogate instead of changing them', () => {
    expect(canvasSchema.safeParse({ schemaVersion: 1, items: [roundTable({ id: 't\u00001' })] }).success).toBe(false)
    expect(canvasSchema.safeParse({ schemaVersion: 1, items: [roundTable({ id: 't\udc00' })] }).success).toBe(false)
  })

  it('cleans the free text in venue fixed items', () => {
    const common = { id: 'b1', unsure: true, unsureNote: 'not\u0000 sure \ud83c', name: 'Main\u0000 bar' }
    const bar = fixedItemSchema.parse({ ...common, type: 'bar', x: 0, y: 0, width: 10, height: 10, rotation: 0, label: 'Bar\u0000' })
    expect(bar).toMatchObject({ name: 'Main bar', unsureNote: 'not sure �', label: 'Bar' })
    const label = fixedItemSchema.parse({ ...common, id: 'l1', type: 'label', x: 0, y: 0, rotation: 0, text: '\ud83cHi', fontSize: 20 })
    expect(label).toMatchObject({ text: '�Hi' })
    expect(fixedItemSchema.safeParse({ ...common, id: 'w\u0000', type: 'room', points: [] }).success).toBe(false)
  })
})
