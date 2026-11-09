import { describe, expect, it } from 'vitest'
import { canvasSchema, emptyCanvas, type Item } from './canvas-schema'

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
