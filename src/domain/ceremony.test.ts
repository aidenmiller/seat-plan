import { describe, expect, it } from 'vitest'
import { canvasSchema, type ChairRow } from './canvas-schema'
import {
  addRowBehind,
  AISLE_WIDTH_CM,
  blockRows,
  chairLocalXs,
  chairNameLabels,
  chairPositions,
  chairTotals,
  CHAIR_PITCH_CM,
  generateSeatingBlock,
  rowName,
  ROW_PITCH_CM,
  setChairCount,
  setRowSpacing,
} from './ceremony'
import { chairRowLength } from './geometry'
import { SEAT_DIAMETER_CM } from './seats'

const G = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function ids() {
  let n = 0
  return () => `id${++n}`
}

describe('generateSeatingBlock', () => {
  const rows = generateSeatingBlock({ rows: 3, chairsPerRow: 4, origin: { x: 0, y: 0 } }, ids())

  it('makes one row per side per row, numbered from the front, with the defaults', () => {
    expect(rows).toHaveLength(6)
    expect(rows.map((r) => r.rowNumber)).toEqual([1, 1, 2, 2, 3, 3])
    expect(rows.map((r) => r.blockLabel)).toEqual(["Noa's side", "Aiden's side", "Noa's side", "Aiden's side", "Noa's side", "Aiden's side"])
    for (const r of rows) {
      expect(r.chairCount).toBe(4)
      expect(r.spacing).toBe(CHAIR_PITCH_CM)
      expect(r.seats).toHaveLength(4)
      expect(r.reservedFor).toBeNull()
    }
    expect(canvasSchema.safeParse({ schemaVersion: 1, items: rows }).success).toBe(true)
  })

  it('gives each side its own block and leaves a 6 ft aisle between the inner chairs', () => {
    const [left, right] = rows
    expect(left.blockId).not.toBe(right.blockId)
    expect(new Set(rows.map((r) => r.blockId)).size).toBe(2)
    const len = chairRowLength(left)
    expect(right.x - len / 2 - (left.x + len / 2)).toBeCloseTo(AISLE_WIDTH_CM)
    expect(left.aisleEnd).toBe('right')
    expect(right.aisleEnd).toBe('left')
  })

  it('puts rows 36 in apart, front to back', () => {
    expect(rows[2].y - rows[0].y).toBeCloseTo(ROW_PITCH_CM)
    expect(rows[4].y - rows[2].y).toBeCloseTo(ROW_PITCH_CM)
  })

  it('takes custom sizes, labels and a turn', () => {
    const [l, r] = generateSeatingBlock(
      { rows: 1, chairsPerRow: 2, aisleWidthCm: 100, chairPitchCm: 60, leftLabel: 'Bride', rightLabel: ' ', origin: { x: 10, y: 20 }, facing: 90 },
      ids(),
    )
    expect(l.blockLabel).toBe('Bride')
    expect(r.blockLabel).toBe("Aiden's side")
    expect(l.rotation).toBe(90)
    // Turned 90°: the row runs down the plan, so left is above the origin.
    expect(l.x).toBeCloseTo(10)
    expect(l.y).toBeLessThan(20)
    expect(r.y - l.y).toBeCloseTo(100 + 60 + SEAT_DIAMETER_CM)
  })
})

describe('chair positions', () => {
  it('spaces chairs evenly about the row center, seat 1 on the left', () => {
    const row = { chairCount: 3, spacing: 50 }
    expect(chairLocalXs(row)).toEqual([-50, 0, 50])
    expect(chairPositions({ ...row, x: 100, y: 0, rotation: 90 }).map((p) => [Math.round(p.x), Math.round(p.y)])).toEqual([
      [100, -50],
      [100, 0],
      [100, 50],
    ])
  })
})

describe('addRowBehind', () => {
  it('adds an empty row behind the back row with the next number', () => {
    const rows = generateSeatingBlock({ rows: 2, chairsPerRow: 4, origin: { x: 0, y: 0 } }, ids())
    const seated: ChairRow = { ...rows[0], reservedFor: 'Family', seats: rows[0].seats.map((s, i) => (i === 0 ? { ...s, guestId: G(1) } : s)) }
    const items = [seated, ...rows.slice(1)]
    const added = addRowBehind(items, seated, 'new')
    expect(added.rowNumber).toBe(3)
    expect(added.blockId).toBe(seated.blockId)
    expect(added.reservedFor).toBeNull()
    expect(added.seats.every((s) => s.guestId === null)).toBe(true)
    expect(added.y - rows[2].y).toBeCloseTo(ROW_PITCH_CM)
    expect(added.x).toBeCloseTo(rows[2].x)
    expect(blockRows([...items, added], seated).map((r) => r.rowNumber)).toEqual([1, 2, 3])
  })

  it('works on a single row', () => {
    const [row] = generateSeatingBlock({ rows: 1, chairsPerRow: 2, origin: { x: 0, y: 0 } }, ids())
    const lone = { ...row, blockId: null }
    expect(addRowBehind([lone], lone, 'x')).toMatchObject({ rowNumber: 2, y: ROW_PITCH_CM })
  })
})

describe('setChairCount', () => {
  const base = generateSeatingBlock({ rows: 1, chairsPerRow: 4, origin: { x: 0, y: 0 } }, ids())[0] // aisle on the right
  const withGuests: ChairRow = { ...base, seats: [G(1), null, G(2), G(3)].map((guestId, index) => ({ index, guestId })) }

  it('keeps the aisle end fixed and adds chairs at the far end', () => {
    const { row, unseated } = setChairCount(withGuests, 6)
    expect(unseated).toEqual([])
    expect(row.seats.map((s) => s.guestId)).toEqual([null, null, G(1), null, G(2), G(3)])
    expect(row.seats.map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5])
    expect(row.x + chairRowLength(row) / 2).toBeCloseTo(withGuests.x + chairRowLength(withGuests) / 2)
  })

  it('takes empty chairs first, then names the guests who lose their chair', () => {
    expect(setChairCount(withGuests, 3)).toMatchObject({ unseated: [] })
    expect(setChairCount(withGuests, 3).row.seats.map((s) => s.guestId)).toEqual([G(1), G(2), G(3)])
    const two = setChairCount(withGuests, 2)
    expect(two.unseated).toEqual([G(1)])
    expect(two.row.seats.map((s) => s.guestId)).toEqual([G(2), G(3)])
  })

  it('a row with no aisle grows to the right', () => {
    const lone: ChairRow = { ...withGuests, aisleEnd: undefined }
    const { row } = setChairCount(lone, 5)
    expect(row.seats[0].guestId).toBe(G(1))
    expect(row.x - chairRowLength(row) / 2).toBeCloseTo(lone.x - chairRowLength(lone) / 2)
  })

  it('setRowSpacing keeps the aisle end too', () => {
    const wide = setRowSpacing(withGuests, 70)
    expect(wide.spacing).toBe(70)
    expect(wide.x + chairRowLength(wide) / 2).toBeCloseTo(withGuests.x + chairRowLength(withGuests) / 2)
    expect(setRowSpacing(withGuests, 10).spacing).toBe(SEAT_DIAMETER_CM)
  })
})

describe('chairTotals and rowName', () => {
  it('counts chairs and reserved chairs', () => {
    const rows = generateSeatingBlock({ rows: 2, chairsPerRow: 5, origin: { x: 0, y: 0 } }, ids())
    rows[0] = { ...rows[0], reservedFor: 'Family, row 1' }
    expect(chairTotals(rows)).toEqual({ chairs: 20, reserved: 5 })
    expect(rowName(rows[0])).toBe('Row 1')
    expect(rowName({ rowNumber: 2, rowLabel: 'Front' })).toBe('Front')
  })
})

describe('chairNameLabels', () => {
  const measure = (text: string, size: number) => text.length * size * 0.55
  const names = new Map([
    [G(1), { firstName: 'Jane', lastName: 'Doe' }],
    [G(2), { firstName: 'Maximiliana', lastName: 'Vandersteenhoven' }],
  ])
  const rows = generateSeatingBlock({ rows: 2, chairsPerRow: 3, origin: { x: 0, y: 0 } }, ids())
  const front: ChairRow = { ...rows[0], seats: [G(1), G(2), null].map((guestId, index) => ({ index, guestId })) }

  it('fits names into the space before the next row, shrinking or falling back to initials', () => {
    const labels = chairNameLabels({ row: front, rows: [front, ...rows.slice(1)], names, zoom: 1.5, measure })
    expect(labels.map((l) => l.form)).toEqual(['full', 'initials'])
    expect(labels[0]).toMatchObject({ text: 'Jane Doe', rotation: 90, anchor: 'start' })
    expect(labels[0].fontSize).toBeLessThan(16)
    expect(labels[1].text).toBe('MV')
    // Further out, 10 px is more cm: Jane's name no longer fits either.
    expect(chairNameLabels({ row: front, rows: [front, ...rows.slice(1)], names, zoom: 0.8, measure }).map((l) => l.form)).toEqual(['initials', 'initials'])
  })

  it('uses full names with nothing behind, and never reads upside down', () => {
    const turned = { ...front, rotation: 180 }
    const labels = chairNameLabels({ row: turned, rows: [turned], names, zoom: 1, measure })
    expect(labels[0]).toMatchObject({ form: 'full', text: 'Jane Doe', fontSize: 16, rotation: -90, anchor: 'end' })
    expect(labels[1]).toMatchObject({ form: 'short', text: 'Maximiliana V.' })
  })
})
