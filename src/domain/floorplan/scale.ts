/**
 * The drawing's scale for the floor plan import (spec section 5 step 5, PLAN
 * section 7 "Scale").
 *
 * Each dimension label gives a candidate scale: its value in centimeters over
 * the length of the line it measures, in image pixels. When every candidate
 * agrees within 2% the scale is their length-weighted mean (longer lines are
 * measured more exactly). When they disagree, or no label was found, there is
 * no scale and the app asks for two points and the real distance between
 * them (scaleFromTwoPoints).
 *
 * For a vector PDF, measureDimensionLines pairs the page's own dimension text
 * with the thin line under it, so the measured length comes from the PDF's
 * geometry rather than from the model.
 */
import type { Point } from '../geometry'
import type { PageText, VectorSegment } from './pdf-vectors'

export const CM_PER_INCH = 2.54
export const CM_PER_FOOT = 30.48
/** Labels must agree within this to give a scale. Percent. */
export const SCALE_AGREEMENT_PERCENT = 2

// ---------------------------------------------------------------- reading dimension text

const FRACTIONS: Record<string, number> = {
  '½': 0.5,
  '¼': 0.25,
  '¾': 0.75,
  '⅛': 0.125,
  '⅜': 0.375,
  '⅝': 0.625,
  '⅞': 0.875,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
}

/** Primes, curly quotes and fraction characters to plain ASCII; lower case; one space. */
function normalize(text: string): string {
  let s = text.toLowerCase()
  s = s.replace(/[’‘′´`]/g, "'").replace(/[“”″]/g, '"').replace(/''/g, '"')
  s = s.replace(/[½¼¾⅛⅜⅝⅞⅓⅔]/g, (ch) => ` ${FRACTIONS[ch]}`.replace(/^ 0\./, ' .'))
  // A decimal comma (1,25 m) but not a thousands comma (1,250 mm).
  s = s.replace(/(\d),(\d{1,2})(?!\d)/g, '$1.$2')
  s = s.replace(/(\d),(\d{3})(?!\d)/g, '$1$2')
  return s.replace(/\s+/g, ' ').trim()
}

const NUM = String.raw`(\d+(?:\.\d+)?|\.\d+)`
/** A whole number of inches plus an optional fraction: 6, 6 1/2, 6-1/2, 6 .5, 1/2. */
const INCH_PART = String.raw`(?:(\d+(?:\.\d+)?)(?:[ -](\d+)\/(\d+)|\s?(\.\d+))?|(\d+)\/(\d+))`
const FEET_MARK = String.raw`(?:'|(?:ft\.?|feet|foot)(?![a-z]))`
const INCH_MARK = String.raw`(?:"|(?:inch(?:es)?|in\.?)(?![a-z]))`

/** The inch part may not run into another number or a feet mark: `10' 20'` is two lengths. */
const FEET_INCHES = new RegExp(
  String.raw`(?<![\d.])${NUM}\s*${FEET_MARK}(?:\s*-?\s*${INCH_PART}(?![\d./]|\s*${FEET_MARK})\s*${INCH_MARK}?)?`,
  'g',
)
const INCHES_ONLY = new RegExp(String.raw`(?<![\d.'])${INCH_PART}\s*${INCH_MARK}`, 'g')
const METRIC = new RegExp(String.raw`(?<![\d.])${NUM}\s*(mm|millimet(?:er|re)s?|cm|centimet(?:er|re)s?|m|met(?:er|re)s?)(?![a-z])`, 'g')

function inchValue(whole: string | undefined, num: string | undefined, den: string | undefined, dec: string | undefined, fnum: string | undefined, fden: string | undefined): number {
  if (fnum !== undefined && fden !== undefined) return Number(fden) === 0 ? NaN : Number(fnum) / Number(fden)
  let v = whole === undefined ? 0 : Number(whole)
  if (num !== undefined && den !== undefined) v += Number(den) === 0 ? NaN : Number(num) / Number(den)
  if (dec !== undefined) v += Number(dec)
  return v
}

function metricCm(value: number, unit: string): number {
  if (unit.startsWith('mm') || unit.startsWith('milli')) return value / 10
  if (unit.startsWith('c')) return value
  return value * 100
}

/** A length found in a piece of text, with where it sits in the text. */
export type FoundLength = { text: string; cm: number; index: number }

function clean(cm: number): number {
  return Math.round(cm * 1e6) / 1e6
}

/**
 * Every length in a piece of text, left to right: feet and inches (12'-6",
 * 12' 6", 12ft 6in, 12'-6 1/2"), inches (150"), meters (10.00 m),
 * centimeters (350 cm) and millimeters (3500 mm). A bare number is read in
 * `bareUnit` when one is given (metric plans often print bare millimeters),
 * else skipped.
 */
export function findLengths(text: string, bareUnit: 'mm' | 'cm' | 'm' | 'in' | 'ft' | null = null): FoundLength[] {
  const s = normalize(text)
  const found: FoundLength[] = []
  const taken: [number, number][] = []
  const free = (start: number, end: number) => taken.every(([a, b]) => end <= a || start >= b)
  const add = (start: number, end: number, cm: number) => {
    if (!Number.isFinite(cm) || cm <= 0 || !free(start, end)) return
    taken.push([start, end])
    found.push({ text: s.slice(start, end).trim(), cm: clean(cm), index: start })
  }
  for (const m of s.matchAll(FEET_INCHES)) {
    const feet = Number(m[1])
    const inches = m[2] !== undefined || m[7] !== undefined ? inchValue(m[2], m[3], m[4], m[5], m[6], m[7]) : 0
    add(m.index, m.index + m[0].length, feet * CM_PER_FOOT + inches * CM_PER_INCH)
  }
  for (const m of s.matchAll(INCHES_ONLY)) {
    add(m.index, m.index + m[0].length, inchValue(m[1], m[2], m[3], m[4], m[5], m[6]) * CM_PER_INCH)
  }
  for (const m of s.matchAll(METRIC)) {
    add(m.index, m.index + m[0].length, metricCm(Number(m[1]), m[2]))
  }
  if (bareUnit) {
    for (const m of s.matchAll(/(?<![\d.'"])(\d+(?:\.\d+)?)(?![\d.'"]|\s*(?:mm|cm|m|ft|in|'|"))/g)) {
      const v = Number(m[1])
      const cm =
        bareUnit === 'mm' ? v / 10 : bareUnit === 'cm' ? v : bareUnit === 'm' ? v * 100 : bareUnit === 'in' ? v * CM_PER_INCH : v * CM_PER_FOOT
      add(m.index, m.index + m[0].length, cm)
    }
  }
  return found.sort((a, b) => a.index - b.index)
}

/**
 * The length a dimension label states, in centimeters, or null when the text
 * is not one length (no length, or two as in `12' x 14'`).
 */
export function parseDimension(text: string, bareUnit: 'mm' | 'cm' | 'm' | 'in' | 'ft' | null = null): number | null {
  const found = findLengths(text, bareUnit)
  if (found.length !== 1) return null
  // The length must be most of the label: "Room 12'" is a name, "12'-6"" is a dimension.
  const rest = normalize(text).replace(found[0].text, '').replace(/[\s()[\]~±+=:;,.-]/g, '')
  return rest.length <= 3 ? found[0].cm : null
}

// ---------------------------------------------------------------- scale from labels

/** A dimension label with the line it measures, in image pixels. */
export type DimensionLabel = { text: string; valueCm: number; from: Point; to: Point }

export type ScaleCandidate = { label: DimensionLabel; pixels: number; cmPerPx: number }

/** Lines shorter than this many pixels are too short to measure. */
const MIN_MEASURE_PX = 10

/** One candidate scale per usable label: a positive value over a line at least 10 px long. */
export function scaleCandidates(labels: readonly DimensionLabel[]): ScaleCandidate[] {
  const out: ScaleCandidate[] = []
  for (const label of labels) {
    const pixels = Math.hypot(label.to.x - label.from.x, label.to.y - label.from.y)
    if (!(label.valueCm > 0) || !Number.isFinite(label.valueCm) || !(pixels >= MIN_MEASURE_PX)) continue
    out.push({ label, pixels, cmPerPx: label.valueCm / pixels })
  }
  return out
}

/** How far the candidates disagree: the largest over the smallest, minus one, in percent. 0 for one or none. */
export function scaleSpreadPercent(candidates: readonly { cmPerPx: number }[]): number {
  if (candidates.length < 2) return 0
  let min = Infinity
  let max = -Infinity
  for (const c of candidates) {
    min = Math.min(min, c.cmPerPx)
    max = Math.max(max, c.cmPerPx)
  }
  return (max / min - 1) * 100
}

function weightedScale(candidates: readonly ScaleCandidate[]): number {
  let cm = 0
  let px = 0
  for (const c of candidates) {
    cm += c.label.valueCm
    px += c.pixels
  }
  return cm / px
}

export type ScaleChoice = {
  /** Centimeters per image pixel, or null when two points are needed. */
  cmPerPx: number | null
  candidates: ScaleCandidate[]
  spreadPercent: number
  /** 'agree': one scale; 'disagree': labels differ by more than 2%; 'none': no usable label. */
  status: 'agree' | 'disagree' | 'none'
  /**
   * The largest group of labels that agree within 2%, for a hint such as
   * "3 of 4 labels agree", with those labels. Null when there are no labels.
   */
  consensus: { cmPerPx: number; count: number; candidates: ScaleCandidate[] } | null
}

/** Picks the scale from the labels (see the file comment). */
export function chooseScale(labels: readonly DimensionLabel[], agreementPercent = SCALE_AGREEMENT_PERCENT): ScaleChoice {
  const candidates = scaleCandidates(labels)
  if (candidates.length === 0) return { cmPerPx: null, candidates, spreadPercent: 0, status: 'none', consensus: null }
  const spreadPercent = scaleSpreadPercent(candidates)
  const sorted = [...candidates].sort((a, b) => a.cmPerPx - b.cmPerPx)
  let best: ScaleCandidate[] = []
  for (let i = 0, j = 0; i < sorted.length; i++) {
    while (sorted[i].cmPerPx / sorted[j].cmPerPx - 1 > agreementPercent / 100) j++
    // sorted[j..i] all lie within the agreement of each other.
    if (i - j + 1 > best.length) best = sorted.slice(j, i + 1)
  }
  const consensus = { cmPerPx: weightedScale(best), count: best.length, candidates: best }
  if (spreadPercent > agreementPercent) return { cmPerPx: null, candidates, spreadPercent, status: 'disagree', consensus }
  return { cmPerPx: weightedScale(candidates), candidates, spreadPercent, status: 'agree', consensus }
}

/** The scale from two clicked points and the real distance between them, or null when it cannot be worked out. */
export function scaleFromTwoPoints(p1: Point, p2: Point, realCm: number): number | null {
  const pixels = Math.hypot(p2.x - p1.x, p2.y - p1.y)
  if (!(pixels > 0) || !(realCm > 0) || !Number.isFinite(realCm) || !Number.isFinite(pixels)) return null
  return realCm / pixels
}

// ---------------------------------------------------------------- dimension lines in a vector PDF

type Line = { x1: number; y1: number; x2: number; y2: number }

function angleBetween(ax: number, ay: number, bx: number, by: number): number {
  const dot = Math.abs(ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by))
  return (Math.acos(Math.min(1, dot)) * 180) / Math.PI
}

/**
 * Pairs each dimension text on a vector page with the line it measures:
 *  - the nearest line parallel to the text (within 3 degrees) whose side of
 *    the text is within 2.5 text heights, and that runs past the text's
 *    middle (pieces split around the text count as one line);
 *  - its ends are the nearest crossing lines (ticks, extension lines) on
 *    each side of the text, or the line's own ends when nothing crosses it,
 *    so chained dimensions and lines that overshoot their ticks measure
 *    right.
 * `segments` should be every stroked straight segment of the page, thin
 * ones included.
 */
export function measureDimensionLines(
  texts: readonly PageText[],
  segments: readonly VectorSegment[],
  bareUnit: 'mm' | 'cm' | 'm' | 'in' | 'ft' | null = null,
): DimensionLabel[] {
  const strokes = segments.filter((s) => s.source === 'stroke' && (s.x1 !== s.x2 || s.y1 !== s.y2))
  const out: DimensionLabel[] = []
  for (const t of texts) {
    const valueCm = parseDimension(t.text, bareUnit)
    if (valueCm === null) continue
    const a = (t.angle * Math.PI) / 180
    const ux = Math.cos(a)
    const uy = Math.sin(a)
    const nx = -uy
    const ny = ux
    const h = Math.max(t.height, 1)
    const textLen = Math.hypot(t.to.x - t.from.x, t.to.y - t.from.y)
    const cAlong = t.center.x * ux + t.center.y * uy
    const cAcross = t.center.x * nx + t.center.y * ny
    // Parallel lines near the text, as intervals along the text's direction.
    const near: { off: number; t1: number; t2: number }[] = []
    for (const s of strokes) {
      if (angleBetween(s.x2 - s.x1, s.y2 - s.y1, ux, uy) > 3) continue
      const off1 = s.x1 * nx + s.y1 * ny
      const off2 = s.x2 * nx + s.y2 * ny
      const off = (off1 + off2) / 2
      if (Math.abs(off - cAcross) > 2.5 * h) continue
      let t1 = s.x1 * ux + s.y1 * uy
      let t2 = s.x2 * ux + s.y2 * uy
      if (t1 > t2) [t1, t2] = [t2, t1]
      near.push({ off, t1, t2 })
    }
    // Lines on one offset (within 1 px), joined across gaps up to the text's length.
    near.sort((p, q) => p.off - q.off || p.t1 - q.t1)
    let best: { off: number; t1: number; t2: number; d: number } | null = null
    for (let i = 0; i < near.length; ) {
      let j = i
      while (j + 1 < near.length && near[j + 1].off - near[i].off <= 1) j++
      const band = near.slice(i, j + 1).sort((p, q) => p.t1 - q.t1)
      i = j + 1
      let cur: { off: number; t1: number; t2: number } | null = null
      const consider = (run: { off: number; t1: number; t2: number }) => {
        if (run.t1 - h > cAlong || run.t2 + h < cAlong) return
        // The line must be clearly longer than the text it carries.
        if (run.t2 - run.t1 < Math.max(textLen, 2 * h)) return
        const d = Math.abs(run.off - cAcross)
        if (!best || d < best.d - 0.5 || (Math.abs(d - best.d) <= 0.5 && run.t2 - run.t1 > best.t2 - best.t1)) best = { ...run, d }
      }
      for (const it of band) {
        if (cur && it.t1 <= cur.t2 + textLen + 2 * h) {
          cur.t2 = Math.max(cur.t2, it.t2)
          continue
        }
        if (cur) consider(cur)
        cur = { ...it }
      }
      if (cur) consider(cur)
    }
    if (!best) continue
    const line: { off: number; t1: number; t2: number } = best
    const p1 = { x: line.t1 * ux + line.off * nx, y: line.t1 * uy + line.off * ny }
    const p2 = { x: line.t2 * ux + line.off * nx, y: line.t2 * uy + line.off * ny }
    // Crossings: lines at more than 20 degrees that meet the dimension line.
    let left = line.t1
    let right = line.t2
    let leftCross = -Infinity
    let rightCross = Infinity
    const tol = Math.max(1, 0.1 * h)
    for (const s of strokes) {
      if (angleBetween(s.x2 - s.x1, s.y2 - s.y1, ux, uy) < 20) continue
      const hit = crossing({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y }, s, tol)
      if (hit === null) continue
      const along = hit.x * ux + hit.y * uy
      if (along < cAlong - textLen / 2 && along > leftCross) leftCross = along
      if (along > cAlong + textLen / 2 && along < rightCross) rightCross = along
    }
    if (Number.isFinite(leftCross)) left = leftCross
    if (Number.isFinite(rightCross)) right = rightCross
    if (right - left < MIN_MEASURE_PX) continue
    out.push({
      text: t.text,
      valueCm,
      from: { x: left * ux + line.off * nx, y: left * uy + line.off * ny },
      to: { x: right * ux + line.off * nx, y: right * uy + line.off * ny },
    })
  }
  return out
}

/** Where segment s meets line l (each within tol of the other), or null. */
function crossing(l: Line, s: Line, tol: number): Point | null {
  const rx = l.x2 - l.x1
  const ry = l.y2 - l.y1
  const sx = s.x2 - s.x1
  const sy = s.y2 - s.y1
  const denom = rx * sy - ry * sx
  if (Math.abs(denom) < 1e-12) return null
  const qx = s.x1 - l.x1
  const qy = s.y1 - l.y1
  const t = (qx * sy - qy * sx) / denom
  const u = (qx * ry - qy * rx) / denom
  const lLen = Math.hypot(rx, ry)
  const sLen = Math.hypot(sx, sy)
  if (t < -tol / lLen || t > 1 + tol / lLen) return null
  if (u < -tol / sLen || u > 1 + tol / sLen) return null
  return { x: l.x1 + t * rx, y: l.y1 + t * ry }
}
