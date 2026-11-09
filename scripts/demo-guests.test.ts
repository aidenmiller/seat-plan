import { describe, expect, it } from 'vitest'
import { nameKey } from '../src/domain/names'
import { DEMO_GROUPS, demoPlan, PLAN_A_TABLES, TOUR_TABLES } from './demo-guests'

const NAMES = { tour: 'Canvas tour', planA: 'Reception plan A' }

describe('the demo guest list', () => {
  const plan = demoPlan(NAMES)
  const { guests } = plan

  it('is the same on every run', () => {
    expect(demoPlan(NAMES)).toEqual(plan)
  })

  it('has about 120 guests with different names, a few with accents', () => {
    expect(guests.length).toBeGreaterThanOrEqual(110)
    expect(guests.length).toBeLessThanOrEqual(130)
    const keys = guests.map((g) => nameKey(g.firstName, g.lastName))
    expect(new Set(keys).size).toBe(guests.length)
    const names = guests.map((g) => `${g.firstName} ${g.lastName}`)
    expect(names).toContain('Zoë Shapiro')
    expect(names).toContain('Łukasz Nowak')
    expect(names.filter((n) => n.normalize('NFKD') !== n || /[łøØŁ]/.test(n)).length).toBeGreaterThanOrEqual(5)
  })

  it('spreads sides, has mostly yes with some pending and a few no, some children, meals and notes', () => {
    const count = (f: (g: (typeof guests)[number]) => boolean) => guests.filter(f).length
    for (const side of ['Noa', 'Aiden', 'Both'] as const) expect(count((g) => g.side === side), side).toBeGreaterThanOrEqual(15)
    expect(count((g) => g.rsvp === 'yes')).toBeGreaterThan(guests.length * 0.7)
    expect(count((g) => g.rsvp === 'pending')).toBeGreaterThanOrEqual(5)
    expect(count((g) => g.rsvp === 'no')).toBeGreaterThanOrEqual(3)
    expect(count((g) => g.rsvp === 'no')).toBeLessThan(15)
    expect(count((g) => g.isChild)).toBeGreaterThanOrEqual(5)
    expect(count((g) => g.meal !== null)).toBeGreaterThanOrEqual(5)
    expect(count((g) => g.notes !== null)).toBeGreaterThanOrEqual(3)
  })

  it('has the 8 groups, each with members, and children only in family or friend households', () => {
    expect(plan.groups).toEqual([...DEMO_GROUPS])
    for (const group of plan.groups) expect(guests.filter((g) => g.groups.includes(group)).length, group).toBeGreaterThanOrEqual(5)
    for (const g of guests) for (const name of g.groups) expect(plan.groups).toContain(name)
    // Noa's cousins are all Noa's family.
    for (const g of guests.filter((x) => x.groups.includes('Noa Cousins'))) expect(g.groups).toContain('Noa Family')
  })

  it('links 20 couples, each guest at most once, never a child', () => {
    expect(plan.couples).toHaveLength(20)
    const seen = new Set<number>()
    for (const [a, b] of plan.couples) {
      expect(a).not.toBe(b)
      for (const i of [a, b]) {
        expect(seen.has(i)).toBe(false)
        seen.add(i)
        expect(guests[i]!.isChild).toBe(false)
      }
    }
  })

  it('has 5 rules of two or more guests: together ones (one next to each other) and one apart', () => {
    expect(plan.rules).toHaveLength(5)
    for (const rule of plan.rules) {
      expect(rule.guests.length).toBeGreaterThanOrEqual(2)
      expect(new Set(rule.guests).size).toBe(rule.guests.length)
      if (rule.kind === 'apart') expect(rule.nextToEachOther).toBe(false)
      expect(new Set(plan.rules.map((r) => r.note)).size).toBe(plan.rules.length)
    }
    expect(plan.rules.filter((r) => r.kind === 'together').length).toBeGreaterThanOrEqual(3)
    expect(plan.rules.filter((r) => r.kind === 'together' && r.nextToEachOther)).toHaveLength(1)
    expect(plan.rules.filter((r) => r.kind === 'apart')).toHaveLength(1)
  })

  it('seats about 80 guests across the two layouts, one seat each per layout, nobody who said no, within each table', () => {
    let total = 0
    for (const [name, sizes] of [
      [NAMES.tour, TOUR_TABLES],
      [NAMES.planA, PLAN_A_TABLES],
    ] as const) {
      const tables = plan.seating[name]!
      expect(tables.map((t) => t.number)).toEqual(sizes.map((s) => s.number))
      const seated = tables.flatMap((t) => t.guests)
      expect(new Set(seated).size, name).toBe(seated.length)
      for (const t of tables) expect(t.guests.length).toBeLessThanOrEqual(sizes.find((s) => s.number === t.number)!.seats)
      for (const i of seated) expect(guests[i]!.rsvp, `${name}: ${guests[i]!.firstName}`).not.toBe('no')
      total += seated.length
    }
    expect(total).toBeGreaterThanOrEqual(70)
    expect(total).toBeLessThanOrEqual(90)
    // The sweetheart table stays free for Noa and Aiden.
    expect(plan.seating[NAMES.tour]!.find((t) => t.number === 2)!.guests).toEqual([])
  })

  it('splits one couple in the tour on purpose and none in plan A; the apart rule is broken in the tour', () => {
    const tableOf = (layout: string) => {
      const map = new Map<number, number>()
      for (const t of plan.seating[layout]!) for (const i of t.guests) map.set(i, t.number)
      return map
    }
    const split = (layout: string) => {
      const at = tableOf(layout)
      return plan.couples.filter(([a, b]) => at.has(a) && at.has(b) && at.get(a) !== at.get(b)).length
    }
    expect(split(NAMES.tour)).toBe(1)
    expect(split(NAMES.planA)).toBe(0)
    const tour = tableOf(NAMES.tour)
    const apart = plan.rules.find((r) => r.kind === 'apart')!
    expect(new Set(apart.guests.map((i) => tour.get(i))).size).toBe(1)
    // The next-to-each-other pair sits side by side at the head table.
    const next = plan.rules.find((r) => r.nextToEachOther)!
    const head = plan.seating[NAMES.tour]!.find((t) => t.number === 1)!.guests
    const [x, y] = next.guests.map((i) => head.indexOf(i))
    expect(Math.abs(x! - y!)).toBe(1)
  })
})
