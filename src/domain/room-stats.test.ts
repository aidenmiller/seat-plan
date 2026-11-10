import { describe, expect, it } from 'vitest'
import type { ChairRow, Fixture, Item, Table } from './canvas-schema'
import { commonTableSize, formatArea, isOneSided, roomStats, roomStatsLines, type StatsGuest } from './room-stats'

let next = 0
function table(seatCount: number, overrides: Partial<Table> = {}): Table {
  next++
  return {
    id: `t${next}`,
    kind: 'table',
    shape: 'round',
    x: 0,
    y: 0,
    rotation: 0,
    locked: false,
    width: 152.4,
    height: 152.4,
    number: next,
    name: `Table ${next}`,
    seatCount,
    seatSides: 'all',
    seats: Array.from({ length: seatCount }, (_, index) => ({ index, guestId: null })),
    ...overrides,
  }
}

function floor(width: number, height: number, type: Fixture['type'] = 'danceFloor'): Fixture {
  next++
  return { id: `f${next}`, kind: 'fixture', type, x: 0, y: 0, rotation: 0, locked: false, width, height, label: '' }
}

function row(chairCount: number, reservedFor: string | null = null): ChairRow {
  next++
  return {
    id: `r${next}`,
    kind: 'chairRow',
    x: 0,
    y: 0,
    rotation: 0,
    locked: false,
    chairCount,
    spacing: 50.8,
    blockId: null,
    blockLabel: null,
    rowNumber: 1,
    rowLabel: '',
    reservedFor,
    seats: Array.from({ length: chairCount }, (_, index) => ({ index, guestId: null })),
  }
}

function guests(yes: number, pending: number, no: number): StatsGuest[] {
  return [
    ...Array.from({ length: yes }, () => ({ rsvp: 'yes' as const })),
    ...Array.from({ length: pending }, () => ({ rsvp: 'pending' as const })),
    ...Array.from({ length: no }, () => ({ rsvp: 'no' as const })),
  ]
}

const head = (n = 12) => table(n, { shape: 'rect', width: 731.52, height: 76.2, seatSides: 'oneSide' })
const sweetheart = () => table(2, { width: 91.44, height: 91.44 })

describe('commonTableSize', () => {
  it('counts tables that are not one-sided; ties go to the larger', () => {
    expect(commonTableSize([table(8), table(8), table(10), head(), head(), head(), sweetheart(), sweetheart(), sweetheart()])).toBe(8)
    expect(commonTableSize([table(8), table(10)])).toBe(10)
    expect(commonTableSize([table(10), table(8), table(8), table(10)])).toBe(10)
    expect(commonTableSize([head(), sweetheart(), table(0)])).toBeNull()
    expect(commonTableSize([])).toBeNull()
  })

  it('takes head tables, sweetheart tables and back-arc rounds as one-sided', () => {
    expect(isOneSided(head())).toBe(true)
    expect(isOneSided(sweetheart())).toBe(true)
    expect(isOneSided(table(4, { seatSides: 'oneSide' }))).toBe(true)
    expect(isOneSided(table(2, { shape: 'square', width: 60.96, height: 60.96 }))).toBe(false)
    expect(isOneSided(table(8))).toBe(false)
  })
})

describe('roomStats, reception', () => {
  it('counts seats against yes and pending guests, the shortfall, and the tables of the common size it needs', () => {
    const items: Item[] = [table(8), table(8), table(10), head(12), sweetheart()]
    const stats = roomStats({ layoutKind: 'reception', canvas: { items }, guests: guests(40, 7, 9) })
    expect(stats).toEqual({
      kind: 'reception',
      seats: 40,
      guests: 47,
      shortfall: 7,
      spare: 0,
      commonSize: 8,
      tablesNeeded: 1,
      danceFloorCm2: 0,
      danceFloorPerGuestCm2: null,
    })
    const more = roomStats({ layoutKind: 'reception', canvas: { items }, guests: guests(50, 7, 0) })
    expect(more).toMatchObject({ shortfall: 17, tablesNeeded: 3 })
  })

  it('needs no tables with enough seats, and cannot say how many with no table to count in', () => {
    expect(roomStats({ layoutKind: 'reception', canvas: { items: [table(8)] }, guests: guests(5, 1, 3) })).toMatchObject({
      shortfall: 0,
      spare: 2,
      tablesNeeded: 0,
    })
    expect(roomStats({ layoutKind: 'reception', canvas: { items: [head(12)] }, guests: guests(20, 0, 0) })).toMatchObject({
      shortfall: 8,
      commonSize: null,
      tablesNeeded: null,
    })
  })

  it('gives dance floor area per guest who said yes or has not answered', () => {
    // A 16 ft square (487.68 cm) is 256 sq ft; 64 guests get 4 sq ft each.
    const items: Item[] = [floor(487.68, 487.68), floor(100, 100, 'stage'), table(8)]
    const stats = roomStats({ layoutKind: 'reception', canvas: { items }, guests: guests(60, 4, 10) })
    if (stats.kind !== 'reception') throw new Error('reception')
    expect(stats.danceFloorCm2).toBeCloseTo(487.68 * 487.68, 6)
    expect(stats.danceFloorPerGuestCm2).toBeCloseTo((487.68 * 487.68) / 64, 6)
    expect(formatArea(stats.danceFloorPerGuestCm2!, 'ft')).toBe('4 sq ft')
    expect(formatArea(stats.danceFloorPerGuestCm2!, 'm')).toBe('0.4 m²')
    // Two floors add up; no guests gives no per-guest figure.
    const two = roomStats({ layoutKind: 'reception', canvas: { items: [floor(100, 200), floor(300, 100)] }, guests: guests(0, 0, 2) })
    expect(two).toMatchObject({ danceFloorCm2: 50_000, danceFloorPerGuestCm2: null })
  })

  it('writes the panel lines plainly', () => {
    const items: Item[] = [table(8), table(8), table(10), floor(487.68, 487.68)]
    const stats = roomStats({ layoutKind: 'reception', canvas: { items }, guests: guests(30, 2, 1) })
    expect(roomStatsLines(stats, 'ft')).toEqual(['26 seats for 32 guests', '6 seats short: 1 more table of 8', 'Dance floor: 8 sq ft per guest'])
    const ok = roomStats({ layoutKind: 'reception', canvas: { items: [table(8)] }, guests: guests(7, 0, 0) })
    expect(roomStatsLines(ok, 'm')).toEqual(['8 seats for 7 guests', '1 seat spare', 'No dance floor'])
    const exact = roomStats({ layoutKind: 'reception', canvas: { items: [table(1), floor(100, 100)] }, guests: guests(1, 0, 0) })
    expect(roomStatsLines(exact, 'm')).toEqual(['1 seat for 1 guest', 'Enough seats', 'Dance floor: 1.0 m² per guest'])
    for (const line of [...roomStatsLines(stats, 'ft'), ...roomStatsLines(ok, 'm')]) {
      expect(line).not.toMatch(/[—!]/)
    }
  })
})

describe('roomStats, ceremony', () => {
  it('counts chairs against yes and against yes or pending, with reserved rows', () => {
    const items: Item[] = [row(10, 'Family, row 1'), row(10, '  '), row(10), row(8, 'Family, row 2')]
    const stats = roomStats({ layoutKind: 'ceremony', canvas: { items }, guests: guests(30, 12, 5) })
    expect(stats).toEqual({
      kind: 'ceremony',
      chairs: 38,
      yes: 30,
      yesOrPending: 42,
      shortForYes: 0,
      shortForYesOrPending: 4,
      reservedChairs: 18,
      reservedRows: 2,
    })
    expect(roomStatsLines(stats, 'ft')).toEqual(['38 chairs', '30 said yes: enough', '42 said yes or not yet: 4 short', '18 chairs reserved in 2 rows'])
    const short = roomStats({ layoutKind: 'ceremony', canvas: { items: [row(5)] }, guests: guests(6, 0, 0) })
    expect(roomStatsLines(short, 'm')).toEqual(['5 chairs', '6 said yes: 1 short', '6 said yes or not yet: 1 short'])
  })
})
