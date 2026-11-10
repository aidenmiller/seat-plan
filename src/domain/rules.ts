/**
 * Seating rules (spec section 7, "Rules"; PLAN section 7, "Rules", changes
 * 7, 8, 15, 16 and 18; DECISIONS 12 and 13). Milestone 5 needs this for the
 * green and red tint while dragging; milestone 6 adds the Rules page, the
 * badges and the Problems tab.
 *
 *  - A rule applies to a layout when its appliesTo is 'both' or matches the
 *    layout's kind. Disabled rules and rules with fewer than two live guests
 *    are not checked.
 *  - Couple rules come from partner links, not rows (change 8): together and
 *    next to each other, both layout kinds, for every linked pair whose
 *    switch is on for both partners.
 *  - Only seated guests are checked, whatever their RSVP; a seated guest who
 *    answered no is a warning (DECISIONS 12). An unseated guest who answered
 *    no is left out of the rule, so it is not unfinished forever. The unit is the table, or the
 *    chair row in ceremony layouts, where only guests seated by name count.
 *  - Together: every seated guest at one table. Seated guests at different
 *    tables are a problem. When only some are seated it is unfinished (grey),
 *    not a problem; in ceremony layouts a together rule with fewer than two
 *    guests seated is hidden instead (change 18).
 *  - Next to each other (change 15): the seated guests fill one unbroken run
 *    of seats, as neighbors() in seats.ts defines it. With some unseated, they
 *    must still fit in one run as long as the whole rule.
 *  - Apart: no two of its seated guests at one table.
 *
 * Pure. Seats are indexed once, so 400 guests, 40 tables and 200 rules take
 * well under the 8 ms budget (half the spec's 16 ms).
 */
import type { Canvas } from './canvas-schema'
import { itemLabel } from './item-labels'
import { seatRuns, type SeatRun } from './seats'
import { isSeatItem, type SeatItem, type SeatRef } from './seating'

export type LayoutKind = 'reception' | 'ceremony'
export type RuleKind = 'together' | 'apart'
export type AppliesTo = 'reception' | 'ceremony' | 'both'
export type Rsvp = 'yes' | 'no' | 'pending'

/** What the rules read from a guest. */
export type RuleGuest = {
  id: string
  rsvp: Rsvp
  partnerId: string | null
  coupleRuleEnabled: boolean
}

export type Rule = {
  id: string
  kind: RuleKind
  guestIds: readonly string[]
  /** Only with 'together'. */
  nextToEachOther: boolean
  appliesTo: AppliesTo
  enabled: boolean
  /** A couple rule worked out from a partner link (no row of its own). */
  couple?: boolean
}

/** What a group needs for the drag tint. */
export type RuleGroup = { id: string; memberIds: readonly string[] }

export type RulesInput = {
  layoutKind: LayoutKind
  canvas: Pick<Canvas, 'items'>
  /** Live guests of the wedding. Ids missing here count as removed. */
  guests: readonly RuleGuest[]
  /** The wedding's stored rules; couple rules are added here. */
  rules: readonly Rule[]
}

export type ProblemReason = 'split' | 'notNextTo' | 'shared'

export type Problem = {
  ruleId: string
  kind: RuleKind
  couple: boolean
  /** split: together guests at more than one table. notNextTo: at one table, not side by side. shared: apart guests at one table. */
  reason: ProblemReason
  /** The seated guests involved. */
  guestIds: string[]
  /** The tables or rows involved, in canvas order. */
  itemIds: string[]
  /** The seats of the guests involved. */
  seats: SeatRef[]
  message: string
}

export type Unfinished = {
  ruleId: string
  couple: boolean
  /** Every live guest of the rule. */
  guestIds: string[]
  seatedGuestIds: string[]
  itemIds: string[]
  message: string
}

export type RuleWarning = {
  kind: 'declined'
  guestId: string
  itemId: string
  seatIndex: number
  message: string
}

/**
 * Where each rule stands in this layout: ok; a problem; unfinished (grey);
 * notSeated (none of its guests seated yet); hidden (a ceremony together
 * rule with fewer than two seated); needsGuests (fewer than two live guests,
 * not checked); off (disabled); otherLayout (applies to the other kind).
 */
export type RuleStatus = 'ok' | 'problem' | 'unfinished' | 'notSeated' | 'hidden' | 'needsGuests' | 'off' | 'otherLayout'

export type RulesResult = {
  /** Broken rules, one per rule, in rule order (stored rules, then couple rules). */
  problems: Problem[]
  unfinished: Unfinished[]
  warnings: RuleWarning[]
  status: Map<string, RuleStatus>
  problemsByItem: Map<string, Problem[]>
  /** Keyed by seatKey(itemId, seatIndex). */
  problemsBySeat: Map<string, Problem[]>
  problemsByGuest: Map<string, Problem[]>
}

export const COUPLE_RULE_PREFIX = 'couple:'

/** The id of the couple rule for two partners: the same whichever way round. */
export function coupleRuleId(a: string, b: string): string {
  return a < b ? `${COUPLE_RULE_PREFIX}${a}:${b}` : `${COUPLE_RULE_PREFIX}${b}:${a}`
}

export function isCoupleRuleId(id: string): boolean {
  return id.startsWith(COUPLE_RULE_PREFIX)
}

/** "t1#3": the key of a seat in problemsBySeat. */
export function seatKey(itemId: string, seatIndex: number): string {
  return `${itemId}#${seatIndex}`
}

/**
 * The couple rules (PLAN change 8): together and next to each other, both
 * layout kinds, for every pair of live guests linked to each other whose
 * couple rule switch is on for both. One rule per pair, in guest order.
 */
export function coupleRules(guests: readonly RuleGuest[]): Rule[] {
  const byId = new Map(guests.map((g) => [g.id, g]))
  const out: Rule[] = []
  for (const g of guests) {
    if (!g.partnerId || g.partnerId === g.id) continue
    const p = byId.get(g.partnerId)
    if (!p || p.partnerId !== g.id || !(g.id < p.id)) continue
    if (!g.coupleRuleEnabled || !p.coupleRuleEnabled) continue
    out.push({
      id: coupleRuleId(g.id, p.id),
      kind: 'together',
      guestIds: [g.id, p.id],
      nextToEachOther: true,
      appliesTo: 'both',
      enabled: true,
      couple: true,
    })
  }
  return out
}

/** The wedding's rules followed by its couple rules: what the rules list shows and what is checked. */
export function withCoupleRules(guests: readonly RuleGuest[], rules: readonly Rule[]): Rule[] {
  return [...rules, ...coupleRules(guests)]
}

/** True when a rule's appliesTo covers this layout kind (DECISIONS 13). */
export function appliesHere(appliesTo: AppliesTo, layoutKind: LayoutKind): boolean {
  return appliesTo === 'both' || appliesTo === layoutKind
}

/** True when two appliesTo values share a layout kind. */
export function appliesOverlap(a: AppliesTo, b: AppliesTo): boolean {
  return a === 'both' || b === 'both' || a === b
}

// ---------------------------------------------------------------- the seat index

type Placed = { item: SeatItem; order: number; seatIndex: number }

/** A table's or row's runs of seats: run number and place along it for each seat. */
type RunIndex = { runs: SeatRun[]; runOf: Int32Array; posOf: Int32Array }

class SeatIndex {
  readonly byGuest = new Map<string, Placed>()
  readonly items: SeatItem[] = []
  private readonly runCache = new Map<string, RunIndex>()

  constructor(canvas: Pick<Canvas, 'items'>) {
    for (const item of canvas.items) {
      if (!isSeatItem(item)) continue
      const order = this.items.length
      this.items.push(item)
      for (let i = 0; i < item.seats.length; i++) {
        const g = item.seats[i].guestId
        if (g !== null && !this.byGuest.has(g)) this.byGuest.set(g, { item, order, seatIndex: i })
      }
    }
  }

  runs(item: SeatItem): RunIndex {
    const cached = this.runCache.get(item.id)
    if (cached) return cached
    const n = item.seats.length
    // A chair row is one run, end to end; ceremony rows across the aisle are separate items.
    const runs: SeatRun[] =
      item.kind === 'chairRow'
        ? [{ seats: Array.from({ length: n }, (_, i) => i), wraps: false }]
        : seatRuns(item.seats.length === item.seatCount ? item : { ...item, seatCount: n })
    const runOf = new Int32Array(n).fill(-1)
    const posOf = new Int32Array(n).fill(-1)
    runs.forEach((run, r) =>
      run.seats.forEach((s, p) => {
        if (s < n) {
          runOf[s] = r
          posOf[s] = p
        }
      }),
    )
    const index = { runs, runOf, posOf }
    this.runCache.set(item.id, index)
    return index
  }
}

/**
 * True when these seats of one table lie in one run, within a stretch of
 * `size` seats: with everyone seated (size = count) they fill the stretch
 * with no gap; with some still to come, the rest could fill the gaps.
 */
function fitsInRun(index: SeatIndex, item: SeatItem, seats: readonly number[], size: number): boolean {
  if (seats.length <= 1) return true
  const { runs, runOf, posOf } = index.runs(item)
  const run = runOf[seats[0]]
  if (run < 0) return false
  const positions: number[] = []
  for (const s of seats) {
    if (runOf[s] !== run) return false
    positions.push(posOf[s])
  }
  positions.sort((a, b) => a - b)
  const n = runs[run].seats.length
  const last = positions.length - 1
  let span: number
  if (runs[run].wraps) {
    let maxGap = positions[0] + n - positions[last]
    for (let i = 0; i < last; i++) maxGap = Math.max(maxGap, positions[i + 1] - positions[i])
    span = n - maxGap + 1
  } else {
    span = positions[last] - positions[0] + 1
  }
  return span <= size
}

function unitWord(layoutKind: LayoutKind, n: number): string {
  if (layoutKind === 'ceremony') return n === 1 ? 'row' : 'rows'
  return n === 1 ? 'table' : 'tables'
}

function listLabels(labels: readonly string[]): string {
  if (labels.length <= 1) return labels[0] ?? ''
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
}

/** Live guests of a rule, each once, in the rule's order. */
function liveGuests(rule: Rule, live: ReadonlyMap<string, RuleGuest>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of rule.guestIds) {
    if (!seen.has(id) && live.has(id)) {
      seen.add(id)
      out.push(id)
    }
  }
  return out
}

// ---------------------------------------------------------------- checking

/** Every rule checked against one layout. */
export function evaluateRules(input: RulesInput): RulesResult {
  const { layoutKind } = input
  const live = new Map(input.guests.map((g) => [g.id, g]))
  const index = new SeatIndex(input.canvas)
  const result: RulesResult = {
    problems: [],
    unfinished: [],
    warnings: [],
    status: new Map(),
    problemsByItem: new Map(),
    problemsBySeat: new Map(),
    problemsByGuest: new Map(),
  }

  for (const rule of withCoupleRules(input.guests, input.rules)) {
    const status = checkRule(rule, layoutKind, live, index, result)
    result.status.set(rule.id, status)
  }

  for (const [guestId, placed] of index.byGuest) {
    if (live.get(guestId)?.rsvp !== 'no') continue
    result.warnings.push({
      kind: 'declined',
      guestId,
      itemId: placed.item.id,
      seatIndex: placed.seatIndex,
      message: 'Answered no, but has a seat',
    })
  }

  const add = <K>(map: Map<K, Problem[]>, key: K, p: Problem) => {
    const list = map.get(key)
    if (!list) map.set(key, [p])
    else if (list[list.length - 1] !== p) list.push(p)
  }
  for (const p of result.problems) {
    for (const id of p.itemIds) add(result.problemsByItem, id, p)
    for (const s of p.seats) add(result.problemsBySeat, seatKey(s.itemId, s.seatIndex), p)
    for (const g of p.guestIds) add(result.problemsByGuest, g, p)
  }
  return result
}

function checkRule(rule: Rule, layoutKind: LayoutKind, live: ReadonlyMap<string, RuleGuest>, index: SeatIndex, result: RulesResult): RuleStatus {
  if (!rule.enabled) return 'off'
  if (!appliesHere(rule.appliesTo, layoutKind)) return 'otherLayout'
  const ruleGuests = liveGuests(rule, live)
  if (ruleGuests.length < 2) return 'needsGuests'
  // A guest who answered no and has no seat will never be seated: the rule is checked without them.
  const guests = ruleGuests.filter((g) => index.byGuest.has(g) || live.get(g)?.rsvp !== 'no')

  const seated: { guestId: string; placed: Placed }[] = []
  for (const g of guests) {
    const placed = index.byGuest.get(g)
    if (placed) seated.push({ guestId: g, placed })
  }
  if (guests.length < 2) return seated.length === 0 ? 'notSeated' : 'ok'
  // Seated guests by table, tables in canvas order.
  const byItem = new Map<number, { guestId: string; placed: Placed }[]>()
  for (const s of seated) {
    const list = byItem.get(s.placed.order)
    if (list) list.push(s)
    else byItem.set(s.placed.order, [s])
  }
  const orders = [...byItem.keys()].sort((a, b) => a - b)
  const couple = rule.couple === true
  const problem = (reason: ProblemReason, who: { guestId: string; placed: Placed }[], items: number[], message: string): RuleStatus => {
    result.problems.push({
      ruleId: rule.id,
      kind: rule.kind,
      couple,
      reason,
      guestIds: who.map((s) => s.guestId),
      itemIds: items.map((o) => index.items[o].id),
      seats: who.map((s) => ({ itemId: s.placed.item.id, seatIndex: s.placed.seatIndex })),
      message,
    })
    return 'problem'
  }

  if (rule.kind === 'apart') {
    const shared = orders.filter((o) => byItem.get(o)!.length >= 2)
    if (shared.length === 0) return seated.length === 0 ? 'notSeated' : 'ok'
    const who = shared.flatMap((o) => byItem.get(o)!)
    return problem('shared', who, shared, `Should sit apart, but share ${listLabels(shared.map((o) => itemLabel(index.items[o])))}`)
  }

  if (seated.length === 0) return 'notSeated'
  if (layoutKind === 'ceremony' && seated.length < 2) return 'hidden'
  if (orders.length > 1) {
    const where = `${orders.length} ${unitWord(layoutKind, orders.length)}`
    return problem('split', seated, orders, couple ? `Partners split across ${where}` : `Split across ${where}`)
  }
  const item = index.items[orders[0]]
  if (
    rule.nextToEachOther &&
    !fitsInRun(
      index,
      item,
      seated.map((s) => s.placed.seatIndex),
      guests.length,
    )
  ) {
    const at = itemLabel(item)
    return problem('notNextTo', seated, orders, couple ? `Partners not next to each other at ${at}` : `Not next to each other at ${at}`)
  }
  if (seated.length < guests.length) {
    result.unfinished.push({
      ruleId: rule.id,
      couple,
      guestIds: guests,
      seatedGuestIds: seated.map((s) => s.guestId),
      itemIds: [item.id],
      message: `${seated.length} of ${guests.length} seated`,
    })
    return 'unfinished'
  }
  return 'ok'
}

// ---------------------------------------------------------------- clashes

export type Clash = {
  togetherRuleId: string
  apartRuleId: string
  /** The guests in both rules (two or more). */
  guestIds: string[]
}

/**
 * Together and apart rules that name two or more of the same guests, both
 * enabled, for overlapping layout kinds (PLAN change 16), for the Rules page.
 * Pass withCoupleRules(...) to include couple rules.
 */
export function clashes(rules: readonly Rule[]): Clash[] {
  const together = rules.filter((r) => r.enabled && r.kind === 'together')
  const apart = rules.filter((r) => r.enabled && r.kind === 'apart').map((r) => ({ rule: r, ids: new Set(r.guestIds) }))
  const out: Clash[] = []
  for (const t of together) {
    for (const a of apart) {
      if (!appliesOverlap(t.appliesTo, a.rule.appliesTo)) continue
      const shared = [...new Set(t.guestIds)].filter((id) => a.ids.has(id))
      if (shared.length >= 2) out.push({ togetherRuleId: t.id, apartRuleId: a.rule.id, guestIds: shared })
    }
  }
  return out
}

// ---------------------------------------------------------------- the drag tint

export type Tint = 'good' | 'bad' | 'none'
export type TintInput = RulesInput & { groups: readonly RuleGroup[] }

/**
 * How each table (or row) tints while `guestId` is dragged (spec section 4,
 * "Seating guests"): 'bad' when seating them there would break a rule that
 * applies here, else 'good' when their partner or someone from one of their
 * groups sits there, else 'none'. Every table and row of the canvas is in
 * the map. The guest's own seat counts as free, since they are moving.
 */
export function dragTint(input: TintInput, guestId: string): Map<string, Tint> {
  const index = new SeatIndex(input.canvas)
  const live = new Map(input.guests.map((g) => [g.id, g]))
  const out = new Map<string, Tint>()
  for (const item of index.items) out.set(item.id, 'none')

  const at = (id: string): Placed | undefined => (id === guestId ? undefined : index.byGuest.get(id))
  const good = new Set<string>()
  const partner = live.get(guestId)?.partnerId
  if (partner) {
    const p = at(partner)
    if (p) good.add(p.item.id)
  }
  for (const group of input.groups) {
    if (!group.memberIds.includes(guestId)) continue
    for (const m of group.memberIds) {
      if (!live.has(m)) continue
      const p = at(m)
      if (p) good.add(p.item.id)
    }
  }

  const bad = new Set<string>()
  for (const rule of withCoupleRules(input.guests, input.rules)) {
    if (!rule.enabled || !appliesHere(rule.appliesTo, input.layoutKind)) continue
    // As in checkRule: a guest who answered no and has no seat does not count (the dragged guest always does).
    const guests = liveGuests(rule, live).filter((g) => g === guestId || index.byGuest.has(g) || live.get(g)?.rsvp !== 'no')
    if (guests.length < 2 || !guests.includes(guestId)) continue
    const others: Placed[] = []
    for (const g of guests) {
      const p = at(g)
      if (p) others.push(p)
    }
    if (others.length === 0) continue
    if (rule.kind === 'apart') {
      for (const p of others) bad.add(p.item.id)
      continue
    }
    const tables = new Set(others.map((p) => p.item.id))
    for (const item of index.items) if (!tables.has(item.id)) bad.add(item.id)
    if (tables.size !== 1 || !rule.nextToEachOther) continue
    // One table: is there a seat there (free, or held by someone outside the rule, who would swap) beside them?
    const item = others[0].item
    const held = new Set(others.map((p) => p.seatIndex))
    const seats = [...held]
    let fits = false
    for (let s = 0; s < item.seats.length && !fits; s++) {
      if (held.has(s)) continue
      fits = fitsInRun(index, item, [...seats, s], guests.length)
    }
    if (!fits) bad.add(item.id)
  }

  for (const id of good) out.set(id, 'good')
  for (const id of bad) out.set(id, 'bad')
  return out
}
