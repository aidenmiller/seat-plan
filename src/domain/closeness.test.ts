import { describe, expect, it } from 'vitest'
import type { Canvas, ChairRow, Item, Seat, Table } from './canvas-schema'
import {
  closenessScores,
  closenessText,
  compareLoosestFirst,
  leftOutOfFill,
  NO_SCORE,
  spreadFromCounts,
  spreadText,
  tightnessText,
  type ClosenessGroup,
  type ClosenessGuest,
  type ClosenessInput,
  type GroupCloseness,
} from './closeness'
import { CM_PER_FOOT } from './units'

const G = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function seats(n: number, taken: readonly string[] = []): Seat[] {
  return Array.from({ length: n }, (_, index) => ({ index, guestId: taken[index] ?? null }))
}

function table(id: string, x: number, y: number, seatCount: number, taken: readonly string[] = [], overrides: Partial<Table> = {}): Table {
  const n = Number(id.replace(/\D/g, '')) || 1
  return {
    id,
    kind: 'table',
    shape: 'round',
    x,
    y,
    rotation: 0,
    locked: false,
    width: 152.4,
    height: 152.4,
    number: n,
    name: `Table ${n}`,
    seatCount,
    seatSides: 'all',
    seats: seats(seatCount, taken),
    ...overrides,
  }
}

function row(id: string, rowNumber: number, chairCount: number, taken: readonly string[] = []): ChairRow {
  return {
    id,
    kind: 'chairRow',
    x: 0,
    y: rowNumber * 91.44,
    rotation: 0,
    locked: false,
    chairCount,
    spacing: 50.8,
    blockId: 'b1',
    blockLabel: null,
    rowNumber,
    rowLabel: '',
    reservedFor: null,
    seats: seats(chairCount, taken),
  }
}

const canvas = (...items: Item[]): Canvas => ({ schemaVersion: 1, items })
const guests = (ids: readonly string[], declined: readonly string[] = []): ClosenessGuest[] =>
  ids.map((id) => ({ id, rsvp: declined.includes(id) ? 'no' : 'yes' }))
const ids = (from: number, count: number) => Array.from({ length: count }, (_, i) => G(from + i))

function input(c: Canvas, gs: ClosenessGuest[], groups: ClosenessGroup[], layoutKind: ClosenessInput['layoutKind'] = 'reception'): ClosenessInput {
  return { layoutKind, canvas: c, guests: gs, groups }
}

function only(c: Canvas, gs: ClosenessGuest[], group: ClosenessGroup, layoutKind: ClosenessInput['layoutKind'] = 'reception'): GroupCloseness {
  const [score] = closenessScores(input(c, gs, [group], layoutKind))
  return score
}

describe('closenessScores', () => {
  it('scores a group of 12 over two tables of 10 as 100% tight (acceptance check 16)', () => {
    const members = ids(1, 12)
    for (const split of [6, 7, 10]) {
      const c = canvas(
        table('t1', 0, 0, 10, members.slice(0, split)),
        table('t2', 400, 0, 10, members.slice(split)),
        table('t3', 800, 0, 10),
        table('t4', 1200, 0, 10),
      )
      const score = only(c, guests(members), { id: 'g', name: 'Aiden HS Friends', memberIds: members })
      expect(score).toMatchObject({ counted: 12, tablesUsed: 2, fewestPossible: 2, tightness: 1 })
      expect(closenessText(score, 'ft', 'reception').line).toMatch(/^Aiden HS Friends · 12 of 12 seated · 2 tables \(2 possible\) · 100% tight · /)
    }
  })

  it('leaves head and sweetheart tables out of fewest possible', () => {
    const members = ids(1, 12)
    const c = canvas(
      // A 24 ft head table seating 12 on one side, and a sweetheart table.
      table('t1', 0, -600, 12, [], { shape: 'rect', width: 731.52, height: 76.2, seatSides: 'oneSide' }),
      table('t2', 0, -300, 2, [], { width: 91.44, height: 91.44 }),
      table('t3', 0, 0, 10, members.slice(0, 6)),
      table('t4', 400, 0, 10, members.slice(6)),
    )
    expect(leftOutOfFill(c.items[0] as Table)).toBe(true)
    expect(leftOutOfFill(c.items[1] as Table)).toBe(true)
    expect(leftOutOfFill(c.items[2] as Table)).toBe(false)
    const score = only(c, guests(members), { id: 'g', name: 'Friends', memberIds: members })
    expect(score).toMatchObject({ tablesUsed: 2, fewestPossible: 2, tightness: 1 })
  })

  it('fills the largest tables first', () => {
    const members = ids(1, 15)
    const c = canvas(
      table('t1', 0, 0, 8, members.slice(0, 5)),
      table('t2', 400, 0, 8, members.slice(5, 10)),
      table('t3', 800, 0, 8, members.slice(10, 15)),
      table('t4', 1200, 0, 12),
      table('t5', 1600, 0, 10),
    )
    // 12 + 10 seats hold 15.
    const score = only(c, guests(members), { id: 'g', name: 'Friends', memberIds: members })
    expect(score).toMatchObject({ tablesUsed: 3, fewestPossible: 2 })
    expect(score.tightness).toBeCloseTo(2 / 3)
    expect(score.itemIds).toEqual(['t1', 't2', 't3'])
  })

  it('never says more tables are possible than the group already uses', () => {
    // The wedding party at the head table: other tables are too small to beat it.
    const members = ids(1, 12)
    const c = canvas(table('t1', 0, 0, 12, members, { shape: 'rect', width: 731.52, height: 76.2, seatSides: 'oneSide' }), table('t2', 0, 400, 10), table('t3', 400, 400, 10))
    const score = only(c, guests(members), { id: 'g', name: 'Wedding party', memberIds: members })
    expect(score).toMatchObject({ tablesUsed: 1, fewestPossible: 1, tightness: 1, spreadCm: 0 })
  })

  it('uses left-out tables only when the other tables cannot hold the group', () => {
    const members = ids(1, 8)
    const c = canvas(
      table('t1', 0, 0, 12, members.slice(0, 6), { shape: 'rect', width: 731.52, height: 76.2, seatSides: 'oneSide' }),
      table('t2', 0, 400, 2, members.slice(6, 7), { width: 91.44, height: 91.44 }),
      table('t3', 400, 400, 4, members.slice(7)),
    )
    // The 4-seat table holds 4; the 12-seat head table then makes 16.
    const score = only(c, guests(members), { id: 'g', name: 'Friends', memberIds: members })
    expect(score).toMatchObject({ tablesUsed: 3, fewestPossible: 2 })
  })

  it('counts members who answered no only when they have a seat', () => {
    const [a, b, c, d, e] = ids(1, 5)
    const cv = canvas(table('t1', 0, 0, 10, [a, b, d]))
    // d answered no but sits; e answered no and has no seat; c has no seat.
    const score = only(cv, guests([a, b, c, d, e], [d, e]), { id: 'g', name: 'Friends', memberIds: [a, b, c, d, e] })
    expect(score).toMatchObject({ counted: 4, seatedIds: [a, b, d], unseatedIds: [c] })
  })

  it('skips removed guests and repeated members', () => {
    const [a, b, gone] = ids(1, 3)
    const cv = canvas(table('t1', 0, 0, 10, [a, gone]), table('t2', 400, 0, 10, [b]))
    const score = only(cv, guests([a, b]), { id: 'g', name: 'Friends', memberIds: [a, a, gone, b] })
    expect(score).toMatchObject({ counted: 2, seatedIds: [a, b], tablesUsed: 2, itemIds: ['t1', 't2'] })
  })

  it('measures spread between table centers, 0 for two at one table', () => {
    const m = ids(1, 4)
    // Two at each of two tables 300 cm apart: 4 of the 6 pairs are 300 apart.
    const two = only(canvas(table('t1', 0, 0, 10, m.slice(0, 2)), table('t2', 300, 0, 10, m.slice(2))), guests(m), { id: 'g', name: 'F', memberIds: m })
    expect(two.spreadCm).toBeCloseTo(200)
    const one = only(canvas(table('t1', 0, 0, 10, m)), guests(m), { id: 'g', name: 'F', memberIds: m })
    expect(one.spreadCm).toBe(0)
  })

  it('works spread out from counts the same as pair by pair', () => {
    let seed = 11
    const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647
    const tables = Array.from({ length: 12 }, () => ({ x: rand() * 3000, y: rand() * 2000, count: Math.floor(rand() * 6) }))
    const people = tables.flatMap((t) => Array.from({ length: t.count }, () => t))
    let sum = 0
    let pairs = 0
    for (let i = 0; i < people.length; i++) {
      for (let j = i + 1; j < people.length; j++) {
        sum += Math.hypot(people[i].x - people[j].x, people[i].y - people[j].y)
        pairs++
      }
    }
    expect(spreadFromCounts(tables)).toBeCloseTo(sum / pairs, 6)
    expect(spreadFromCounts([{ x: 0, y: 0, count: 1 }])).toBeNull()
    expect(spreadFromCounts([])).toBeNull()
  })

  it('shows a dash for tightness and spread with one member seated', () => {
    const m = ids(1, 3)
    const score = only(canvas(table('t1', 0, 0, 10, m.slice(0, 1))), guests(m), { id: 'g', name: 'Noa Family', memberIds: m })
    expect(score).toMatchObject({ tablesUsed: 1, fewestPossible: 1, tightness: null, spreadCm: null, unseatedIds: m.slice(1) })
    const text = closenessText(score, 'ft', 'reception')
    expect(text.line).toBe(`Noa Family · 1 of 3 seated · 1 table (1 possible) · ${NO_SCORE} tight · ${NO_SCORE} spread`)
    expect(text.parts.find((p) => p.key === 'tight')?.tooltip).toBe('Needs at least two guests from this group seated.')
  })

  it('shows only the seated count when nobody is seated, and sorts that group last', () => {
    const m = ids(1, 12)
    const other = ids(20, 2)
    const scores = closenessScores(
      input(canvas(table('t1', 0, 0, 10, other)), guests([...m, ...other]), [
        { id: 'a', name: 'Aardvarks', memberIds: m },
        { id: 'b', name: 'Bees', memberIds: other },
      ]),
    )
    expect(scores.map((s) => s.groupId)).toEqual(['b', 'a'])
    expect(closenessText(scores[1], 'ft', 'reception')).toMatchObject({ line: 'Aardvarks · 0 of 12 seated', parts: [{ key: 'seated' }] })
    expect(scores[1]).toMatchObject({ tablesUsed: 0, fewestPossible: 0, tightness: null, spreadCm: null })
  })

  it('sorts loosest first: lowest tightness, then largest spread, then name', () => {
    const m = ids(1, 40)
    const c = canvas(
      table('t1', 0, 0, 10, [m[0], m[1], m[4], m[6], m[8], m[10]]),
      table('t2', 300, 0, 10, [m[2], m[5], m[9]]),
      table('t3', 900, 0, 10, [m[3], m[7], m[11]]),
    )
    const groups: ClosenessGroup[] = [
      { id: 'tight', name: 'Tight', memberIds: [m[0], m[1]] },
      { id: 'near', name: 'Near', memberIds: [m[4], m[5]] }, // 2 tables, 300 apart: 50%
      { id: 'far', name: 'Far', memberIds: [m[6], m[7]] }, // 2 tables, 900 apart: 50%
      { id: 'three', name: 'Three', memberIds: [m[8], m[9], m[3]] }, // 3 tables: 33%
      { id: 'one', name: 'One', memberIds: [m[10], m[20]] },
      { id: 'none', name: 'None', memberIds: [m[21]] },
      { id: 'also', name: 'Also tight', memberIds: [m[2], m[5]] },
    ]
    const scores = closenessScores(input(c, guests(m), groups))
    expect(scores.map((s) => s.groupId)).toEqual(['three', 'far', 'near', 'also', 'tight', 'one', 'none'])
    expect([...scores].sort(compareLoosestFirst)).toEqual(scores)
  })

  it('uses chair rows as tables in ceremony layouts', () => {
    const m = ids(1, 10)
    const c = canvas(row('r1', 1, 6, m.slice(0, 3)), row('r2', 2, 6, m.slice(3, 6)), row('r3', 3, 6, m.slice(6, 9)), row('r4', 4, 8))
    const score = only(c, guests(m), { id: 'g', name: 'Cousins', memberIds: m }, 'ceremony')
    // 8 + 6 chairs hold 9.
    expect(score).toMatchObject({ tablesUsed: 3, fewestPossible: 2, itemIds: ['r1', 'r2', 'r3'], unseatedIds: [m[9]] })
    // Rows 3 ft apart, three in each: 9 pairs across rows 1 and 2, 9 across 2 and 3 (3 ft each), 9 across 1 and 3 (6 ft), of 36 pairs.
    expect(score.spreadCm).toBeCloseTo((9 * 91.44 + 9 * 91.44 + 9 * 182.88) / 36)
    const text = closenessText(score, 'ft', 'ceremony')
    expect(text.line).toBe('Cousins · 9 of 10 seated · 3 rows (2 possible) · 67% tight · 3 ft spread')
    expect(text.parts.find((p) => p.key === 'tables')?.tooltip).toBe('They sit in 3 rows. Filling the longest rows first, 2 rows would hold them.')
  })

  it('takes 400 guests, 40 tables and 40 groups in well under a frame', () => {
    const all = ids(1, 400)
    const tables: Table[] = []
    for (let t = 0; t < 40; t++) tables.push(table(`t${t + 1}`, (t % 8) * 400, Math.floor(t / 8) * 400, 10, all.slice(t * 10, t * 10 + 10)))
    let seed = 3
    const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647
    const groups: ClosenessGroup[] = Array.from({ length: 40 }, (_, i) => ({
      id: `g${i}`,
      name: `Group ${i}`,
      memberIds: Array.from({ length: 5 + Math.floor(rand() * 30) }, () => all[Math.floor(rand() * 400)]),
    }))
    const inp = input(canvas(...tables), guests(all), groups)
    for (let i = 0; i < 10; i++) closenessScores(inp)
    const times: number[] = []
    for (let i = 0; i < 21; i++) {
      const start = performance.now()
      closenessScores(inp)
      times.push(performance.now() - start)
    }
    times.sort((a, b) => a - b)
    expect(times[10]).toBeLessThan(4)
  })
})

describe('closenessText', () => {
  const base: GroupCloseness = {
    groupId: 'g',
    name: 'Aiden HS Friends',
    counted: 12,
    seatedIds: ids(1, 11),
    unseatedIds: ids(12, 1),
    itemIds: ['t1', 't2', 't3'],
    tablesUsed: 3,
    fewestPossible: 2,
    tightness: 2 / 3,
    spreadCm: 9 * CM_PER_FOOT + 4,
  }

  it("writes the spec's example line", () => {
    expect(closenessText(base, 'ft', 'reception').line).toBe('Aiden HS Friends · 11 of 12 seated · 3 tables (2 possible) · 67% tight · 9 ft spread')
    expect(closenessText(base, 'm', 'reception').line).toBe('Aiden HS Friends · 11 of 12 seated · 3 tables (2 possible) · 67% tight · 2.8 m spread')
  })

  it('explains each number in plain words', () => {
    const tips = Object.fromEntries(closenessText(base, 'ft', 'reception').parts.map((p) => [p.key, p.tooltip]))
    expect(tips).toEqual({
      seated: '11 of the 12 guests in this group have a seat. Guests who answered no and have no seat are left out.',
      tables: 'They sit at 3 tables. Filling the largest tables first, 2 tables would hold them. Head and sweetheart tables are left out.',
      tight: '2 tables possible out of 3 tables used. 100% means they could not sit any closer.',
      spread: 'On average, two guests in this group sit 9 ft apart, measured between table centers. Two at the same table count as 0.',
    })
    for (const tip of Object.values(tips)) {
      expect(tip).not.toMatch(/[—!]/)
    }
    const all = closenessText({ ...base, seatedIds: ids(1, 12), unseatedIds: [] }, 'ft', 'reception')
    expect(all.parts[0].tooltip).toBe('Everyone in this group has a seat. Guests who answered no and have no seat are left out.')
  })

  it('says one table in the singular', () => {
    const one = closenessText({ ...base, tablesUsed: 1, fewestPossible: 1, tightness: 1, spreadCm: 0 }, 'ft', 'reception')
    expect(one.line).toBe('Aiden HS Friends · 11 of 12 seated · 1 table (1 possible) · 100% tight · 0 ft spread')
  })
})

describe('number formats', () => {
  it('rounds tightness, keeping 100% for groups that could not sit closer', () => {
    expect(tightnessText(1)).toBe('100%')
    expect(tightnessText(2 / 3)).toBe('67%')
    expect(tightnessText(0.5)).toBe('50%')
    expect(tightnessText(199 / 200)).toBe('99%')
    expect(tightnessText(null)).toBe(NO_SCORE)
  })

  it('writes spread in whole feet or tenths of a meter', () => {
    expect(spreadText(0, 'ft')).toBe('0 ft')
    expect(spreadText(9 * CM_PER_FOOT, 'ft')).toBe('9 ft')
    expect(spreadText(9.6 * CM_PER_FOOT, 'ft')).toBe('10 ft')
    expect(spreadText(10, 'ft')).toBe('under 1 ft')
    expect(spreadText(0, 'm')).toBe('0 m')
    expect(spreadText(300, 'm')).toBe('3 m')
    expect(spreadText(274, 'm')).toBe('2.7 m')
    expect(spreadText(4, 'm')).toBe('under 0.1 m')
    expect(spreadText(null, 'm')).toBe(NO_SCORE)
  })
})
