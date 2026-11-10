/**
 * Picks the PDF lines that may be walls and tidies them before they go to the
 * model with an id each (PLAN change 21, section 7 "Floor plan import").
 *
 * Wall candidates (thresholds are relative to the page, since the drawing's
 * scale is not known yet):
 *  1. When the PDF has CAD layers, layers named like walls are kept and
 *     layers named like dimensions, text, hatching or furniture are dropped.
 *  2. Segments shorter than 1% of the page diagonal are dropped: hatching,
 *     ticks, arrow heads, exploded CAD text.
 *  3. Walls use the heaviest pen: lines thinner than 1.5 times the median
 *     path width (and 0.75 pt) are dropped. When that would leave almost
 *     nothing (every line drawn with one pen, or walls drawn as two thin
 *     lines) no line is dropped for its width.
 *  4. Long thin filled polygons (solid walls) come in as their centre lines.
 *  Curves never get here: pdf-vectors keeps them apart as door swing hints.
 *
 * Cleanup, in pixels:
 *  a. lines within 1 degree of level or plumb are made exactly so;
 *  b. end points within a few pixels are joined (axis lines stay straight);
 *  c. collinear pieces that overlap are merged, and touching ones too when
 *     both are thick walls of about the same thickness. Gaps are never
 *     bridged, so a door opening stays open;
 *  d. what is still short is dropped.
 * At most about 1,500 lines are kept (the longest and thickest first), and
 * each gets a stable id in reading order: s1, s2, ...
 */
import type { Point } from '../geometry'
import type { CurveHint, PageVectors, VectorSegment } from './pdf-vectors'

/** The most lines sent to the model. */
export const SEGMENT_CAP = 1500

/** A cleaned line, in image pixels, with the id the model answers with. */
export type CleanSegment = {
  id: string
  x1: number
  y1: number
  x2: number
  y2: number
  /** Stroke width or solid wall thickness in pixels; 0 for a hairline. */
  thickness: number
  source: 'stroke' | 'fill'
}

/** A line before it has an id. */
export type RawSegment = Omit<CleanSegment, 'id'>

export type CandidateOptions = {
  /** Shorter segments are dropped. Default: 1% of the page diagonal. */
  minLength?: number
  /** Thinner strokes are dropped. Default: max(1.5 x median path width, 0.75 pt). */
  minWidth?: number
  layerKeep?: RegExp
  layerDrop?: RegExp
}

export type CandidateResult = {
  candidates: VectorSegment[]
  thresholds: { minLength: number; minWidth: number; medianWidth: number; widthFilter: boolean }
  dropped: { layer: number; short: number; thin: number }
}

const DEFAULT_LAYER_KEEP = /wall|a-wall|mur|partition/i
const DEFAULT_LAYER_DROP = /dim|anno|text|hatch|furn|grid|title|symb/i
/** The heaviest pen must hold at least this share of the long lines' length to count as the walls. */
const MIN_THICK_SHARE = 0.1

function segLength(s: { x1: number; y1: number; x2: number; y2: number }): number {
  return Math.hypot(s.x2 - s.x1, s.y2 - s.y1)
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/** Step 1 to 4 of the file comment. */
export function pickWallCandidates(page: Pick<PageVectors, 'width' | 'height' | 'pxPerPt' | 'segments'>, options: CandidateOptions = {}): CandidateResult {
  const minLength = options.minLength ?? 0.01 * Math.hypot(page.width, page.height)
  const keep = options.layerKeep ?? DEFAULT_LAYER_KEEP
  const drop = options.layerDrop ?? DEFAULT_LAYER_DROP

  const dropped = { layer: 0, short: 0, thin: 0 }
  const kept: VectorSegment[] = []
  for (const s of page.segments) {
    if (s.layer && drop.test(s.layer) && !keep.test(s.layer)) dropped.layer++
    else kept.push(s)
  }
  const pathWidths = new Map<number, number>()
  for (const s of kept) if (s.source === 'stroke') pathWidths.set(s.path, s.width)
  const medianWidth = median([...pathWidths.values()])
  const minWidth = options.minWidth ?? Math.max(medianWidth * 1.5, 0.75 * page.pxPerPt)

  const long: { s: VectorSegment; layerWall: boolean }[] = []
  for (const s of kept) {
    if (segLength(s) < minLength) {
      dropped.short++
      continue
    }
    long.push({ s, layerWall: s.layer !== null && keep.test(s.layer) })
  }

  let total = 0
  let thick = 0
  for (const { s, layerWall } of long) {
    const len = segLength(s)
    total += len
    if (s.source === 'fill' || layerWall || s.width >= minWidth) thick += len
  }
  const widthFilter = thick > 0 && thick >= MIN_THICK_SHARE * total
  const candidates: VectorSegment[] = []
  for (const { s, layerWall } of long) {
    if (widthFilter && s.source === 'stroke' && !layerWall && s.width < minWidth) {
      dropped.thin++
      continue
    }
    candidates.push(s)
  }
  return { candidates, thresholds: { minLength, minWidth, medianWidth, widthFilter }, dropped }
}

export type CleanupOptions = {
  /** End points closer than this are joined, and parallel lines closer than this are one line. Pixels. */
  snapTol: number
  /** Lines this close to level or plumb are made exactly so. Degrees. Default 1. */
  angleTolDeg?: number
  /** Collinear pieces with a gap this small may merge. Pixels; far below any door. */
  mergeGap: number
  /** Shorter results are dropped. Pixels. */
  minLength: number
  /** Touching pieces merge only when both are at least this thick. Default: never. */
  thickMin?: number
}

/** a. Lines within the tolerance of level or plumb become exactly level or plumb. */
export function snapAngles<T extends RawSegment>(segs: readonly T[], angleTolDeg = 1): T[] {
  const tol = Math.sin((angleTolDeg * Math.PI) / 180)
  return segs.map((g) => {
    const len = segLength(g)
    if (len === 0) return { ...g }
    const sin = Math.abs(g.y2 - g.y1) / len
    const cos = Math.abs(g.x2 - g.x1) / len
    if (sin <= tol) {
      const y = (g.y1 + g.y2) / 2
      return { ...g, y1: y, y2: y }
    }
    if (cos <= tol) {
      const x = (g.x1 + g.x2) / 2
      return { ...g, x1: x, x2: x }
    }
    return { ...g }
  })
}

/**
 * b. Joins end points within `tol`. Each cluster is seeded by its first
 * point and takes only points within `tol` of the seed, so a chain of close
 * points never drags far. A cluster's x comes from its plumb lines when it
 * has any, and its y from its level lines, so those stay exact.
 */
export function joinEndpoints<T extends RawSegment>(segs: readonly T[], tol: number): T[] {
  const out = segs.map((g) => ({ ...g }))
  if (tol <= 0) return out
  type End = { seg: number; end: 1 | 2; x: number; y: number }
  const ends: End[] = []
  out.forEach((g, i) => {
    ends.push({ seg: i, end: 1, x: g.x1, y: g.y1 })
    ends.push({ seg: i, end: 2, x: g.x2, y: g.y2 })
  })
  const grid = new Map<string, number[]>()
  const cellKey = (cx: number, cy: number) => `${cx},${cy}`
  const seeds: { x: number; y: number; members: End[] }[] = []
  for (const e of ends) {
    const cx = Math.floor(e.x / tol)
    const cy = Math.floor(e.y / tol)
    let best = -1
    let bestD = Infinity
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const k of grid.get(cellKey(cx + dx, cy + dy)) ?? []) {
          const d = Math.hypot(seeds[k].x - e.x, seeds[k].y - e.y)
          if (d <= tol && d < bestD) {
            best = k
            bestD = d
          }
        }
      }
    }
    if (best >= 0) {
      seeds[best].members.push(e)
    } else {
      seeds.push({ x: e.x, y: e.y, members: [e] })
      const key = cellKey(cx, cy)
      const list = grid.get(key)
      if (list) list.push(seeds.length - 1)
      else grid.set(key, [seeds.length - 1])
    }
  }
  for (const seed of seeds) {
    if (seed.members.length < 2) continue
    let sx = 0
    let sy = 0
    let vx = 0
    let nv = 0
    let hy = 0
    let nh = 0
    for (const m of seed.members) {
      sx += m.x
      sy += m.y
      const g = out[m.seg]
      if (g.x1 === g.x2 && g.y1 !== g.y2) {
        vx += m.x
        nv++
      }
      if (g.y1 === g.y2 && g.x1 !== g.x2) {
        hy += m.y
        nh++
      }
    }
    const x = nv > 0 ? vx / nv : sx / seed.members.length
    const y = nh > 0 ? hy / nh : sy / seed.members.length
    for (const m of seed.members) {
      const g = out[m.seg]
      const vertical = g.x1 === g.x2 && g.y1 !== g.y2
      const horizontal = g.y1 === g.y2 && g.x1 !== g.x2
      // Keep axis lines exact: a plumb line keeps its x, a level line its y.
      const nx = vertical ? g.x1 : x
      const ny = horizontal ? g.y1 : y
      if (m.end === 1) {
        g.x1 = nx
        g.y1 = ny
      } else {
        g.x2 = nx
        g.y2 = ny
      }
    }
  }
  return out
}

/** Direction in degrees, 0 to 180. */
function direction(g: RawSegment): number {
  let a = (Math.atan2(g.y2 - g.y1, g.x2 - g.x1) * 180) / Math.PI
  if (a < 0) a += 180
  if (a >= 180) a -= 180
  return a
}

/**
 * c. Merges collinear pieces: grouped by direction (within half a degree),
 * then by offset across that direction (within `snapTol`), then joined along
 * it where they overlap, or touch within `mergeGap` when both are at least
 * `thickMin` thick and within 25% of each other's thickness.
 */
export function mergeCollinear(segs: readonly RawSegment[], snapTol: number, mergeGap: number, thickMin = Infinity): RawSegment[] {
  const items = segs.filter((g) => segLength(g) > 0).map((g) => ({ g, a: direction(g) }))
  items.sort((p, q) => p.a - q.a)
  // Group directions; the last group may wrap round to the first (179.9 and 0.1 degrees).
  const groups: (typeof items)[] = []
  for (const it of items) {
    const last = groups[groups.length - 1]
    if (last && it.a - last[0].a <= 0.5) last.push(it)
    else groups.push([it])
  }
  if (groups.length > 1) {
    const first = groups[0]
    const last = groups[groups.length - 1]
    if (first[0].a + 180 - last[0].a <= 0.5) {
      for (const it of first) last.push({ g: it.g, a: it.a + 180 })
      groups.shift()
    }
  }
  const out: RawSegment[] = []
  for (const group of groups) {
    let sum = 0
    let weight = 0
    for (const it of group) {
      const len = segLength(it.g)
      sum += it.a * len
      weight += len
    }
    const angle = ((sum / weight) * Math.PI) / 180
    const ux = Math.cos(angle)
    const uy = Math.sin(angle)
    // Exact axes: keep the cos and sin exact so level and plumb lines come back exact.
    const exactX = Math.abs(uy) < 1e-12 ? 1 : Math.abs(ux) < 1e-12 ? 0 : ux
    const exactY = Math.abs(uy) < 1e-12 ? 0 : Math.abs(ux) < 1e-12 ? 1 : uy
    const nx = -exactY
    const ny = exactX
    const lines = group.map(({ g }) => {
      let t1 = g.x1 * exactX + g.y1 * exactY
      let t2 = g.x2 * exactX + g.y2 * exactY
      if (t1 > t2) [t1, t2] = [t2, t1]
      return { t1, t2, off: g.x1 * nx + g.y1 * ny, thickness: g.thickness, source: g.source }
    })
    lines.sort((p, q) => p.off - q.off)
    let i = 0
    while (i < lines.length) {
      let j = i
      while (j + 1 < lines.length && lines[j + 1].off - lines[i].off <= snapTol) j++
      const band = lines.slice(i, j + 1).sort((p, q) => p.t1 - q.t1)
      i = j + 1
      type Run = { t1: number; t2: number; offSum: number; w: number; thickness: number; source: 'stroke' | 'fill' }
      let cur: Run | null = null
      const flush = () => {
        if (!cur) return
        const off = cur.offSum / cur.w
        out.push({
          x1: cur.t1 * exactX + off * nx,
          y1: cur.t1 * exactY + off * ny,
          x2: cur.t2 * exactX + off * nx,
          y2: cur.t2 * exactY + off * ny,
          thickness: cur.thickness,
          source: cur.source,
        })
      }
      for (const it of band) {
        const len = it.t2 - it.t1
        if (cur) {
          const overlaps = it.t1 < cur.t2 - 1e-9
          const similar = Math.min(it.thickness, cur.thickness) >= thickMin && Math.abs(it.thickness - cur.thickness) <= 0.25 * Math.max(it.thickness, cur.thickness)
          const touches = it.t1 <= cur.t2 + mergeGap && similar
          if (overlaps || touches) {
            cur.t2 = Math.max(cur.t2, it.t2)
            cur.offSum += it.off * len
            cur.w += len
            cur.thickness = Math.max(cur.thickness, it.thickness)
            if (it.source === 'fill') cur.source = 'fill'
            continue
          }
          flush()
        }
        cur = { t1: it.t1, t2: it.t2, offSum: it.off * Math.max(len, 1e-9), w: Math.max(len, 1e-9), thickness: it.thickness, source: it.source }
      }
      flush()
    }
  }
  return out
}

/** Steps a to d of the file comment. */
export function cleanupSegments(segs: readonly RawSegment[], options: CleanupOptions): RawSegment[] {
  const straight = snapAngles(segs, options.angleTolDeg ?? 1)
  const joined = joinEndpoints(straight, options.snapTol)
  const merged = mergeCollinear(joined, options.snapTol, options.mergeGap, options.thickMin)
  return merged.filter((g) => segLength(g) >= options.minLength)
}

/** Keeps the `cap` lines that matter most: long and thick first. */
export function capSegments<T extends RawSegment>(segs: readonly T[], cap = SEGMENT_CAP): T[] {
  if (segs.length <= cap) return [...segs]
  const scored = segs.map((g, i) => ({ g, i, score: segLength(g) * Math.max(g.thickness, 1) }))
  scored.sort((p, q) => q.score - p.score || p.i - q.i)
  return scored
    .slice(0, cap)
    .sort((p, q) => p.i - q.i)
    .map((s) => s.g)
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

/**
 * Gives each line an id in reading order (top to bottom, then left to
 * right), so the same page always gives the same ids. Each line runs left to
 * right (or top to bottom when plumb); coordinates are rounded to 0.01 px.
 */
export function assignSegmentIds(segs: readonly RawSegment[]): CleanSegment[] {
  const normal = segs.map((g) => {
    const flip = g.x1 > g.x2 || (g.x1 === g.x2 && g.y1 > g.y2)
    return flip ? { ...g, x1: g.x2, y1: g.y2, x2: g.x1, y2: g.y1 } : { ...g }
  })
  normal.sort(
    (p, q) =>
      Math.round(Math.min(p.y1, p.y2)) - Math.round(Math.min(q.y1, q.y2)) ||
      Math.round(p.x1) - Math.round(q.x1) ||
      Math.round(Math.max(p.y1, p.y2)) - Math.round(Math.max(q.y1, q.y2)) ||
      Math.round(p.x2) - Math.round(q.x2) ||
      p.y1 - q.y1 ||
      p.x1 - q.x1 ||
      p.thickness - q.thickness,
  )
  return normal.map((g, i) => ({
    id: `s${i + 1}`,
    x1: round2(g.x1),
    y1: round2(g.y1),
    x2: round2(g.x2),
    y2: round2(g.y2),
    thickness: round2(g.thickness),
    source: g.source,
  }))
}

export type WallSegmentsResult = {
  segments: CleanSegment[]
  candidates: number
  dropped: CandidateResult['dropped'] & { cleanup: number; cap: number }
  thresholds: CandidateResult['thresholds'] & { snapTol: number; mergeGap: number; finalMinLength: number }
}

/** The whole pipeline: candidates, cleanup, cap and ids. */
export function extractWallSegments(
  page: Pick<PageVectors, 'width' | 'height' | 'pxPerPt' | 'segments'>,
  options: CandidateOptions & { cap?: number } = {},
): WallSegmentsResult {
  const picked = pickWallCandidates(page, options)
  const pt = page.pxPerPt > 0 ? page.pxPerPt : 1
  const snapTol = 2 * pt
  const mergeGap = 1 * pt
  const finalMinLength = Math.min(8 * pt, picked.thresholds.minLength)
  const raw: RawSegment[] = picked.candidates.map((s) => ({ x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, thickness: s.width, source: s.source }))
  const cleaned = cleanupSegments(raw, {
    snapTol,
    mergeGap,
    minLength: finalMinLength,
    thickMin: picked.thresholds.widthFilter ? picked.thresholds.minWidth : Infinity,
  })
  const capped = capSegments(cleaned, options.cap ?? SEGMENT_CAP)
  return {
    segments: assignSegmentIds(capped),
    candidates: picked.candidates.length,
    dropped: { ...picked.dropped, cleanup: Math.max(0, raw.length - cleaned.length), cap: cleaned.length - capped.length },
    thresholds: { ...picked.thresholds, snapTol, mergeGap, finalMinLength },
  }
}

// ---------------------------------------------------------------- door swings

/** A likely door swing: the hinge, the leaf's length and the arc's ends, in pixels. */
export type DoorHint = { hinge: Point; radius: number; from: Point; to: Point; sweep: number }

function circumcircle(a: Point, b: Point, c: Point): { x: number; y: number; r: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y))
  if (Math.abs(d) < 1e-9) return null
  const a2 = a.x * a.x + a.y * a.y
  const b2 = b.x * b.x + b.y * b.y
  const c2 = c.x * c.x + c.y * c.y
  const x = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d
  const y = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d
  return { x, y, r: Math.hypot(a.x - x, a.y - y) }
}

/**
 * Curves that look like a door's quarter swing (a circular arc of 60 to 120
 * degrees with a radius between minRadius and maxRadius pixels). The hinge is
 * the arc's centre and the radius the leaf's width.
 */
export function doorSwingHints(curves: readonly CurveHint[], minRadius: number, maxRadius: number): DoorHint[] {
  const out: DoorHint[] = []
  for (const c of curves) {
    const pts = c.points
    if (pts.length < 3) continue
    const from = pts[0]
    const to = pts[pts.length - 1]
    const mid = pts[Math.floor(pts.length / 2)]
    const circle = circumcircle(from, mid, to)
    if (!circle || circle.r < minRadius || circle.r > maxRadius) continue
    // Every point must sit on the circle: a real arc, not an S curve.
    if (pts.some((p) => Math.abs(Math.hypot(p.x - circle.x, p.y - circle.y) - circle.r) > 0.05 * circle.r)) continue
    const a0 = Math.atan2(from.y - circle.y, from.x - circle.x)
    const a1 = Math.atan2(to.y - circle.y, to.x - circle.x)
    let sweep = Math.abs(((a1 - a0) * 180) / Math.PI)
    if (sweep > 180) sweep = 360 - sweep
    if (sweep < 60 || sweep > 120) continue
    out.push({ hinge: { x: circle.x, y: circle.y }, radius: circle.r, from, to, sweep })
  }
  return out
}

// ---------------------------------------------------------------- double lines and chains

type Seg = { x1: number; y1: number; x2: number; y2: number; thickness: number }

/**
 * Walls drawn as two thin parallel lines (their two faces) become one centre
 * line with the gap as its thickness. Two lines pair when they run within 2
 * degrees of each other, at most `maxGap` apart, side by side for at least
 * half the shorter one, and both are thinner than half the gap (so two thick
 * walls side by side stay two walls). Closest pairs first; each line pairs
 * once. The centre line's ends are the middles of the faces' ends, so two
 * walls meeting at a corner meet at their centre lines' corner.
 */
export function pairParallelLines<T extends Seg>(segs: readonly T[], maxGap: number): Seg[] {
  type Info = { s: T; ux: number; uy: number; len: number }
  const info: Info[] = segs.map((s) => {
    const len = segLength(s)
    return { s, ux: len > 0 ? (s.x2 - s.x1) / len : 1, uy: len > 0 ? (s.y2 - s.y1) / len : 0, len }
  })
  const cos2 = Math.cos((2 * Math.PI) / 180)
  const pairs: { i: number; j: number; gap: number }[] = []
  for (let i = 0; i < info.length; i++) {
    const a = info[i]
    if (a.len === 0) continue
    for (let j = i + 1; j < info.length; j++) {
      const b = info[j]
      if (b.len === 0) continue
      if (Math.abs(a.ux * b.ux + a.uy * b.uy) < cos2) continue
      // b's middle measured across a's line.
      const mx = (b.s.x1 + b.s.x2) / 2 - a.s.x1
      const my = (b.s.y1 + b.s.y2) / 2 - a.s.y1
      const gap = Math.abs(-mx * a.uy + my * a.ux)
      if (gap <= 0 || gap > maxGap) continue
      if (Math.max(a.s.thickness, b.s.thickness) >= gap / 2) continue
      const ta1 = 0
      const ta2 = a.len
      const tb1 = (b.s.x1 - a.s.x1) * a.ux + (b.s.y1 - a.s.y1) * a.uy
      const tb2 = (b.s.x2 - a.s.x1) * a.ux + (b.s.y2 - a.s.y1) * a.uy
      const overlap = Math.min(ta2, Math.max(tb1, tb2)) - Math.max(ta1, Math.min(tb1, tb2))
      if (overlap < 0.5 * Math.min(a.len, b.len)) continue
      pairs.push({ i, j, gap })
    }
  }
  pairs.sort((p, q) => p.gap - q.gap)
  const used = new Set<number>()
  const out: Seg[] = []
  for (const { i, j, gap } of pairs) {
    if (used.has(i) || used.has(j)) continue
    used.add(i)
    used.add(j)
    const a = info[i]
    const b = info[j].s
    // Orient b like a, then average the matching ends.
    const same = (b.x2 - b.x1) * a.ux + (b.y2 - b.y1) * a.uy >= 0
    const b1 = same ? { x: b.x1, y: b.y1 } : { x: b.x2, y: b.y2 }
    const b2 = same ? { x: b.x2, y: b.y2 } : { x: b.x1, y: b.y1 }
    out.push({ x1: (a.s.x1 + b1.x) / 2, y1: (a.s.y1 + b1.y) / 2, x2: (a.s.x2 + b2.x) / 2, y2: (a.s.y2 + b2.y) / 2, thickness: gap })
  }
  info.forEach((it, k) => {
    if (!used.has(k)) out.push({ x1: it.s.x1, y1: it.s.y1, x2: it.s.x2, y2: it.s.y2, thickness: it.s.thickness })
  })
  return out
}

/** A chain of segments joined end to end. */
export type Chain = { points: Point[]; closed: boolean; thickness: number }

/**
 * Joins segments into polylines through end points shared within `tol`. A
 * chain runs on through a point only where exactly two segments of about the
 * same thickness (within 25%) meet; it stops at ends, junctions and changes
 * of thickness. A loop comes back closed, its first point repeated at the
 * end. Points where a chain runs straight on are dropped. Thickness is the
 * median of the chain's segments.
 */
export function chainSegments(segs: readonly Seg[], tol: number): Chain[] {
  type Node = { x: number; y: number; edges: number[] }
  const nodes: Node[] = []
  const grid = new Map<string, number[]>()
  const cell = Math.max(tol, 1e-6)
  const nodeAt = (x: number, y: number): number => {
    const cx = Math.floor(x / cell)
    const cy = Math.floor(y / cell)
    let best = -1
    let bestD = Infinity
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const k of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          const d = Math.hypot(nodes[k].x - x, nodes[k].y - y)
          if (d <= tol && d < bestD) {
            best = k
            bestD = d
          }
        }
      }
    }
    if (best >= 0) return best
    nodes.push({ x, y, edges: [] })
    const key = `${cx},${cy}`
    const list = grid.get(key)
    if (list) list.push(nodes.length - 1)
    else grid.set(key, [nodes.length - 1])
    return nodes.length - 1
  }
  const edges: { u: number; v: number; thickness: number }[] = []
  for (const s of segs) {
    const u = nodeAt(s.x1, s.y1)
    const v = nodeAt(s.x2, s.y2)
    if (u === v) continue
    edges.push({ u, v, thickness: s.thickness })
    nodes[u].edges.push(edges.length - 1)
    nodes[v].edges.push(edges.length - 1)
  }
  const similar = (a: number, b: number) => Math.abs(a - b) <= 0.25 * Math.max(a, b) + 1e-9
  const passes = (n: number) => {
    const e = nodes[n].edges
    return e.length === 2 && similar(edges[e[0]].thickness, edges[e[1]].thickness)
  }
  const visited = new Set<number>()
  const chains: Chain[] = []
  const walk = (start: number, firstEdge: number): Chain => {
    const nodeIds = [start]
    const thick: number[] = []
    let node = start
    let edge = firstEdge
    for (;;) {
      visited.add(edge)
      thick.push(edges[edge].thickness)
      const next = edges[edge].u === node ? edges[edge].v : edges[edge].u
      nodeIds.push(next)
      node = next
      if (node === start || !passes(node)) break
      const other = nodes[node].edges.find((e) => e !== edge)
      if (other === undefined || visited.has(other)) break
      edge = other
    }
    const closed = nodeIds.length > 2 && nodeIds[0] === nodeIds[nodeIds.length - 1]
    thick.sort((a, b) => a - b)
    return { points: straighten(nodeIds.map((id) => ({ x: nodes[id].x, y: nodes[id].y })), closed), closed, thickness: thick[Math.floor(thick.length / 2)] }
  }
  nodes.forEach((n, id) => {
    if (passes(id)) return
    for (const e of n.edges) if (!visited.has(e)) chains.push(walk(id, e))
  })
  // What is left are loops through points where chains run on.
  edges.forEach((e, k) => {
    if (!visited.has(k)) chains.push(walk(e.u, k))
  })
  return chains
}

/** Drops points where the polyline runs straight on (within half a degree). */
function straighten(points: Point[], closed: boolean): Point[] {
  const turn = (a: Point, b: Point, c: Point) => {
    const a1 = Math.atan2(b.y - a.y, b.x - a.x)
    const a2 = Math.atan2(c.y - b.y, c.x - b.x)
    let d = Math.abs(a2 - a1)
    if (d > Math.PI) d = 2 * Math.PI - d
    return (d * 180) / Math.PI
  }
  const out = [...points]
  for (let i = 1; i < out.length - 1; ) {
    if (turn(out[i - 1], out[i], out[i + 1]) < 0.5) out.splice(i, 1)
    else i++
  }
  if (closed && out.length > 4 && turn(out[out.length - 2], out[0], out[1]) < 0.5) {
    // The loop's start sits on a straight run: start at the next corner instead.
    out.pop()
    out.shift()
    out.push(out[0])
  }
  return out
}
