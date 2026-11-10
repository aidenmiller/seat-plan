/**
 * The editor's Problems list (spec section 4 and section 7, "Rules"; PLAN
 * changes 16 and 18; DECISIONS 12, 14 and 15). One list, worked out on every
 * change from the layout, the guests, the rules and the venue's walls:
 *
 *  - Problems: broken rules (from evaluateRules, with their tables and
 *    seats) and tables a venue wall runs through. These make the top bar
 *    count ("3 seating problems").
 *  - Warnings: tight tables (with the reason), pairs of tables closer than
 *    the wedding's minimum gap, and seated guests who answered no. They show
 *    under their own heading and never add to the count.
 *
 * Each entry has an id that stays the same while the cause does (so the list
 * can keep its place and the UI can key on it), a short title and message,
 * where "pan to it" goes, and the tables and seats to badge.
 *
 * Pure apart from a cache of wall indexes keyed by the venue's fixed item
 * array, so a template's walls are indexed once, not on every change.
 */
import type { Table } from './canvas-schema'
import type { Point } from './geometry'
import { fullName } from './guest-list'
import { itemLabel } from './item-labels'
import { evaluateRules, seatKey, type RuleGuest, type RulesInput, type RulesResult } from './rules'
import { isSeatItem, seatCenters, type SeatItem, type SeatRef } from './seating'
import { isTight, tightReason } from './seats'
import { DEFAULT_MIN_GAP_CM, narrowGaps } from './spacing'
import { formatLength, type LengthUnit } from './units'
import type { FixedItem } from './venue-schema'
import { buildWallIndex, tableWallHits, type WallIndex } from './walls'

/** A guest as the Problems list reads it: what the rules need, plus a name. */
export type ProblemsGuest = RuleGuest & { firstName: string; lastName: string }

export type ProblemsInput = Omit<RulesInput, 'guests'> & {
  guests: readonly ProblemsGuest[]
  unit: LengthUnit
  /** The wedding's minimum gap between table edges, cm. Default 5 ft. */
  minGapCm?: number
  /** The venue template's fixed items, or an index built from them. None on a blank canvas. */
  walls?: readonly FixedItem[] | WallIndex
  /** evaluateRules() of this same input, when the caller already has it. */
  rulesResult?: RulesResult
}

export type Severity = 'problem' | 'warning'
export type EditorProblemKind = 'rule' | 'wall' | 'tight' | 'gap' | 'declined'

export type EditorProblem = {
  /** rule:<ruleId>, wall:<tableId>, tight:<tableId>, gap:<tableId>|<tableId>, declined:<guestId> */
  id: string
  kind: EditorProblemKind
  severity: Severity
  /** Who or what: "Jane Doe and Tom Doe", "Table 4", "Table 2 and Table 5". */
  title: string
  /** What is wrong: "Partners split across 2 tables", "Crosses a wall". */
  message: string
  /** Where a click pans: the items to show, and the point to center on. */
  panTo: { itemIds: string[]; point: Point }
  /** The tables (or rows) and seats that carry a badge for it. */
  badge: { itemIds: string[]; seats: SeatRef[] }
  /** The broken rule, for kind 'rule'. */
  ruleId: string | null
  /** The guests involved (rule problems and declined guests). */
  guestIds: string[]
}

export type ProblemList = {
  /** Broken rules in rule order, then wall crossings in canvas order. */
  problems: EditorProblem[]
  /** Tight tables in canvas order, then narrow gaps (narrowest first), then declined guests. */
  warnings: EditorProblem[]
  /** The top bar count: broken rules plus tables a wall runs through (PLAN change 16). */
  problemCount: number
  warningCount: number
  /** Every entry (problems and warnings) that badges this table or row. */
  byItem: Map<string, EditorProblem[]>
  /** Every entry that badges this seat, keyed by seatKey(itemId, seatIndex). */
  bySeat: Map<string, EditorProblem[]>
  /** The rules check the list was built from, for the seat card and the Rules page. */
  rules: RulesResult
}

/** "3 seating problems", "1 seating problem", "No seating problems". */
export function problemCountText(count: number): string {
  if (count === 0) return 'No seating problems'
  return count === 1 ? '1 seating problem' : `${count} seating problems`
}

/** "problem" when any entry is a problem, "warning" when all are warnings, null for none. */
export function worstSeverity(entries: readonly EditorProblem[] | undefined): Severity | null {
  if (!entries || entries.length === 0) return null
  return entries.some((e) => e.severity === 'problem') ? 'problem' : 'warning'
}

// ---------------------------------------------------------------- walls

const wallIndexCache = new WeakMap<readonly FixedItem[], WallIndex>()

function isWallIndex(walls: readonly FixedItem[] | WallIndex): walls is WallIndex {
  return !Array.isArray(walls)
}

/** The wall index for a venue's fixed items, built once per array. */
export function wallIndexFor(walls: readonly FixedItem[] | WallIndex): WallIndex {
  if (isWallIndex(walls)) return walls
  let index = wallIndexCache.get(walls)
  if (!index) {
    index = buildWallIndex(walls)
    wallIndexCache.set(walls, index)
  }
  return index
}

// ---------------------------------------------------------------- wording

/** "Jane Doe", "Jane Doe and Tom Doe", "Jane Doe, Tom Doe and Ann Lee", "Jane Doe, Tom Doe and 3 more". */
export function namesText(names: readonly string[]): string {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  if (names.length <= 3) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`
}

/** "3′ 2″ apart, under the 5′ 0″ minimum", or "Overlapping". */
export function gapMessage(gapCm: number, minGapCm: number, unit: LengthUnit): string {
  if (gapCm <= 0) return 'Overlapping'
  return `${formatLength(gapCm, unit)} apart, under the ${formatLength(minGapCm, unit)} minimum`
}

export const WALL_MESSAGE = 'Crosses a wall'
export const DECLINED_MESSAGE = 'Answered no, but has a seat'

// ---------------------------------------------------------------- the list

function middle(points: readonly Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
}

/** Every rule problem, wall crossing and warning in one layout. */
export function layoutProblems(input: ProblemsInput): ProblemList {
  const { unit } = input
  const minGapCm = input.minGapCm ?? DEFAULT_MIN_GAP_CM
  const rules = input.rulesResult ?? evaluateRules(input)
  const names = new Map(input.guests.map((g) => [g.id, fullName(g)]))
  const byId = new Map<string, SeatItem>()
  const tables: Table[] = []
  for (const item of input.canvas.items) {
    if (!isSeatItem(item)) continue
    byId.set(item.id, item)
    if (item.kind === 'table') tables.push(item)
  }
  const centerOf = (ids: readonly string[]): Point =>
    middle(ids.flatMap((id) => {
      const item = byId.get(id)
      return item ? [{ x: item.x, y: item.y }] : []
    }))
  const labelOf = (id: string): string => {
    const item = byId.get(id)
    return item ? itemLabel(item) : 'A table'
  }

  const problems: EditorProblem[] = []
  for (const p of rules.problems) {
    const who = p.guestIds.flatMap((g) => {
      const n = names.get(g)
      return n === undefined ? [] : [n]
    })
    problems.push({
      id: `rule:${p.ruleId}`,
      kind: 'rule',
      severity: 'problem',
      title: namesText(who) || (p.couple ? 'Couple' : 'Rule'),
      message: p.message,
      panTo: { itemIds: [...p.itemIds], point: centerOf(p.itemIds) },
      badge: { itemIds: [...p.itemIds], seats: p.seats.map((s) => ({ ...s })) },
      ruleId: p.ruleId,
      guestIds: [...p.guestIds],
    })
  }

  if (input.walls) {
    const index = wallIndexFor(input.walls)
    if (index.segments.length > 0) {
      for (const t of tables) {
        if (tableWallHits(t, index).length === 0) continue
        problems.push({
          id: `wall:${t.id}`,
          kind: 'wall',
          severity: 'problem',
          title: itemLabel(t),
          message: WALL_MESSAGE,
          panTo: { itemIds: [t.id], point: { x: t.x, y: t.y } },
          badge: { itemIds: [t.id], seats: [] },
          ruleId: null,
          guestIds: [],
        })
      }
    }
  }

  const warnings: EditorProblem[] = []
  for (const t of tables) {
    if (!isTight(t)) continue
    const reason = tightReason(t, unit)
    warnings.push({
      id: `tight:${t.id}`,
      kind: 'tight',
      severity: 'warning',
      title: itemLabel(t),
      message: reason ? `Tight: ${reason}` : 'Tight',
      panTo: { itemIds: [t.id], point: { x: t.x, y: t.y } },
      badge: { itemIds: [t.id], seats: [] },
      ruleId: null,
      guestIds: [],
    })
  }

  for (const g of narrowGaps({ items: tables }, minGapCm)) {
    const [a, b] = g.aId < g.bId ? [g.aId, g.bId] : [g.bId, g.aId]
    warnings.push({
      id: `gap:${a}|${b}`,
      kind: 'gap',
      severity: 'warning',
      title: `${labelOf(g.aId)} and ${labelOf(g.bId)}`,
      message: gapMessage(g.gapCm, minGapCm, unit),
      panTo: { itemIds: [g.aId, g.bId], point: { x: (g.from.x + g.to.x) / 2, y: (g.from.y + g.to.y) / 2 } },
      badge: { itemIds: [g.aId, g.bId], seats: [] },
      ruleId: null,
      guestIds: [],
    })
  }

  for (const w of rules.warnings) {
    const item = byId.get(w.itemId)
    const seat = item ? seatCenters(item)[w.seatIndex] : undefined
    warnings.push({
      id: `declined:${w.guestId}`,
      kind: 'declined',
      severity: 'warning',
      title: names.get(w.guestId) ?? 'A guest',
      message: `${DECLINED_MESSAGE} at ${labelOf(w.itemId)}`,
      panTo: { itemIds: [w.itemId], point: seat ? { x: seat.x, y: seat.y } : centerOf([w.itemId]) },
      badge: { itemIds: [w.itemId], seats: [{ itemId: w.itemId, seatIndex: w.seatIndex }] },
      ruleId: null,
      guestIds: [w.guestId],
    })
  }

  const byItem = new Map<string, EditorProblem[]>()
  const bySeat = new Map<string, EditorProblem[]>()
  const add = (map: Map<string, EditorProblem[]>, key: string, e: EditorProblem) => {
    const list = map.get(key)
    if (!list) map.set(key, [e])
    else if (list[list.length - 1] !== e) list.push(e)
  }
  for (const e of [...problems, ...warnings]) {
    for (const id of e.badge.itemIds) add(byItem, id, e)
    for (const s of e.badge.seats) add(bySeat, seatKey(s.itemId, s.seatIndex), e)
  }

  return { problems, warnings, problemCount: problems.length, warningCount: warnings.length, byItem, bySeat, rules }
}
