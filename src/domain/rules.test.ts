import { describe, expect, it } from 'vitest'
import type { Canvas, ChairRow, Item, Seat, Table } from './canvas-schema'
import {
  clashes,
  coupleRuleId,
  coupleRules,
  dragTint,
  evaluateRules,
  isCoupleRuleId,
  seatKey,
  withCoupleRules,
  type Rule,
  type RuleGuest,
  type RulesInput,
} from './rules'
import { neighbors } from './seats'
import { seatGuest } from './seating'

const G = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const [A, B, C, D, E] = [1, 2, 3, 4, 5].map(G)

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

function row(id: string, rowNumber: number, taken: Record<number, string> = {}, chairCount = 6): ChairRow {
  return {
    id,
    kind: 'chairRow',
    x: 0,
    y: rowNumber * 100,
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

function canvas(...items: Item[]): Canvas {
  return { schemaVersion: 1, items }
}

function guest(id: string, extra: Partial<RuleGuest> = {}): RuleGuest {
  return { id, rsvp: 'yes', partnerId: null, coupleRuleEnabled: true, ...extra }
}

function couple(a: string, b: string, enabled = true): RuleGuest[] {
  return [guest(a, { partnerId: b, coupleRuleEnabled: enabled }), guest(b, { partnerId: a, coupleRuleEnabled: enabled })]
}

function rule(id: string, kind: Rule['kind'], guestIds: string[], extra: Partial<Rule> = {}): Rule {
  return { id, kind, guestIds, nextToEachOther: false, appliesTo: 'both', enabled: true, ...extra }
}

function input(c: Canvas, guests: RuleGuest[], rules: Rule[] = [], layoutKind: RulesInput['layoutKind'] = 'reception'): RulesInput {
  return { layoutKind, canvas: c, guests, rules }
}

describe('couple rules (PLAN change 8)', () => {
  it('makes one together, next to each other rule per linked pair with the switch on for both', () => {
    const guests = [...couple(A, B), guest(C, { partnerId: D }), guest(D, { partnerId: null }), ...couple(E, G(6), false)]
    const rules = coupleRules(guests)
    expect(rules).toEqual([
      { id: coupleRuleId(A, B), kind: 'together', guestIds: [A, B], nextToEachOther: true, appliesTo: 'both', enabled: true, couple: true },
    ])
    expect(coupleRuleId(B, A)).toBe(coupleRuleId(A, B))
    expect(isCoupleRuleId(rules[0].id)).toBe(true)
    expect(isCoupleRuleId('r1')).toBe(false)
    // One partner switched off is enough to drop it.
    expect(coupleRules([guest(A, { partnerId: B }), guest(B, { partnerId: A, coupleRuleEnabled: false })])).toEqual([])
    expect(withCoupleRules(guests, [rule('r1', 'apart', [C, D])]).map((r) => r.id)).toEqual(['r1', coupleRuleId(A, B)])
  })
})

describe('evaluateRules', () => {
  it('shows partners at different tables as a problem on both tables (acceptance 14)', () => {
    const c = canvas(table('t1', { 0: A }), table('t2', { 3: B }))
    const r = evaluateRules(input(c, couple(A, B)))
    expect(r.problems).toEqual([
      {
        ruleId: coupleRuleId(A, B),
        kind: 'together',
        couple: true,
        reason: 'split',
        guestIds: [A, B],
        itemIds: ['t1', 't2'],
        seats: [
          { itemId: 't1', seatIndex: 0 },
          { itemId: 't2', seatIndex: 3 },
        ],
        message: 'Partners split across 2 tables',
      },
    ])
    expect(r.problemsByItem.get('t1')).toEqual(r.problems)
    expect(r.problemsByItem.get('t2')).toEqual(r.problems)
    expect(r.problemsBySeat.get(seatKey('t2', 3))).toEqual(r.problems)
    expect(r.problemsBySeat.get(seatKey('t2', 2))).toBeUndefined()
    expect(r.problemsByGuest.get(A)).toEqual(r.problems)
    expect(r.status.get(coupleRuleId(A, B))).toBe('problem')
  })

  it('wants partners side by side, the last and first seat of a round table included', () => {
    const check = (a: number, b: number, t: Partial<Table> = {}) => evaluateRules(input(canvas(table('t1', { [a]: A, [b]: B }, t)), couple(A, B)))
    expect(check(0, 1).problems).toEqual([])
    expect(check(7, 0).problems).toEqual([])
    const apart = check(0, 2)
    expect(apart.problems).toHaveLength(1)
    expect(apart.problems[0]).toMatchObject({ reason: 'notNextTo', itemIds: ['t1'], message: 'Partners not next to each other at Table 1' })
  })

  it('follows neighbors() on straight tables: no-ends sides are separate runs, all-sides wraps round corners (change 15)', () => {
    const rect: Partial<Table> = { shape: 'rect', width: 243.84, height: 76.2, seatSides: 'noEnds' }
    const square: Partial<Table> = { shape: 'square', width: 121.92, height: 121.92 }
    const head: Partial<Table> = { shape: 'rect', width: 731.52, height: 76.2, seatSides: 'oneSide', seatCount: 12 }
    for (const shape of [rect, square, head]) {
      const t = table('t1', {}, shape)
      const near = neighbors(t)
      for (let a = 0; a < t.seatCount; a++) {
        for (let b = 0; b < t.seatCount; b++) {
          if (a === b) continue
          const r = evaluateRules(input(canvas(table('t1', { [a]: A, [b]: B }, shape)), couple(A, B)))
          expect(r.problems.length === 0, `${shape.shape} ${shape.seatSides ?? 'all'} seats ${a} and ${b}`).toBe(near[a].includes(b))
        }
      }
    }
  })

  it('wants three or more next to each other to fill one unbroken run', () => {
    const r3 = rule('r1', 'together', [A, B, C], { nextToEachOther: true })
    const guests = [guest(A), guest(B), guest(C)]
    const check = (taken: Record<number, string>) => evaluateRules(input(canvas(table('t1', taken)), guests, [r3]))
    expect(check({ 7: A, 0: B, 1: C }).status.get('r1')).toBe('ok')
    expect(check({ 2: A, 3: C, 4: B }).status.get('r1')).toBe('ok')
    expect(check({ 0: A, 1: B, 3: C }).status.get('r1')).toBe('problem')
    // Two seated with one seat between them: the third can still sit there.
    const gap = check({ 0: A, 2: B })
    expect(gap.status.get('r1')).toBe('unfinished')
    expect(gap.unfinished).toEqual([
      { ruleId: 'r1', couple: false, guestIds: [A, B, C], seatedGuestIds: [A, B], itemIds: ['t1'], message: '2 of 3 seated' },
    ])
    // Two seats between them: nobody can close that.
    expect(check({ 0: A, 3: B }).problems[0]).toMatchObject({ reason: 'notNextTo', guestIds: [A, B], message: 'Not next to each other at Table 1' })
  })

  it('marks a together rule with only some guests seated as unfinished, and a split as a problem', () => {
    const r = rule('r1', 'together', [A, B, C])
    const guests = [guest(A), guest(B), guest(C)]
    expect(evaluateRules(input(canvas(table('t1')), guests, [r])).status.get('r1')).toBe('notSeated')
    const one = evaluateRules(input(canvas(table('t1', { 0: A })), guests, [r]))
    expect(one.status.get('r1')).toBe('unfinished')
    expect(one.unfinished[0].message).toBe('1 of 3 seated')
    expect(one.problems).toEqual([])
    expect(evaluateRules(input(canvas(table('t1', { 0: A, 5: B })), guests, [r])).status.get('r1')).toBe('unfinished')
    const split = evaluateRules(input(canvas(table('t1', { 0: A }), table('t2', { 5: B })), guests, [r]))
    expect(split.problems[0]).toMatchObject({ reason: 'split', guestIds: [A, B], itemIds: ['t1', 't2'], message: 'Split across 2 tables' })
    expect(split.unfinished).toEqual([])
    expect(evaluateRules(input(canvas(table('t1', { 0: A, 1: B, 4: C })), guests, [r])).status.get('r1')).toBe('ok')
  })

  it('shows an apart rule broken at one table, and clears it when one guest moves away (acceptance 15)', () => {
    const r = rule('r1', 'apart', [A, B])
    const guests = [guest(A), guest(B)]
    const c = canvas(table('t1', { 0: A, 4: B }), table('t2'))
    const before = evaluateRules(input(c, guests, [r]))
    expect(before.problems).toEqual([
      {
        ruleId: 'r1',
        kind: 'apart',
        couple: false,
        reason: 'shared',
        guestIds: [A, B],
        itemIds: ['t1'],
        seats: [
          { itemId: 't1', seatIndex: 0 },
          { itemId: 't1', seatIndex: 4 },
        ],
        message: 'Should sit apart, but share Table 1',
      },
    ])
    const moved = seatGuest(c, B, 't2', 0).canvas
    const after = evaluateRules(input(moved, guests, [r]))
    expect(after.problems).toEqual([])
    expect(after.status.get('r1')).toBe('ok')
  })

  it('names every table an apart rule is broken at, in one problem', () => {
    const r = rule('r1', 'apart', [A, B, C, D, E])
    const guests = [A, B, C, D, E].map((id) => guest(id))
    const c = canvas(table('t1', { 0: A, 1: B }), table('t2', { 0: C }), table('t3', { 2: D, 6: E }))
    const res = evaluateRules(input(c, guests, [r]))
    expect(res.problems).toHaveLength(1)
    expect(res.problems[0]).toMatchObject({ guestIds: [A, B, D, E], itemIds: ['t1', 't3'], message: 'Should sit apart, but share Table 1 and Table 3' })
    expect(res.problemsByItem.get('t2')).toBeUndefined()
  })

  it('skips disabled rules, rules for the other layout kind, and rules with fewer than two live guests', () => {
    const c = canvas(table('t1', { 0: A, 1: B, 2: C }))
    const guests = [guest(A), guest(B), guest(C)]
    const rules = [
      rule('off', 'apart', [A, B], { enabled: false }),
      rule('cer', 'apart', [A, B], { appliesTo: 'ceremony' }),
      rule('rec', 'apart', [A, B], { appliesTo: 'reception' }),
      rule('gone', 'apart', [A, G(99)]),
      rule('dup', 'apart', [C, C]),
    ]
    const r = evaluateRules(input(c, guests, rules))
    expect(r.problems.map((p) => p.ruleId)).toEqual(['rec'])
    expect(Object.fromEntries(r.status)).toEqual({ off: 'off', cer: 'otherLayout', rec: 'problem', gone: 'needsGuests', dup: 'needsGuests' })
  })

  it('checks seated guests whatever their answer, and warns about a seated guest who said no', () => {
    const c = canvas(table('t1', { 0: A, 1: B, 3: C }))
    const guests = [guest(A, { rsvp: 'no' }), guest(B), guest(C, { rsvp: 'pending' })]
    const r = evaluateRules(input(c, guests, [rule('r1', 'apart', [A, B])]))
    expect(r.problems).toHaveLength(1)
    expect(r.warnings).toEqual([{ kind: 'declined', guestId: A, itemId: 't1', seatIndex: 0, message: 'Answered no, but has a seat' }])
  })

  it('leaves out an unseated guest who answered no, so the rule is checked without them (review finding)', () => {
    // Ann (A) seat 0, Bo (B) seat 2, Dee (D) between them; Cy (C) said no and has no seat.
    const c = canvas(table('t1', { 0: A, 1: D, 2: B }))
    const guests = [guest(A), guest(B), guest(C, { rsvp: 'no' }), guest(D)]
    const r = evaluateRules(input(c, guests, [rule('nx', 'together', [A, B, C], { nextToEachOther: true })]))
    expect(r.status.get('nx')).toBe('problem')
    expect(r.problems[0]).toMatchObject({ reason: 'notNextTo', guestIds: [A, B] })
    expect(r.unfinished).toEqual([])
    // A partner who said no and has no seat: the couple rule is not left unfinished forever.
    const alone = canvas(table('t1', { 0: A }))
    const declined = evaluateRules(input(alone, [guest(A, { partnerId: B }), guest(B, { partnerId: A, rsvp: 'no' })]))
    expect(declined.status.get(coupleRuleId(A, B))).toBe('ok')
    expect(declined.unfinished).toEqual([])
    // Seated, they count again (with the warning).
    const both = canvas(table('t1', { 0: A }), table('t2', { 0: B }))
    const seated = evaluateRules(input(both, [guest(A, { partnerId: B }), guest(B, { partnerId: A, rsvp: 'no' })]))
    expect(seated.status.get(coupleRuleId(A, B))).toBe('problem')
    expect(seated.warnings).toHaveLength(1)
  })

  it('treats rows as tables in ceremonies, and hides together rules with fewer than two seated (change 18)', () => {
    const guests = [...couple(A, B), guest(C), guest(D)]
    const together = rule('tg', 'together', [C, D])
    // One partner seated by name: hidden, not grey.
    const one = evaluateRules(input(canvas(row('r1', 1, { 0: A })), guests, [together], 'ceremony'))
    expect(one.status.get(coupleRuleId(A, B))).toBe('hidden')
    expect(one.unfinished).toEqual([])
    // Rows on each side of the aisle are separate rows: a couple split by the aisle is a problem.
    const aisle = evaluateRules(input(canvas(row('r1', 1, { 5: A }), row('r2', 1, { 0: B })), guests, [], 'ceremony'))
    expect(aisle.problems[0]).toMatchObject({ reason: 'split', itemIds: ['r1', 'r2'], message: 'Partners split across 2 rows' })
    // Next to each other along a row, never wrapping round its ends.
    expect(evaluateRules(input(canvas(row('r1', 1, { 2: A, 3: B })), guests, [], 'ceremony')).problems).toEqual([])
    expect(evaluateRules(input(canvas(row('r1', 1, { 0: A, 5: B })), guests, [], 'ceremony')).problems[0]).toMatchObject({
      reason: 'notNextTo',
      message: 'Partners not next to each other at Row 1',
    })
    // Apart rules count rows too.
    const apart = evaluateRules(input(canvas(row('r1', 1, { 0: C, 4: D })), guests, [rule('ap', 'apart', [C, D])], 'ceremony'))
    expect(apart.problems[0]).toMatchObject({ reason: 'shared', message: 'Should sit apart, but share Row 1' })
  })

  it('checks 400 guests, 40 tables and 200 rules in under 8 ms', () => {
    const tables: Table[] = []
    const guests: RuleGuest[] = []
    for (let t = 0; t < 40; t++) {
      const taken: Record<number, string> = {}
      for (let s = 0; s < 10; s++) {
        const id = G(t * 10 + s + 1)
        // Every other table full, the rest half full, so some rules are unfinished.
        if (t % 2 === 0 || s < 5) taken[s] = id
      }
      tables.push(table(`t${t + 1}`, taken, { seatCount: 10 }))
    }
    for (let i = 1; i <= 400; i++) {
      const partner = i % 4 === 1 ? i + 1 : i % 4 === 2 ? i - 1 : null
      guests.push(guest(G(i), { partnerId: partner ? G(partner) : null, rsvp: i % 17 === 0 ? 'no' : 'yes' }))
    }
    const rules: Rule[] = []
    let seed = 7
    const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647
    for (let i = 0; i < 200; i++) {
      const size = 2 + Math.floor(rand() * 5)
      const ids = Array.from({ length: size }, () => G(1 + Math.floor(rand() * 400)))
      rules.push(rule(`r${i}`, i % 3 === 0 ? 'apart' : 'together', ids, { nextToEachOther: i % 3 === 1 }))
    }
    const c = canvas(...tables)
    const run = () => evaluateRules(input(c, guests, rules))
    for (let i = 0; i < 30; i++) run()
    const times: number[] = []
    for (let i = 0; i < 31; i++) {
      const start = performance.now()
      run()
      times.push(performance.now() - start)
    }
    times.sort((a, b) => a - b)
    expect(times[Math.floor(times.length / 2)]).toBeLessThan(8)
    const r = run()
    expect(r.status.size).toBe(200 + 100)
    expect(r.problems.length).toBeGreaterThan(0)
  })
})

describe('clashes (PLAN change 16)', () => {
  it('flags together and apart rules that share two or more guests for the same layout kind', () => {
    const rules = [
      rule('t', 'together', [A, B, C]),
      rule('a', 'apart', [B, C, D]),
      rule('one', 'apart', [A, D]),
      rule('cer', 'apart', [A, B], { appliesTo: 'ceremony' }),
      rule('off', 'apart', [A, B], { enabled: false }),
    ]
    expect(clashes(rules)).toEqual([
      { togetherRuleId: 't', apartRuleId: 'a', guestIds: [B, C] },
      { togetherRuleId: 't', apartRuleId: 'cer', guestIds: [A, B] },
    ])
    const split = [rule('t', 'together', [A, B], { appliesTo: 'reception' }), rule('a', 'apart', [A, B], { appliesTo: 'ceremony' })]
    expect(clashes(split)).toEqual([])
  })

  it('includes couple rules when given them', () => {
    const guests = couple(A, B)
    expect(clashes(withCoupleRules(guests, [rule('a', 'apart', [A, B])]))).toEqual([{ togetherRuleId: coupleRuleId(A, B), apartRuleId: 'a', guestIds: [A, B] }])
  })
})

describe('dragTint', () => {
  const groups = [{ id: 'g1', memberIds: [A, C] }]

  it('tints tables with the partner or a group mate green', () => {
    const c = canvas(table('t1', { 0: B }), table('t2', { 0: C }), table('t3', { 0: D }))
    const guests = [guest(A, { partnerId: B, coupleRuleEnabled: false }), guest(B, { partnerId: A, coupleRuleEnabled: false }), guest(C), guest(D)]
    const tint = dragTint({ ...input(c, guests), groups }, A)
    expect(Object.fromEntries(tint)).toEqual({ t1: 'good', t2: 'good', t3: 'none' })
  })

  it('tints red where seating the guest would break a rule, which beats green', () => {
    const c = canvas(table('t1', { 0: B }), table('t2', { 0: C }), table('t3', { 0: D }), table('t4'))
    const guests = [...couple(A, B), guest(C), guest(D)]
    // The couple rule wants A at t1; the apart rule keeps A away from C.
    const tint = dragTint({ ...input(c, guests, [rule('ap', 'apart', [A, C])]), groups }, A)
    expect(Object.fromEntries(tint)).toEqual({ t1: 'good', t2: 'bad', t3: 'bad', t4: 'bad' })
  })

  it('counts the dragged guest own seat as free, and ignores rules that do not apply here', () => {
    const c = canvas(table('t1', { 0: A, 1: C }), table('t2'))
    const guests = [guest(A), guest(C)]
    const rules = [rule('ap', 'apart', [A, C], { appliesTo: 'ceremony' }), rule('tg', 'together', [A, C], { enabled: false })]
    expect(Object.fromEntries(dragTint({ ...input(c, guests, rules), groups: [] }, A))).toEqual({ t1: 'none', t2: 'none' })
    // Only the dragged guest seated: nothing to break.
    const alone = canvas(table('t1', { 0: A }), table('t2'))
    expect(Object.fromEntries(dragTint({ ...input(alone, couple(A, B)), groups: [] }, A))).toEqual({ t1: 'none', t2: 'none' })
  })

  it('tints the table red when no seat there could sit the guest next to the others', () => {
    const guests = [guest(A), guest(B), guest(C)]
    const r = rule('nx', 'together', [A, B, C], { nextToEachOther: true })
    const far = canvas(table('t1', { 0: B, 4: C }), table('t2'))
    expect(Object.fromEntries(dragTint({ ...input(far, guests, [r]), groups: [] }, A))).toEqual({ t1: 'bad', t2: 'bad' })
    // B and C one seat apart: A fits between them.
    const gap = canvas(table('t1', { 0: B, 2: C }), table('t2'))
    expect(Object.fromEntries(dragTint({ ...input(gap, guests, [r]), groups: [] }, A))).toEqual({ t1: 'none', t2: 'bad' })
    // The seat between them is taken by someone outside the rule: a drop there swaps, so it still fits.
    const taken = canvas(table('t1', { 0: B, 1: D, 2: C }), table('t2'))
    expect(dragTint({ ...input(taken, [...guests, guest(D)], [r]), groups: [] }, A).get('t1')).toBe('none')
  })

  it('leaves out an unseated guest who answered no when sizing a next-to run (review finding)', () => {
    // B seat 0, C seat 2: with D (declined, unseated) counted, A in seat 1 would leave a run of 4 to fill.
    const guests = [guest(A), guest(B), guest(C), guest(D, { rsvp: 'no' })]
    const r = rule('nx', 'together', [A, B, C, D], { nextToEachOther: true })
    const gap = canvas(table('t1', { 0: B, 3: C }), table('t2'))
    // Seats 0 and 3 with A make 3 of a run of 4 at most: B, A, _, C has a gap, so red once D is left out.
    expect(dragTint({ ...input(gap, guests, [r]), groups: [] }, A).get('t1')).toBe('bad')
    const withD = [guest(A), guest(B), guest(C), guest(D)]
    expect(dragTint({ ...input(gap, withD, [r]), groups: [] }, A).get('t1')).toBe('none')
  })

  it('leaves the tables of an already split together rule alone', () => {
    const guests = [guest(A), guest(B), guest(C)]
    const c = canvas(table('t1', { 0: B }), table('t2', { 0: C }), table('t3'))
    const tint = dragTint({ ...input(c, guests, [rule('tg', 'together', [A, B, C])]), groups: [] }, A)
    expect(Object.fromEntries(tint)).toEqual({ t1: 'none', t2: 'none', t3: 'bad' })
  })
})
