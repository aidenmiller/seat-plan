import { describe, expect, it } from 'vitest'
import type { Canvas, ChairRow, Item, Seat, Table } from './canvas-schema'
import {
  gapMessage,
  layoutProblems,
  namesText,
  problemCountText,
  wallIndexFor,
  worstSeverity,
  type ProblemsGuest,
  type ProblemsInput,
} from './problems'
import { evaluateRules, seatKey, type Rule } from './rules'
import { seatCenters } from './seating'
import { tightReason } from './seats'
import type { FixedItem } from './venue-schema'
import { buildWallIndex } from './walls'

const G = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const [A, B, C, D] = [1, 2, 3, 4].map(G)

function seats(n: number, taken: Record<number, string> = {}): Seat[] {
  return Array.from({ length: n }, (_, index) => ({ index, guestId: taken[index] ?? null }))
}

function table(id: string, taken: Record<number, string> = {}, overrides: Partial<Table> = {}): Table {
  const seatCount = overrides.seatCount ?? 8
  const n = Number(id.replace(/\D/g, '')) || 1
  return {
    id,
    kind: 'table',
    shape: 'round',
    x: n * 400,
    y: 0,
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

function row(id: string, rowNumber: number, taken: Record<number, string> = {}): ChairRow {
  return {
    id,
    kind: 'chairRow',
    x: 0,
    y: rowNumber * 100,
    rotation: 0,
    locked: false,
    chairCount: 6,
    spacing: 50.8,
    blockId: 'b1',
    blockLabel: null,
    rowNumber,
    rowLabel: '',
    reservedFor: null,
    seats: seats(6, taken),
  }
}

const canvas = (...items: Item[]): Canvas => ({ schemaVersion: 1, items })

const NAMES: Record<string, [string, string]> = { [A]: ['Jane', 'Doe'], [B]: ['Tom', 'Doe'], [C]: ['Ann', 'Lee'], [D]: ['Sam', 'Roy'] }

function guest(id: string, extra: Partial<ProblemsGuest> = {}): ProblemsGuest {
  const [firstName, lastName] = NAMES[id] ?? ['Guest', id.slice(-4)]
  return { id, firstName, lastName, rsvp: 'yes', partnerId: null, coupleRuleEnabled: true, ...extra }
}

function couple(a: string, b: string): ProblemsGuest[] {
  return [guest(a, { partnerId: b }), guest(b, { partnerId: a })]
}

function rule(id: string, kind: Rule['kind'], guestIds: string[], extra: Partial<Rule> = {}): Rule {
  return { id, kind, guestIds, nextToEachOther: false, appliesTo: 'both', enabled: true, ...extra }
}

function input(c: Canvas, guests: ProblemsGuest[], rules: Rule[] = [], extra: Partial<ProblemsInput> = {}): ProblemsInput {
  return { layoutKind: 'reception', canvas: c, guests, rules, unit: 'ft', ...extra }
}

function wall(id: string, points: { x: number; y: number }[], thickness = 20): FixedItem {
  return { id, type: 'wall', points, thickness, unsure: false, unsureNote: '' }
}

describe('layoutProblems: rules', () => {
  it('lists partners at different tables as one problem on both tables (acceptance check 14)', () => {
    const c = canvas(table('t1', { 0: A }), table('t2', { 3: B }))
    const list = layoutProblems(input(c, couple(A, B)))
    expect(list.problemCount).toBe(1)
    expect(list.warnings).toEqual([])
    const [p] = list.problems
    expect(p).toMatchObject({
      id: `rule:couple:${A}:${B}`,
      kind: 'rule',
      severity: 'problem',
      title: 'Jane Doe and Tom Doe',
      message: 'Partners split across 2 tables',
      panTo: { itemIds: ['t1', 't2'], point: { x: 600, y: 0 } },
      badge: {
        itemIds: ['t1', 't2'],
        seats: [
          { itemId: 't1', seatIndex: 0 },
          { itemId: 't2', seatIndex: 3 },
        ],
      },
      guestIds: [A, B],
    })
    expect(p.ruleId).toBe(`couple:${A}:${B}`)
    expect(list.byItem.get('t1')).toEqual([p])
    expect(list.byItem.get('t2')).toEqual([p])
    expect(list.bySeat.get(seatKey('t2', 3))).toEqual([p])
    expect(list.bySeat.get(seatKey('t2', 0))).toBeUndefined()
  })

  it('shows an apart rule at one table, and clears it when one moves away (acceptance check 15)', () => {
    const guests = [guest(C), guest(D)]
    const rules = [rule('ap', 'apart', [C, D])]
    const together = layoutProblems(input(canvas(table('t1', { 0: C, 4: D }), table('t2')), guests, rules))
    expect(together.problems).toHaveLength(1)
    expect(together.problems[0]).toMatchObject({ id: 'rule:ap', title: 'Ann Lee and Sam Roy', message: 'Should sit apart, but share Table 1' })
    expect(together.byItem.get('t1')).toHaveLength(1)
    const moved = layoutProblems(input(canvas(table('t1', { 0: C }), table('t2', { 0: D })), guests, rules))
    expect(moved.problemCount).toBe(0)
    expect(moved.problems).toEqual([])
  })

  it('leaves unfinished together rules out of the list', () => {
    const list = layoutProblems(input(canvas(table('t1', { 0: A })), [guest(A), guest(B), guest(C)], [rule('tg', 'together', [A, B, C])]))
    expect(list.problems).toEqual([])
    expect(list.rules.status.get('tg')).toBe('unfinished')
  })

  it('says rows in ceremony layouts', () => {
    const c = canvas(row('r1', 1, { 0: A }), row('r2', 2, { 0: B }))
    const list = layoutProblems(input(c, couple(A, B), [], { layoutKind: 'ceremony' }))
    expect(list.problems[0]).toMatchObject({ message: 'Partners split across 2 rows', panTo: { itemIds: ['r1', 'r2'], point: { x: 0, y: 150 } } })
  })

  it('reuses a rules check the caller already has', () => {
    const inp = input(canvas(table('t1', { 0: A }), table('t2', { 0: B })), couple(A, B))
    const rules = evaluateRules(inp)
    const list = layoutProblems({ ...inp, rulesResult: rules })
    expect(list.rules).toBe(rules)
    expect(list.problems.map((p) => p.id)).toEqual(layoutProblems(inp).problems.map((p) => p.id))
  })

  it('names at most three guests in a title', () => {
    expect(namesText([])).toBe('')
    expect(namesText(['Jane Doe'])).toBe('Jane Doe')
    expect(namesText(['Jane Doe', 'Tom Doe', 'Ann Lee'])).toBe('Jane Doe, Tom Doe and Ann Lee')
    expect(namesText(['Jane Doe', 'Tom Doe', 'Ann Lee', 'Sam Roy', 'Bo Li'])).toBe('Jane Doe, Tom Doe and 3 more')
  })
})

describe('layoutProblems: walls', () => {
  const across = wall('w1', [
    { x: 400, y: -500 },
    { x: 400, y: 500 },
  ])

  it('counts a table a wall runs through as a problem', () => {
    const c = canvas(table('t1'), table('t2'))
    const list = layoutProblems(input(c, [], [], { walls: [across] }))
    expect(list.problemCount).toBe(1)
    expect(list.problems).toEqual([
      {
        id: 'wall:t1',
        kind: 'wall',
        severity: 'problem',
        title: 'Table 1',
        message: 'Crosses a wall',
        panTo: { itemIds: ['t1'], point: { x: 400, y: 0 } },
        badge: { itemIds: ['t1'], seats: [] },
        ruleId: null,
        guestIds: [],
      },
    ])
    // An index built ahead gives the same answer, and the fixed items are indexed once.
    expect(layoutProblems(input(c, [], [], { walls: buildWallIndex([across]) })).problems).toEqual(list.problems)
    const fixed = [across]
    expect(wallIndexFor(fixed)).toBe(wallIndexFor(fixed))
  })

  it('puts rule problems before wall crossings and counts both', () => {
    const c = canvas(table('t1', { 0: A }), table('t2', { 0: B }))
    const list = layoutProblems(input(c, couple(A, B), [], { walls: [across] }))
    expect(list.problems.map((p) => p.id)).toEqual([`rule:couple:${A}:${B}`, 'wall:t1'])
    expect(list.problemCount).toBe(2)
    expect(worstSeverity(list.byItem.get('t1'))).toBe('problem')
    expect(list.byItem.get('t1')).toHaveLength(2)
  })

  it('finds nothing without walls', () => {
    expect(layoutProblems(input(canvas(table('t1')), [], [], { walls: [] })).problems).toEqual([])
    expect(layoutProblems(input(canvas(table('t1')), [])).problems).toEqual([])
  })
})

describe('layoutProblems: warnings', () => {
  it('lists tight tables, narrow gaps and seated guests who answered no, without counting them', () => {
    const tight = table('t1', { 2: C }, { seatCount: 10 })
    // Table 2 sits 300 cm from table 3, center to center: 147.6 cm between edges.
    const t2 = table('t2', {}, { x: 1000 })
    const t3 = table('t3', {}, { x: 1300 })
    const list = layoutProblems(input(canvas(tight, t2, t3), [guest(C, { rsvp: 'no' })]))
    expect(list.problemCount).toBe(0)
    expect(list.warningCount).toBe(3)
    expect(list.warnings.map((w) => [w.id, w.kind, w.severity, w.title, w.message])).toEqual([
      ['tight:t1', 'tight', 'warning', 'Table 1', `Tight: ${tightReason(tight, 'ft')}`],
      ['gap:t2|t3', 'gap', 'warning', 'Table 2 and Table 3', '4′ 10″ apart, under the 5′ 0″ minimum'],
      [`declined:${C}`, 'declined', 'warning', 'Ann Lee', 'Answered no, but has a seat at Table 1'],
    ])
    expect(list.warnings[0].message).toMatch(/^Tight: 10 seats need /)
    const gap = list.warnings[1]
    expect(gap.panTo.itemIds).toEqual(['t2', 't3'])
    expect(gap.panTo.point.x).toBeCloseTo(1150)
    expect(gap.panTo.point.y).toBeCloseTo(0)
    expect(gap.badge.itemIds).toEqual(['t2', 't3'])
    const declined = list.warnings[2]
    expect(declined.panTo.point).toEqual(seatCenters(tight)[2])
    expect(declined.badge).toEqual({ itemIds: ['t1'], seats: [{ itemId: 't1', seatIndex: 2 }] })
    expect(worstSeverity(list.byItem.get('t1'))).toBe('warning')
    expect(list.bySeat.get(seatKey('t1', 2))).toEqual([declined])
  })

  it("uses the wedding's minimum gap and unit", () => {
    const c = canvas(table('t1'), table('t2'))
    // 400 cm apart center to center: 247.6 cm between edges.
    expect(layoutProblems(input(c, [])).warnings).toEqual([])
    const wide = layoutProblems(input(c, [], [], { minGapCm: 300, unit: 'm' }))
    expect(wide.warnings.map((w) => w.message)).toEqual(['2.48 m apart, under the 3.00 m minimum'])
    expect(gapMessage(-5, 152.4, 'ft')).toBe('Overlapping')
  })

  it('keeps ids the same while the cause stays', () => {
    const c1 = canvas(table('t1', { 0: A }), table('t2', { 0: B }, { x: 1000 }), table('t3', {}, { x: 1300 }))
    const c2 = canvas(table('t1', { 0: A }, { name: 'Family' }), table('t2', { 1: B }, { x: 1000 }), table('t3', {}, { x: 1290 }))
    const ids = (c: Canvas) => {
      const l = layoutProblems(input(c, couple(A, B)))
      return [...l.problems, ...l.warnings].map((p) => p.id)
    }
    expect(ids(c2)).toEqual(ids(c1))
  })
})

describe('problemCountText', () => {
  it('counts problems for the top bar', () => {
    expect(problemCountText(0)).toBe('No seating problems')
    expect(problemCountText(1)).toBe('1 seating problem')
    expect(problemCountText(3)).toBe('3 seating problems')
    expect(worstSeverity(undefined)).toBeNull()
    expect(worstSeverity([])).toBeNull()
  })
})

describe('layoutProblems speed', () => {
  it('checks 400 guests, 40 tables, 200 rules and 2,000 wall pieces in under 16 ms', () => {
    const tables: Table[] = []
    const guests: ProblemsGuest[] = []
    for (let t = 0; t < 40; t++) {
      const taken: Record<number, string> = {}
      for (let s = 0; s < 10; s++) if (t % 2 === 0 || s < 5) taken[s] = G(t * 10 + s + 1)
      // Some tables close together (narrow gaps), some with 12 seats (tight).
      tables.push(table(`t${t + 1}`, taken, { seatCount: t % 5 === 0 ? 12 : 10, x: (t % 8) * 300, y: Math.floor(t / 8) * 400 }))
    }
    for (let i = 1; i <= 400; i++) {
      const partner = i % 4 === 1 ? i + 1 : i % 4 === 2 ? i - 1 : null
      guests.push(guest(G(i), { partnerId: partner ? G(partner) : null, rsvp: i % 17 === 0 ? 'no' : 'yes' }))
    }
    let seed = 7
    const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647
    const rules: Rule[] = []
    for (let i = 0; i < 200; i++) {
      const size = 2 + Math.floor(rand() * 5)
      const ids = Array.from({ length: size }, () => G(1 + Math.floor(rand() * 400)))
      rules.push(rule(`r${i}`, i % 3 === 0 ? 'apart' : 'together', ids, { nextToEachOther: i % 3 === 1 }))
    }
    const fixed: FixedItem[] = []
    for (let w = 0; w < 100; w++) {
      const points = [{ x: rand() * 3000, y: rand() * 2000 }]
      for (let k = 0; k < 20; k++) points.push({ x: points[k].x + (rand() - 0.5) * 300, y: points[k].y + (rand() - 0.5) * 300 })
      fixed.push(wall(`w${w}`, points, 15))
    }
    expect(wallIndexFor(fixed).segments).toHaveLength(2000)
    const inp = input(canvas(...tables), guests, rules, { walls: fixed })
    for (let i = 0; i < 20; i++) layoutProblems(inp)
    const times: number[] = []
    for (let i = 0; i < 31; i++) {
      const start = performance.now()
      layoutProblems(inp)
      times.push(performance.now() - start)
    }
    times.sort((a, b) => a - b)
    expect(times[Math.floor(times.length / 2)]).toBeLessThan(16)
    const list = layoutProblems(inp)
    expect(list.problems.some((p) => p.kind === 'rule')).toBe(true)
    expect(list.problems.some((p) => p.kind === 'wall')).toBe(true)
    expect(list.warnings.some((p) => p.kind === 'tight')).toBe(true)
    expect(list.warnings.some((p) => p.kind === 'gap')).toBe(true)
    expect(list.warnings.some((p) => p.kind === 'declined')).toBe(true)
  })
})
