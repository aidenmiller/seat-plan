/**
 * Closeness scores (spec section 7, "Closeness score"; PLAN section 7,
 * "Groups and closeness", change 19). For each group in one layout:
 *
 *  - Seated: members holding a seat in this layout (seated by name). The
 *    "of N" leaves out members who answered no and have no seat; a member
 *    who answered no but still has a seat counts, as in the rules
 *    (DECISIONS 12 and 80), so seated is never more than N.
 *  - Unseated: the other counted members, in the group's order.
 *  - Tables used: the tables (or chair rows, in ceremony layouts) they sit at.
 *  - Fewest possible: the layout's largest tables by seat count, filled in
 *    order until there are seats for every seated member. One-sided tables
 *    and tables of 2 seats or fewer (head and sweetheart tables) are left
 *    out, and only used when the rest cannot hold them. Never more than the
 *    tables used, since those already hold everyone.
 *  - Tightness: fewest possible over tables used. 100% means they could not
 *    sit any closer.
 *  - Spread: the average distance between table centers over every pair of
 *    seated members, 0 for two at one table. Worked out from the count at
 *    each table, not pair by pair.
 *
 * With one member seated there are no pairs, so tightness and spread are
 * null (a dash). With none seated the line is only "0 of 12 seated", and the
 * group sorts last. Pure.
 */
import type { Canvas } from './canvas-schema'
import { compareText } from './guest-list'
import type { LayoutKind, Rsvp } from './rules'
import { isSeatItem, type SeatItem } from './seating'
import { CM_PER_FOOT, type LengthUnit } from './units'

/** What closeness reads from a guest. Ids missing here count as removed. */
export type ClosenessGuest = { id: string; rsvp: Rsvp }

/** What closeness reads from a group. */
export type ClosenessGroup = { id: string; name: string; memberIds: readonly string[] }

export type ClosenessInput = {
  layoutKind: LayoutKind
  canvas: Pick<Canvas, 'items'>
  /** Live guests of the wedding. */
  guests: readonly ClosenessGuest[]
  groups: readonly ClosenessGroup[]
}

export type GroupCloseness = {
  groupId: string
  name: string
  /** The N of "11 of 12 seated": live members, less those who answered no and have no seat. */
  counted: number
  /** Seated members, in the group's order. */
  seatedIds: string[]
  /** Counted members without a seat in this layout, in the group's order. */
  unseatedIds: string[]
  /** The tables or rows the seated members sit at, in canvas order. */
  itemIds: string[]
  tablesUsed: number
  /** 0 with nobody seated. */
  fewestPossible: number
  /** fewestPossible / tablesUsed, 0 to 1. Null with fewer than two seated. */
  tightness: number | null
  /** cm. Null with fewer than two seated. */
  spreadCm: number | null
}

/** What fewest possible fills: seat counts, largest first, the left-out tables after the rest. */
type Fill = { prefix: number[] }

/** Head and sweetheart tables: left out of fewest possible (PLAN change 19). */
export function leftOutOfFill(item: SeatItem): boolean {
  return item.kind === 'table' && (item.seatSides === 'oneSide' || item.seats.length <= 2)
}

function buildFill(items: readonly SeatItem[]): Fill {
  const main: number[] = []
  const rest: number[] = []
  for (const item of items) {
    const n = item.seats.length
    if (n <= 0) continue
    if (leftOutOfFill(item)) rest.push(n)
    else main.push(n)
  }
  main.sort((a, b) => b - a)
  rest.sort((a, b) => b - a)
  const prefix: number[] = []
  let sum = 0
  for (const n of [...main, ...rest]) {
    sum += n
    prefix.push(sum)
  }
  return { prefix }
}

/** How many tables the fill takes to seat `people`: the first prefix sum that reaches it. */
function fillCount(fill: Fill, people: number): number {
  if (people <= 0) return 0
  const { prefix } = fill
  let lo = 0
  let hi = prefix.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (prefix[mid] >= people) hi = mid
    else lo = mid + 1
  }
  // More people than seats cannot happen for seated guests; all tables is the honest answer.
  return Math.min(lo + 1, prefix.length)
}

/**
 * The average distance between table centers over every pair of people, 0
 * for two at one table, from the count at each table: the sum over pairs of
 * tables of countA * countB * distance, over n(n - 1)/2 pairs of people.
 */
export function spreadFromCounts(tables: readonly { x: number; y: number; count: number }[]): number | null {
  let n = 0
  for (const t of tables) n += t.count
  if (n < 2) return null
  let sum = 0
  for (let i = 0; i < tables.length; i++) {
    const a = tables[i]
    for (let j = i + 1; j < tables.length; j++) {
      const b = tables[j]
      const dx = a.x - b.x
      const dy = a.y - b.y
      sum += a.count * b.count * Math.sqrt(dx * dx + dy * dy)
    }
  }
  return sum / ((n * (n - 1)) / 2)
}

/** The guest's seat item, by canvas order: the first seat only, as the rules read it. */
function seatOrderByGuest(items: readonly SeatItem[]): Map<string, number> {
  const out = new Map<string, number>()
  items.forEach((item, order) => {
    for (const seat of item.seats) {
      if (seat.guestId !== null && !out.has(seat.guestId)) out.set(seat.guestId, order)
    }
  })
  return out
}

function scoreGroup(
  group: ClosenessGroup,
  live: ReadonlyMap<string, ClosenessGuest>,
  items: readonly SeatItem[],
  orderOf: ReadonlyMap<string, number>,
  fill: Fill,
): GroupCloseness {
  const seen = new Set<string>()
  const seatedIds: string[] = []
  const unseatedIds: string[] = []
  const counts = new Map<number, number>()
  for (const id of group.memberIds) {
    if (seen.has(id)) continue
    seen.add(id)
    const guest = live.get(id)
    if (!guest) continue
    const order = orderOf.get(id)
    if (order === undefined) {
      if (guest.rsvp !== 'no') unseatedIds.push(id)
      continue
    }
    seatedIds.push(id)
    counts.set(order, (counts.get(order) ?? 0) + 1)
  }
  const orders = [...counts.keys()].sort((a, b) => a - b)
  const tablesUsed = orders.length
  const seated = seatedIds.length
  const fewestPossible = Math.min(fillCount(fill, seated), tablesUsed)
  const spreadCm =
    seated < 2
      ? null
      : spreadFromCounts(
          orders.map((o) => ({ x: items[o].x, y: items[o].y, count: counts.get(o)! })),
        )
  return {
    groupId: group.id,
    name: group.name,
    counted: seated + unseatedIds.length,
    seatedIds,
    unseatedIds,
    itemIds: orders.map((o) => items[o].id),
    tablesUsed,
    fewestPossible,
    tightness: seated < 2 ? null : fewestPossible / tablesUsed,
    spreadCm,
  }
}

/** Measured groups first, loosest first; then groups with one seated; then none seated. */
function rank(c: GroupCloseness): number {
  if (c.seatedIds.length === 0) return 2
  return c.tightness === null ? 1 : 0
}

/**
 * Loosest first (spec: "Sort the Groups tab loosest first"): lowest
 * tightness, then largest spread. Groups with one seated member come after
 * the measured ones, and groups with nobody seated last. Ties go by name.
 */
export function compareLoosestFirst(a: GroupCloseness, b: GroupCloseness): number {
  return (
    rank(a) - rank(b) ||
    (a.tightness ?? 0) - (b.tightness ?? 0) ||
    (b.spreadCm ?? 0) - (a.spreadCm ?? 0) ||
    compareText(a.name, b.name) ||
    (a.groupId < b.groupId ? -1 : a.groupId > b.groupId ? 1 : 0)
  )
}

/** Every group's closeness in this layout, loosest first. */
export function closenessScores(input: ClosenessInput): GroupCloseness[] {
  const items = input.canvas.items.filter(isSeatItem)
  const live = new Map(input.guests.map((g) => [g.id, g]))
  const orderOf = seatOrderByGuest(items)
  const fill = buildFill(items)
  return input.groups.map((g) => scoreGroup(g, live, items, orderOf, fill)).sort(compareLoosestFirst)
}

// ---------------------------------------------------------------- wording

/** Shown where a number needs two seated members. */
export const NO_SCORE = '–'

export type ClosenessPartKey = 'seated' | 'tables' | 'tight' | 'spread'
export type ClosenessPart = { key: ClosenessPartKey; text: string; tooltip: string }
export type ClosenessText = {
  /** "Aiden HS Friends · 11 of 12 seated · 3 tables (2 possible) · 67% tight · 9 ft spread" */
  line: string
  /** The numbers after the name, each with its tooltip. */
  parts: ClosenessPart[]
}

/** "67%". Anything short of 100% shows as at most 99%, so 100% always means as close as can be. */
export function tightnessText(tightness: number | null): string {
  if (tightness === null) return NO_SCORE
  const pct = Math.round(tightness * 100)
  return `${tightness < 1 ? Math.min(pct, 99) : pct}%`
}

/** "9 ft" (whole feet) or "2.7 m" (one decimal); an average needs no inches. */
export function spreadText(spreadCm: number | null, unit: LengthUnit): string {
  if (spreadCm === null) return NO_SCORE
  if (unit === 'm') {
    const tenths = Math.round(spreadCm / 10)
    if (tenths === 0 && spreadCm > 0) return 'under 0.1 m'
    return `${tenths % 10 === 0 ? tenths / 10 : (tenths / 10).toFixed(1)} m`
  }
  const feet = Math.round(spreadCm / CM_PER_FOOT)
  if (feet === 0 && spreadCm > 0) return 'under 1 ft'
  return `${feet} ft`
}

function unitWords(layoutKind: LayoutKind) {
  return layoutKind === 'ceremony'
    ? { one: 'row', many: 'rows', at: 'in', largest: 'longest rows', same: 'the same row', centers: 'row centers' }
    : { one: 'table', many: 'tables', at: 'at', largest: 'largest tables', same: 'the same table', centers: 'table centers' }
}

const NEEDS_TWO = 'Needs at least two guests from this group seated.'
const DECLINED_NOTE = 'Guests who answered no and have no seat are left out.'

/** The closeness line and a plain tooltip for each number. */
export function closenessText(c: GroupCloseness, unit: LengthUnit, layoutKind: LayoutKind): ClosenessText {
  const w = unitWords(layoutKind)
  const seated = c.seatedIds.length
  const parts: ClosenessPart[] = []

  let seatedTip: string
  if (c.counted === 0) seatedTip = 'No one in this group is coming or still to answer.'
  else if (seated === c.counted) seatedTip = `Everyone in this group has a seat. ${DECLINED_NOTE}`
  else seatedTip = `${seated} of the ${c.counted} guests in this group have a seat. ${DECLINED_NOTE}`
  parts.push({ key: 'seated', text: `${seated} of ${c.counted} seated`, tooltip: seatedTip })

  if (seated > 0) {
    const used = `${c.tablesUsed} ${c.tablesUsed === 1 ? w.one : w.many}`
    const leftOut = layoutKind === 'ceremony' ? '' : ' Head and sweetheart tables are left out.'
    const tablesTip =
      seated === 1
        ? 'Only one guest from this group is seated.'
        : `They sit ${w.at} ${used}. Filling the ${w.largest} first, ${c.fewestPossible} ${c.fewestPossible === 1 ? w.one : w.many} would hold them.${leftOut}`
    parts.push({ key: 'tables', text: `${used} (${c.fewestPossible} possible)`, tooltip: tablesTip })

    parts.push({
      key: 'tight',
      text: `${tightnessText(c.tightness)} tight`,
      tooltip:
        c.tightness === null
          ? NEEDS_TWO
          : `${c.fewestPossible} ${c.fewestPossible === 1 ? w.one : w.many} possible out of ${used} used. 100% means they could not sit any closer.`,
    })

    parts.push({
      key: 'spread',
      text: `${spreadText(c.spreadCm, unit)} spread`,
      tooltip:
        c.spreadCm === null
          ? NEEDS_TWO
          : `On average, two guests in this group sit ${spreadText(c.spreadCm, unit)} apart, measured between ${w.centers}. Two at ${w.same} count as 0.`,
    })
  }

  return { line: [c.name, ...parts.map((p) => p.text)].join(' · '), parts }
}
