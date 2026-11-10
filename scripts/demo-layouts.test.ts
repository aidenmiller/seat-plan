import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { canvasSchema, type ChairRow } from '../src/domain/canvas-schema'
import { chairTotals } from '../src/domain/ceremony'
import { CEREMONY_FAMILY_ROW, ceremonyPlan } from './demo-layouts'

describe('the demo ceremony', () => {
  let n = 0
  const named = [randomUUID(), randomUUID(), randomUUID(), randomUUID()]
  const canvas = ceremonyPlan(named, () => `id-${n++}`)
  const rows = canvas.items.filter((i): i is ChairRow => i.kind === 'chairRow')

  it('is valid for saving, with the seating block defaults: 16 rows of 6, numbered 1 to 8 on each side', () => {
    expect(canvasSchema.safeParse(canvas).success).toBe(true)
    expect(rows).toHaveLength(16)
    expect(rows.every((r) => r.chairCount === 6)).toBe(true)
    expect(new Set(rows.map((r) => r.blockLabel))).toEqual(new Set(["Noa's side", "Aiden's side"]))
    expect(Math.max(...rows.map((r) => r.rowNumber))).toBe(8)
    expect(chairTotals(canvas.items)).toEqual({ chairs: 96, reserved: 6 })
  })

  it('reserves row 1 on Noa’s side by label and seats the named guests on row 1 of Aiden’s side, from the aisle', () => {
    const front = rows.filter((r) => r.rowNumber === 1)
    const noa = front.find((r) => r.blockLabel === "Noa's side")!
    const aiden = front.find((r) => r.blockLabel === "Aiden's side")!
    expect(noa.reservedFor).toBe(CEREMONY_FAMILY_ROW)
    expect(noa.seats.every((s) => s.guestId === null)).toBe(true)
    expect(aiden.aisleEnd).toBe('left')
    expect(aiden.seats.map((s) => s.guestId)).toEqual([...named, null, null])
    expect(rows.filter((r) => r !== aiden).every((r) => r.seats.every((s) => s.guestId === null))).toBe(true)
  })

  it('puts the chuppah and officiant in front of row 1 and the entrance behind the last row', () => {
    const fixture = (type: string) => canvas.items.find((i) => i.kind === 'fixture' && i.type === type)!
    expect(fixture('ceremonyStructure')).toMatchObject({ label: 'Chuppah' })
    expect(fixture('ceremonyStructure').y).toBeLessThan(0)
    expect(fixture('officiant').y).toBeLessThan(0)
    expect(fixture('entrance').y).toBeGreaterThan(Math.max(...rows.map((r) => r.y)))
  })
})
