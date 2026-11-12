/**
 * Seats at a table (PLAN section 6, "Tables and seats"; DECISIONS 4 to 11).
 *
 * Seat positions are never stored. They come from the table's shape, size,
 * seat count and sides, so moving or resizing a table can never leave seats
 * behind. The canvas stores only who sits in each numbered seat.
 *
 * Frames: a table's own frame has x to the right and y down, with the table's
 * center at the origin. The back edge is the top (local -y): one-sided tables
 * seat along it, facing +y (DECISIONS 5). World positions turn that frame by
 * the table's rotation (degrees, clockwise) and move it to the table's x, y.
 *
 * Seat order runs clockwise. Round tables start at the top. Square and rect
 * tables start at the left end of the top side; each side runs clockwise
 * (top left to right, right side top to bottom, bottom right to left, left
 * side bottom to top).
 *
 * This module has no runtime import from geometry.ts, which imports it.
 */
import { MAX_SEATS_RECT, MAX_SEATS_ROUND_OR_SQUARE, type Seat, type Table } from './canvas-schema'
import type { Point } from './geometry'
import { CM_PER_INCH, formatLength, type LengthUnit } from './units'

/** Seat circles are 45 cm across and sit 8 cm out from the table edge (DECISIONS 4). */
export const SEAT_DIAMETER_CM = 45
export const SEAT_RADIUS_CM = SEAT_DIAMETER_CM / 2
export const SEAT_GAP_CM = 8
/** From the table edge to a seat's center. */
export const SEAT_CENTER_OUT_CM = SEAT_GAP_CM + SEAT_RADIUS_CM
/** From the table edge to the outer edge of the chairs: the chair ring. */
export const CHAIR_DEPTH_CM = SEAT_GAP_CM + SEAT_DIAMETER_CM
/** 22 in of edge per seat on round tables (PLAN change 4). */
export const ROUND_EDGE_PER_SEAT_CM = 55.88
/** 24 in of edge per seat on straight edges (spec, PLAN change 4). */
export const STRAIGHT_EDGE_PER_SEAT_CM = 60.96
/** Lengths within half a centimeter of the rule still count as fitting (PLAN change 4). */
export const EDGE_ALLOWANCE_CM = 0.5
/** Seat colors at every zoom (spec section 4, "Seats"): the brand's seat-filled and seat-empty (globals.css). */
export const SEAT_TAKEN_COLOR = '#1e3a8a'
export const SEAT_EMPTY_COLOR = '#7b879a'

export type TableSide = 'top' | 'right' | 'bottom' | 'left'
export type SeatSide = 'round' | TableSide
export type SideCounts = Record<TableSide, number>

/** What seat placement reads from a table. */
export type SeatGeometry = Pick<Table, 'shape' | 'width' | 'height' | 'seatCount' | 'seatSides' | 'fewerSeatsSide'>
/** A table with its place on the canvas. */
export type PlacedSeatGeometry = SeatGeometry & Pick<Table, 'x' | 'y' | 'rotation'>
/** A table with the guests in its seats. */
export type SeatedGeometry = SeatGeometry & Pick<Table, 'seats'>

export type SeatPlace = {
  index: number
  /** Center of the seat circle, in cm (world, or the table's frame for seatLocalLayout). */
  x: number
  y: number
  /** The direction the seated person faces the table: degrees, clockwise, 0 along +x, 90 along +y. */
  angle: number
  side: SeatSide
  /** The seat's place on its side, from 0, in seat order. Round tables: the seat index. */
  slot: number
}

/** Clockwise, for seat order. */
const SIDES_CLOCKWISE: readonly TableSide[] = ['top', 'right', 'bottom', 'left']
/** Ties for a new seat go to the first side here, so 2 seats on a square face each other. */
const SIDES_TIE_ORDER: readonly TableSide[] = ['top', 'bottom', 'right', 'left']
/** The direction a person on each side faces the table, in the table's frame. */
const FACING: Record<TableSide, number> = { top: 90, right: 180, bottom: 270, left: 0 }
const EPS = 1e-9

export function maxSeats(shape: Table['shape']): number {
  return shape === 'rect' ? MAX_SEATS_RECT : MAX_SEATS_ROUND_OR_SQUARE
}

export function minEdgePerSeatCm(shape: Table['shape']): number {
  return shape === 'round' ? ROUND_EDGE_PER_SEAT_CM : STRAIGHT_EDGE_PER_SEAT_CM
}

export function emptySeats(count: number): Seat[] {
  return Array.from({ length: Math.max(0, count) }, (_, index) => ({ index, guestId: null }))
}

export function sideLength(table: Pick<Table, 'width' | 'height'>, side: TableSide): number {
  return side === 'top' || side === 'bottom' ? table.width : table.height
}

/**
 * The sides that take seats, in tie order. Round tables have none.
 * 'noEnds' seats the two long sides (top and bottom on a square);
 * 'oneSide' seats the back (top) edge only.
 */
export function seatedSides(table: Pick<Table, 'shape' | 'width' | 'height' | 'seatSides'>): TableSide[] {
  if (table.shape === 'round') return []
  if (table.seatSides === 'oneSide') return ['top']
  if (table.seatSides === 'noEnds') return table.height > table.width + EPS ? ['right', 'left'] : ['top', 'bottom']
  return [...SIDES_TIE_ORDER]
}

/** The seats one straight edge holds at 24 in each, with the 0.5 cm allowance. */
export function sideCapacity(lengthCm: number): number {
  if (!(lengthCm > 0)) return 0
  return Math.floor((lengthCm + EDGE_ALLOWANCE_CM) / STRAIGHT_EDGE_PER_SEAT_CM + EPS)
}

/** Seats each seated side holds under the 24 in rule. Sides without seats show 0. */
export function sideCapacities(table: Pick<Table, 'shape' | 'width' | 'height' | 'seatSides'>): SideCounts {
  const caps: SideCounts = { top: 0, right: 0, bottom: 0, left: 0 }
  for (const side of seatedSides(table)) caps[side] = sideCapacity(sideLength(table, side))
  return caps
}

/**
 * How many seats go on each side of a square or rect table (DECISIONS 8 and 9).
 * Seats are shared by length: each seat in turn goes to the side where it gets
 * the most edge, ties going to top, bottom, right, then left, except that the
 * table's fewerSeatsSide (set by −) takes its turn last. So one more seat
 * always lands on the side with the most spare edge, one fewer always comes off
 * the most crowded side, and whenever the sides can hold every seat at 24 in
 * each, they do. Round tables give all zeros.
 */
export function sideSeatCounts(table: Pick<Table, 'shape' | 'width' | 'height' | 'seatSides' | 'seatCount' | 'fewerSeatsSide'>): SideCounts {
  const counts: SideCounts = { top: 0, right: 0, bottom: 0, left: 0 }
  const seated = seatedSides(table)
  if (seated.length === 0) return counts
  const last = table.fewerSeatsSide
  const sides = last !== undefined && seated.includes(last) ? [...seated.filter((side) => side !== last), last] : seated
  const usable = sides.map((side) => sideLength(table, side) + EDGE_ALLOWANCE_CM)
  for (let k = 0; k < table.seatCount; k++) {
    let best = 0
    let bestEdge = -Infinity
    sides.forEach((side, i) => {
      const edge = usable[i] / (counts[side] + 1)
      if (edge > bestEdge + EPS) {
        best = i
        bestEdge = edge
      }
    })
    counts[sides[best]]++
  }
  return counts
}

/** True when a round table seats side by side on the back arc: 2 seats, or one-sided (DECISIONS 6). */
export function isBackArc(table: Pick<Table, 'shape' | 'seatCount' | 'seatSides'>): boolean {
  return table.shape === 'round' && (table.seatCount === 2 || table.seatSides === 'oneSide')
}

/** Angles (radians, clockwise from straight up) of the seats around a round table. */
function roundSeatAngles(table: SeatGeometry): number[] {
  const n = table.seatCount
  if (n <= 0) return []
  if (isBackArc(table)) {
    const step = Math.min(ROUND_EDGE_PER_SEAT_CM / (table.width / 2), (2 * Math.PI) / n)
    return Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * step)
  }
  return Array.from({ length: n }, (_, i) => (2 * Math.PI * i) / n)
}

type SideSlot = { side: TableSide; slot: number; count: number }

/** Each seat's side and its place on that side, in seat order. */
function straightSlots(table: SeatGeometry): SideSlot[] {
  const counts = sideSeatCounts(table)
  const slots: SideSlot[] = []
  for (const side of SIDES_CLOCKWISE) {
    for (let slot = 0; slot < counts[side]; slot++) slots.push({ side, slot, count: counts[side] })
  }
  return slots
}

/** The share of the way along a side, from where its seat order starts. */
function along(slot: number, count: number): number {
  return (slot + 0.5) / count
}

function normalizeDegrees(degrees: number): number {
  const d = degrees % 360
  const r = d < 0 ? d + 360 : d
  return Math.abs(r - 360) < 1e-9 || Math.abs(r) < 1e-9 ? 0 : r
}

/** A point `out` cm outside a w by h table's side, the share `f` of the way along it in seat order. */
function sidePoint(w: number, h: number, side: TableSide, f: number, out: number): Point {
  switch (side) {
    case 'top':
      return { x: -w / 2 + f * w, y: -h / 2 - out }
    case 'right':
      return { x: w / 2 + out, y: -h / 2 + f * h }
    case 'bottom':
      return { x: w / 2 - f * w, y: h / 2 + out }
    case 'left':
      return { x: -w / 2 - out, y: h / 2 - f * h }
  }
}

/** Seats in the table's own frame (before its rotation and position). */
export function seatLocalLayout(table: SeatGeometry): SeatPlace[] {
  if (table.seatCount <= 0) return []
  if (table.shape === 'round') {
    const r = table.width / 2 + SEAT_CENTER_OUT_CM
    return roundSeatAngles(table).map((a, index) => {
      const x = r * Math.sin(a)
      const y = -r * Math.cos(a)
      return { index, x, y, angle: normalizeDegrees((Math.atan2(-y, -x) * 180) / Math.PI), side: 'round', slot: index }
    })
  }
  return straightSlots(table).map(({ side, slot, count }, index) => {
    const p = sidePoint(table.width, table.height, side, along(slot, count), SEAT_CENTER_OUT_CM)
    return { index, x: p.x, y: p.y, angle: FACING[side], side, slot }
  })
}

/** Seat centers in the table's own frame, in seat order. */
export function seatLocalPositions(table: SeatGeometry): Point[] {
  return seatLocalLayout(table).map(({ x, y }) => ({ x, y }))
}

function turn(p: Point, degrees: number): Point {
  if (degrees === 0) return { x: p.x, y: p.y }
  const r = (degrees * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }
}

/** Seats on the canvas: world centers in cm and the way each person faces. */
export function seatLayout(table: PlacedSeatGeometry): SeatPlace[] {
  return seatLocalLayout(table).map((seat) => {
    const p = turn(seat, table.rotation)
    return { ...seat, x: table.x + p.x, y: table.y + p.y, angle: normalizeDegrees(seat.angle + table.rotation) }
  })
}

/** The seat whose circle holds a world point (plus `tolerance` cm), nearest first, or null. */
export function seatIndexAt(table: PlacedSeatGeometry, point: Point, tolerance = 0): number | null {
  const local = turn({ x: point.x - table.x, y: point.y - table.y }, -table.rotation)
  let best: number | null = null
  let bestDistance = SEAT_RADIUS_CM + tolerance
  for (const seat of seatLocalLayout(table)) {
    const d = Math.hypot(local.x - seat.x, local.y - seat.y)
    if (d <= bestDistance) {
      best = seat.index
      bestDistance = d
    }
  }
  return best
}

/** The edge seats can use: the circumference of a round table, or the seated sides of a straight one. */
export function seatEdgeCm(table: Pick<Table, 'shape' | 'width' | 'height' | 'seatSides'>): number {
  if (table.shape === 'round') return Math.PI * table.width
  return seatedSides(table).reduce((sum, side) => sum + sideLength(table, side), 0)
}

/**
 * The edge the most crowded seat gets: circumference over seats on a round
 * table, the tightest seated side on a straight one. Null with no seats.
 */
export function edgePerSeatCm(table: SeatGeometry): number | null {
  if (table.seatCount <= 0) return null
  if (table.shape === 'round') return (Math.PI * table.width) / table.seatCount
  const counts = sideSeatCounts(table)
  let least = Infinity
  for (const side of SIDES_CLOCKWISE) {
    if (counts[side] > 0) least = Math.min(least, sideLength(table, side) / counts[side])
  }
  return least
}

/** The most seats a round table holds at 22 in each, before the seat cap. */
function roundCapacity(widthCm: number): number {
  return Math.floor((Math.PI * widthCm + EDGE_ALLOWANCE_CM) / ROUND_EDGE_PER_SEAT_CM + EPS)
}

/**
 * The seat count Fit seats picks: the most seats the size holds at 22 in each
 * (round) or 24 in each (straight edges), at least 1 and at most the table's
 * seat cap (DECISIONS 11).
 */
export function fitSeatCount(table: Pick<Table, 'shape' | 'width' | 'height' | 'seatSides'>): number {
  let fit: number
  if (table.shape === 'round') fit = roundCapacity(table.width)
  else {
    const caps = sideCapacities(table)
    fit = caps.top + caps.right + caps.bottom + caps.left
  }
  return Math.min(maxSeats(table.shape), Math.max(1, fit))
}

type Tightness =
  | { kind: 'total'; seats: number; needCm: number; haveCm: number; perSeatCm: number }
  | { kind: 'side'; side: TableSide; seats: number; needCm: number; haveCm: number; perSeatCm: number }

function tightness(table: SeatGeometry): Tightness | null {
  const n = table.seatCount
  if (n <= 0) return null
  const perSeatCm = minEdgePerSeatCm(table.shape)
  const haveCm = seatEdgeCm(table)
  const needCm = n * perSeatCm
  if (table.shape === 'round') {
    return n > roundCapacity(table.width) ? { kind: 'total', seats: n, needCm, haveCm, perSeatCm } : null
  }
  // A table is tight when some side holds more seats than it has edge for.
  // The whole table's numbers read best, so they are used whenever they
  // show the problem too.
  const counts = sideSeatCounts(table)
  const side = SIDES_CLOCKWISE.find((s) => counts[s] > sideCapacity(sideLength(table, s)))
  if (side === undefined) return null
  if (needCm > haveCm + EDGE_ALLOWANCE_CM + EPS) return { kind: 'total', seats: n, needCm, haveCm, perSeatCm }
  const seats = counts[side]
  return { kind: 'side', side, seats, needCm: seats * perSeatCm, haveCm: sideLength(table, side), perSeatCm }
}

/** True when some seat gets less edge than the rule: 22 in on round tables, 24 in on straight edges. */
export function isTight(table: SeatGeometry): boolean {
  return tightness(table) !== null
}

function seatsWord(n: number): string {
  return n === 1 ? '1 seat needs' : `${n} seats need`
}

/**
 * Why a table is outlined in yellow, for the properties panel, or null when
 * it is not tight. For example "9 seats need 16′ 6″ of edge at 22″ each; this
 * table has 15′ 8″".
 */
export function tightReason(table: SeatGeometry, unit: LengthUnit): string | null {
  const t = tightness(table)
  if (!t) return null
  const need = formatLength(t.needCm, unit)
  // 22″ and 24″ read better than 1′ 10″ and 2′ 0″.
  const each = unit === 'ft' ? `${Math.round(t.perSeatCm / CM_PER_INCH)}″` : formatLength(t.perSeatCm, unit)
  const have = formatLength(t.haveCm, unit)
  if (t.kind === 'total') return `${seatsWord(t.seats)} ${need} of edge at ${each} each; this table has ${have}`
  return `${seatsWord(t.seats)} ${need} of edge at ${each} each on one side; that side has ${have}`
}

export type SeatRun = {
  /** Seat indexes in order along the run. */
  seats: number[]
  /** The last seat sits next to the first. */
  wraps: boolean
}

/**
 * Unbroken runs of seats (PLAN change 15). Round tables seated all the way
 * round and square or rect tables seated on all sides make one run that
 * wraps, across corners too. Seats on a round table's back arc make one run
 * that does not wrap. A no-ends table makes one run per long side, so the
 * seats facing each other across an end are not neighbors. A one-sided table
 * is one run.
 */
export function seatRuns(table: SeatGeometry): SeatRun[] {
  const n = table.seatCount
  if (n <= 0) return []
  const all = Array.from({ length: n }, (_, i) => i)
  if (table.shape === 'round') return [{ seats: all, wraps: !isBackArc(table) && n >= 3 }]
  if (table.seatSides === 'all') return [{ seats: all, wraps: n >= 3 }]
  if (table.seatSides === 'oneSide') return [{ seats: all, wraps: false }]
  const runs = new Map<TableSide, number[]>()
  straightSlots(table).forEach(({ side }, index) => {
    const run = runs.get(side)
    if (run) run.push(index)
    else runs.set(side, [index])
  })
  return [...runs.values()].map((seats) => ({ seats, wraps: false }))
}

/** For each seat index, the seats right next to it, in ascending order. */
export function neighbors(table: SeatGeometry): number[][] {
  const result: Set<number>[] = Array.from({ length: Math.max(0, table.seatCount) }, () => new Set<number>())
  for (const run of seatRuns(table)) {
    const s = run.seats
    for (let i = 0; i + 1 < s.length; i++) {
      result[s[i]].add(s[i + 1])
      result[s[i + 1]].add(s[i])
    }
    if (run.wraps && s.length >= 3) {
      result[s[0]].add(s[s.length - 1])
      result[s[s.length - 1]].add(s[0])
    }
  }
  return result.map((set) => [...set].sort((a, b) => a - b))
}

/** A seat as remapping sees it: its place scaled to the table, and its side. */
type MapSeat = { p: Point; side: SeatSide }

/**
 * Seat positions scaled to the table, for matching seats across a change:
 * round seats on the unit circle, straight-edge seats on the square from -1
 * to 1. Stretching a table leaves these unchanged, so seats keep their place.
 */
function mapSeats(table: SeatGeometry): MapSeat[] {
  if (table.seatCount <= 0) return []
  if (table.shape === 'round') return roundSeatAngles(table).map((a) => ({ p: { x: Math.sin(a), y: -Math.cos(a) }, side: 'round' }))
  return straightSlots(table).map(({ side, slot, count }) => ({ p: sidePoint(2, 2, side, along(slot, count), 0), side }))
}

/** True when the seats go all the way round: every table but one-sided ones and a round table's back arc. */
function seatsLoop(table: SeatGeometry): boolean {
  if (table.shape === 'round') return !isBackArc(table)
  return table.seatSides !== 'oneSide'
}

/**
 * True when the seats run the same way before and after: the same kind of
 * table seated on the same sides (a count or size change). Then each run
 * keeps its guests and only re-spaces them.
 */
function sameRuns(a: SeatGeometry, b: SeatGeometry): boolean {
  if ((a.shape === 'round') !== (b.shape === 'round')) return false
  if (a.shape === 'round') return isBackArc(a) === isBackArc(b)
  return a.seatSides === b.seatSides && seatedSides(a).join() === seatedSides(b).join()
}

/** Two layouts that put seat i in the same place relative to the table, for every i. */
function layoutSignature(table: SeatGeometry): string {
  if (table.shape === 'round') return `round:${table.seatCount}:${isBackArc(table) ? 'arc' : 'ring'}`
  const c = sideSeatCounts(table)
  return `straight:${c.top},${c.right},${c.bottom},${c.left}`
}

/** Added to a move that takes a guest across a no-ends table, more than any move along a side (at most 2√2). */
const SIDE_CHANGE_COST = 10
const COST_EPSILON = 1e-9

type OrderProblem = {
  /** Guests in the order they must keep. */
  guests: number[]
  /** New seats in order; guests take increasing places in this list. */
  seats: number[]
  /** The first guest must take the first seat (the seats loop, and this is where the loop is cut). */
  pinFirst: boolean
}

function rotation(length: number, start: number): number[] {
  return Array.from({ length }, (_, i) => (start + i) % length)
}

/**
 * The least, over every order-keeping placement in the problem, of its
 * largest move. Guest i can only take places i to n - m + i (the guests
 * before and after it need theirs), so a nearly full table is quick.
 */
function bottleneck(problem: OrderProblem, cost: readonly Float64Array[]): number {
  const { guests, seats, pinFirst } = problem
  const m = guests.length
  const n = seats.length
  const slack = n - m
  let prev = new Float64Array(n)
  let cur = new Float64Array(n)
  for (let p = 0; p <= slack; p++) prev[p] = pinFirst && p > 0 ? Infinity : cost[guests[0]][seats[p]]
  for (let i = 1; i < m; i++) {
    const row = cost[guests[i]]
    let before = Infinity
    for (let p = i; p <= slack + i; p++) {
      if (prev[p - 1] < before) before = prev[p - 1]
      cur[p] = before === Infinity ? Infinity : Math.max(before, row[seats[p]])
    }
    const done = cur
    cur = prev
    prev = done
  }
  let best = Infinity
  for (let p = m - 1; p <= slack + m - 1; p++) if (prev[p] < best) best = prev[p]
  return best
}

/** The order-keeping placement with no move over `limit` and the least total move, or null. */
function cheapest(problem: OrderProblem, cost: readonly Float64Array[], limit: number): { total: number; places: number[] } | null {
  const { guests, seats, pinFirst } = problem
  const m = guests.length
  const n = seats.length
  const slack = n - m
  // Row i holds guest i at places i to slack + i; nothing else is read.
  const totals = new Float64Array(m * n)
  const back = new Int32Array(m * n)
  for (let p = 0; p <= slack; p++) {
    const c = cost[guests[0]][seats[p]]
    totals[p] = (pinFirst && p > 0) || c > limit ? Infinity : c
    back[p] = -1
  }
  for (let i = 1; i < m; i++) {
    const row = cost[guests[i]]
    const prevAt = (i - 1) * n
    const at = i * n
    let before = Infinity
    let beforeAt = -1
    for (let p = i; p <= slack + i; p++) {
      if (totals[prevAt + p - 1] < before - COST_EPSILON) {
        before = totals[prevAt + p - 1]
        beforeAt = p - 1
      }
      const c = row[seats[p]]
      const ok = beforeAt >= 0 && c <= limit
      totals[at + p] = ok ? before + c : Infinity
      back[at + p] = ok ? beforeAt : -1
    }
  }
  const lastAt = (m - 1) * n
  let end = -1
  for (let p = m - 1; p <= slack + m - 1; p++) {
    if (totals[lastAt + p] < (end < 0 ? Infinity : totals[lastAt + end]) - COST_EPSILON) end = p
  }
  if (end < 0) return null
  const places = new Array<number>(m)
  for (let i = m - 1, p = end; i >= 0; i--) {
    places[guests[i]] = seats[p]
    p = back[i * n + p]
  }
  return { total: totals[lastAt + end], places }
}

/**
 * New seats for guests, keeping their order: round the loop when the new
 * seats go all the way round, else along the line (cutting the old loop
 * where it moves people least). With `smallestLargest`, of every such
 * placement it takes the one whose largest move is smallest, then the one
 * with the least total move; without, just the least total move (when the
 * table's sides or shape changed, some guests must move far anyway, and the
 * rest should not shift to make that move shorter). `cost[g][s]` is how far
 * guest g moves to new seat s; guests are in seat order. Returns each
 * guest's new seat.
 */
function keepOrder(cost: readonly Float64Array[], newCount: number, guestsLoop: boolean, seatsLoopNow: boolean, smallestLargest: boolean): number[] {
  const m = cost.length
  const problems: OrderProblem[] = []
  if (seatsLoopNow) for (let s = 0; s < newCount; s++) problems.push({ guests: rotation(m, 0), seats: rotation(newCount, s), pinFirst: true })
  else if (guestsLoop) for (let r = 0; r < m; r++) problems.push({ guests: rotation(m, r), seats: rotation(newCount, 0), pinFirst: false })
  else problems.push({ guests: rotation(m, 0), seats: rotation(newCount, 0), pinFirst: false })

  const worst = problems.map((problem) => (smallestLargest ? bottleneck(problem, cost) : 0))
  const limit = smallestLargest ? Math.min(...worst) + COST_EPSILON : Infinity
  let best: { total: number; places: number[] } | null = null
  problems.forEach((problem, i) => {
    if (worst[i] > limit) return
    const found = cheapest(problem, cost, limit)
    if (found && (!best || found.total < best.total - COST_EPSILON)) best = found
  })
  // There is always a placement (newCount >= m), so best is set.
  return (best as { total: number; places: number[] } | null)?.places ?? rotation(m, 0)
}

export type SeatPlan = {
  /** The seats to store on the changed table: length is its seat count, indexes run 0..n-1. */
  canvasSeats: Seat[]
  /** Guests who no longer have a seat, highest seat numbers first. */
  unseated: string[]
}

function seatWith(index: number, from: Seat | undefined): Seat {
  if (!from || from.guestId === null) return { index, guestId: null }
  return from.pinned === undefined ? { index, guestId: from.guestId } : { index, guestId: from.guestId, pinned: from.pinned }
}

/**
 * Seats for a table whose count, size, shape or sides changed (DECISIONS 9
 * and 10). Guests keep their seat order: round the ring of a round table or
 * the loop round a table seated on all sides, along each long side of a
 * no-ends table, along the one side of a one-sided table. Empty seats come
 * out of the order or go into it wherever that moves people least: when the
 * runs stay the same (a count or size change), of every placement that keeps
 * the order, the one whose largest move is smallest, then the least total
 * move; when the sides or shape change, the least total move. So neighbors
 * stay neighbors and nobody jumps across the table; on a no-ends table a
 * guest changes sides only when their side has too few seats left. When
 * there are more guests than new seats, the guests in the highest seat
 * numbers lose their seats first.
 */
export function remapSeats(oldTable: SeatedGeometry, newTable: SeatGeometry): SeatPlan {
  const newCount = Math.max(0, newTable.seatCount)
  const taken: { from: number; seat: Seat }[] = []
  oldTable.seats.forEach((seat, i) => {
    if (seat.guestId !== null) taken.push({ from: i, seat })
  })
  if (taken.length === 0) return { canvasSeats: emptySeats(newCount), unseated: [] }

  if (oldTable.seatCount === oldTable.seats.length && layoutSignature(oldTable) === layoutSignature(newTable)) {
    return { canvasSeats: Array.from({ length: newCount }, (_, i) => seatWith(i, oldTable.seats[i])), unseated: [] }
  }

  const keep = taken.slice(0, newCount)
  const unseated = taken
    .slice(newCount)
    .reverse()
    .map((t) => t.seat.guestId as string)
  const canvasSeats = emptySeats(newCount)
  if (keep.length === 0) return { canvasSeats, unseated }

  const oldSeats = mapSeats(oldTable)
  const newSeats = mapSeats(newTable)
  // A no-ends table's two sides are separate runs: crossing between them costs extra.
  const runs: readonly SeatSide[] = newTable.shape !== 'round' && newTable.seatSides === 'noEnds' ? seatedSides(newTable) : []
  const cost = keep.map((t) => {
    const from = oldSeats[t.from] ?? { p: { x: 0, y: 0 }, side: 'round' as const }
    const row = new Float64Array(newCount)
    newSeats.forEach((to, s) => {
      const crosses = runs.includes(from.side) && from.side !== to.side
      row[s] = Math.hypot(from.p.x - to.p.x, from.p.y - to.p.y) + (crosses ? SIDE_CHANGE_COST : 0)
    })
    return row
  })
  const places = keepOrder(cost, newCount, seatsLoop(oldTable), seatsLoop(newTable), sameRuns(oldTable, newTable))
  keep.forEach((t, g) => {
    canvasSeats[places[g]] = seatWith(places[g], t.seat)
  })
  return { canvasSeats, unseated }
}

export type TableSeatPlan<T> = SeatPlan & { table: T }

/**
 * The table with a new seat count, guests kept near their places. A count
 * below the number of guests unseats those in the highest seat numbers, who
 * the dialog names before anything changes (DECISIONS 10). The count is kept
 * between 0 and the table's seat cap.
 */
export function setSeatCount<T extends Table>(table: T, count: number): TableSeatPlan<T> {
  const seatCount = Math.max(0, Math.min(maxSeats(table.shape), Math.floor(count)))
  const plan = remapSeats(table, { ...table, seatCount })
  return { ...plan, table: { ...table, seatCount, seats: plan.canvasSeats } }
}

/** Each side of a square or rect table that has an empty seat. */
function sidesWithEmptySeat(table: Table): Set<TableSide> {
  const out = new Set<TableSide>()
  straightSlots(table).forEach(({ side }, i) => {
    if (table.seats[i]?.guestId === null) out.add(side)
  })
  return out
}

/** The side that has one seat fewer after the change, if any. */
function sideThatLost(before: SideCounts, after: SideCounts): TableSide | null {
  return SIDES_CLOCKWISE.find((side) => after[side] < before[side]) ?? null
}

/**
 * What lowering the seat count would do (− by default). Empty seats go
 * first: nobody loses a seat while an empty one is left, and the seat taken
 * away comes off the most crowded side, the rest keeping their order (see
 * remapSeats). For one seat fewer on a square or rect table, when the side
 * the share rule would shorten has no empty seat but another side as crowded
 * has one, that side gives up the seat instead (the table remembers it as
 * fewerSeatsSide), so nobody has to change sides. Past the empty seats, the
 * guests in the highest seat numbers are unseated.
 */
export function removeSeatPlan<T extends Table>(table: T, newCount: number = table.seatCount - 1): TableSeatPlan<T> {
  const plain = setSeatCount(table, newCount)
  if (table.shape === 'round' || plain.table.seatCount !== table.seatCount - 1 || table.seats.length !== table.seatCount) return plain
  const empty = sidesWithEmptySeat(table)
  const before = sideSeatCounts(table)
  const lost = sideThatLost(before, sideSeatCounts(plain.table))
  if (lost === null || empty.has(lost) || empty.size === 0) return plain
  // Most crowded first: the least edge per seat, ties in the usual order.
  const crowded = [...SIDES_TIE_ORDER]
    .filter((side) => before[side] > 0)
    .sort((a, b) => sideLength(table, a) / before[a] - sideLength(table, b) / before[b])
  for (const side of crowded) {
    if (!empty.has(side)) continue
    const next = { ...table, seatCount: plain.table.seatCount, fewerSeatsSide: side }
    // Only that side may change, by the one seat.
    const after = sideSeatCounts(next)
    if (!SIDES_CLOCKWISE.every((s) => after[s] === before[s] - (s === side ? 1 : 0))) continue
    const plan = remapSeats(table, next)
    return { ...plan, table: { ...next, seats: plan.canvasSeats } }
  }
  return plain
}

export function canAddSeat(table: Pick<Table, 'shape' | 'seatCount'>): boolean {
  return table.seatCount < maxSeats(table.shape)
}

/** The side + would add a seat to: the side with the most spare edge, or 'round'. Null at the seat cap. */
export function addSeatSide(table: SeatGeometry): SeatSide | null {
  if (!canAddSeat(table)) return null
  if (table.shape === 'round') return 'round'
  const before = sideSeatCounts(table)
  const after = sideSeatCounts({ ...table, seatCount: table.seatCount + 1 })
  return SIDES_CLOCKWISE.find((side) => after[side] > before[side]) ?? null
}

/** The table with one more seat (on the side with the most spare edge), or the same table at the seat cap. */
export function addSeat<T extends Table>(table: T): T {
  if (!canAddSeat(table)) return table
  return setSeatCount(table, table.seatCount + 1).table
}

/** What Fit seats would do: the count the size holds, guests kept near their places. */
export function fitSeatsPlan<T extends Table>(table: T): TableSeatPlan<T> {
  return setSeatCount(table, fitSeatCount(table))
}

/** The lowest-numbered empty seat, or null when the table is full. */
export function firstFreeSeat(table: Pick<Table, 'seats'>): number | null {
  const i = table.seats.findIndex((s) => s.guestId === null)
  return i === -1 ? null : i
}

export function seatedCount(table: Pick<Table, 'seats'>): number {
  let n = 0
  for (const s of table.seats) if (s.guestId !== null) n++
  return n
}
