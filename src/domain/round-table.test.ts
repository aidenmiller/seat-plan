import { describe, expect, it } from 'vitest'
import { canvasSchema, emptyCanvas, type Canvas, type Table } from './canvas-schema'
import {
  addRoundTable,
  contentBounds,
  footprint,
  freeSpot,
  newRoundTable,
  nextTableNumber,
  ROUND_PRESET_CM,
  seatPositions,
  SEAT_DIAMETER_CM,
  SEAT_GAP_CM,
  type Box,
} from './round-table'

function table(overrides: Partial<Table> = {}): Table {
  return {
    id: 't1',
    kind: 'table',
    shape: 'round',
    x: 0,
    y: 0,
    rotation: 0,
    locked: false,
    width: ROUND_PRESET_CM,
    height: ROUND_PRESET_CM,
    number: 1,
    name: 'Table 1',
    seatCount: 8,
    seatSides: 'all',
    seats: Array.from({ length: 8 }, (_, index) => ({ index, guestId: null })),
    ...overrides,
  }
}

function boxesOverlap(a: Box, b: Box): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY
}

describe('seatPositions', () => {
  it('spaces round seats evenly, 8 cm out from the edge, seat 0 at the top', () => {
    const seats = seatPositions(table())
    expect(seats).toHaveLength(8)
    const r = ROUND_PRESET_CM / 2 + SEAT_GAP_CM + SEAT_DIAMETER_CM / 2
    for (const s of seats) expect(Math.hypot(s.x, s.y)).toBeCloseTo(r, 2)
    expect(seats[0].x).toBeCloseTo(0, 3)
    expect(seats[0].y).toBeCloseTo(-r, 3)
    // Clockwise on screen (y down): the second seat is to the right.
    expect(seats[1].x).toBeGreaterThan(0)
    const gaps = seats.map((s, i) => {
      const n = seats[(i + 1) % seats.length]
      return Math.hypot(n.x - s.x, n.y - s.y)
    })
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0], 2)
  })

  it('puts square and rect seats on the outline around the table', () => {
    const seats = seatPositions(table({ shape: 'rect', width: 243.84, height: 76.2 }))
    expect(seats).toHaveLength(8)
    const halfW = 243.84 / 2 + SEAT_GAP_CM + SEAT_DIAMETER_CM / 2
    const halfH = 76.2 / 2 + SEAT_GAP_CM + SEAT_DIAMETER_CM / 2
    for (const s of seats) {
      const onSide = Math.abs(Math.abs(s.x) - halfW) < 1e-6 || Math.abs(Math.abs(s.y) - halfH) < 1e-6
      expect(onSide).toBe(true)
    }
  })

  it('gives no seats for a table with none', () => {
    expect(seatPositions(table({ seatCount: 0, seats: [] }))).toEqual([])
  })
})

describe('nextTableNumber', () => {
  it('is 1 on an empty canvas and the highest number plus one after', () => {
    expect(nextTableNumber(emptyCanvas())).toBe(1)
    const canvas: Canvas = { ...emptyCanvas(), items: [table({ number: 3 }), table({ id: 't2', number: 7 })] }
    expect(nextTableNumber(canvas)).toBe(8)
  })
})

describe('footprint and bounds', () => {
  it('counts the seats in a table footprint', () => {
    const f = footprint(table({ x: 100, y: 50 }))!
    const r = ROUND_PRESET_CM / 2 + SEAT_GAP_CM + SEAT_DIAMETER_CM
    expect(f.minX).toBeCloseTo(100 - r, 6)
    expect(f.maxY).toBeCloseTo(50 + r, 6)
  })

  it('contentBounds is null for an empty canvas', () => {
    expect(contentBounds(emptyCanvas())).toBeNull()
  })
})

describe('adding round tables', () => {
  it('makes the Round preset with empty seats and a valid canvas', () => {
    const t = newRoundTable(emptyCanvas(), 'a')
    expect(t).toMatchObject({ shape: 'round', width: 152.4, height: 152.4, seatCount: 8, number: 1, name: 'Table 1' })
    expect(t.seats.every((s, i) => s.index === i && s.guestId === null)).toBe(true)
    expect(canvasSchema.safeParse(addRoundTable(emptyCanvas(), 'a')).success).toBe(true)
  })

  it('places each new table where it overlaps nothing, numbered in order', () => {
    let canvas = emptyCanvas()
    for (let i = 0; i < 12; i++) canvas = addRoundTable(canvas, `t${i}`)
    const tables = canvas.items.filter((i): i is Table => i.kind === 'table')
    expect(tables.map((t) => t.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    const boxes = tables.map((t) => footprint(t)!)
    for (let a = 0; a < boxes.length; a++) {
      for (let b = a + 1; b < boxes.length; b++) expect(boxesOverlap(boxes[a], boxes[b]), `${a} and ${b}`).toBe(false)
    }
    expect(canvasSchema.safeParse(canvas).success).toBe(true)
  })

  it('steps around other items too', () => {
    const fixture = {
      id: 'dance',
      kind: 'fixture' as const,
      type: 'danceFloor' as const,
      x: 300,
      y: 0,
      rotation: 0,
      locked: false,
      width: 500,
      height: 500,
      label: 'Dance floor',
    }
    const canvas: Canvas = { ...emptyCanvas(), items: [table(), fixture] }
    const spot = freeSpot(canvas, 258.4)
    const box: Box = { minX: spot.x - 129.2, minY: spot.y - 129.2, maxX: spot.x + 129.2, maxY: spot.y + 129.2 }
    for (const item of canvas.items) expect(boxesOverlap(box, footprint(item)!)).toBe(false)
  })

  it('fills a gap left by a deleted table', () => {
    let canvas = emptyCanvas()
    for (let i = 0; i < 3; i++) canvas = addRoundTable(canvas, `t${i}`)
    const middle = canvas.items[1] as Table
    canvas = { ...canvas, items: canvas.items.filter((i) => i.id !== middle.id) }
    const added = newRoundTable(canvas, 'new')
    expect(added.number).toBe(4)
    expect(added.x).toBeCloseTo(middle.x, 6)
    expect(added.y).toBeCloseTo(middle.y, 6)
  })
})
