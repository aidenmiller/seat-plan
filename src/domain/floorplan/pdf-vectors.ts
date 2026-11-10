/**
 * Reads the vector drawing of one PDF page (spec section 5, PLAN section 7
 * "Floor plan import", change 21) from pdf.js's operator list:
 *
 *  - every stroked straight segment with its width,
 *  - long thin filled shapes (walls drawn solid, outlined or not) as centre
 *    lines with their thickness,
 *  - stroked curves, kept apart: they are door swings far more often than
 *    walls,
 *  - the page's text with its position, for dimension labels,
 *  - how much of the page is covered by pictures (a scanned plan).
 *
 * Everything comes out in the pixel space of the PNG rendered from the same
 * viewport, so the page's crop box, its /Rotate and the y flip all apply the
 * same way to the picture the model sees and to the lines we keep.
 *
 * It imports nothing from pdf.js: the caller passes the operator list,
 * pdf.js's OPS table and the viewport transform, so the same code runs in the
 * browser and in Vitest on Node. Written against pdfjs-dist 6.5.438, where
 * constructPath carries [paintOp, [data | null], minMax | null] (since
 * 5.1.91) and the path codes inside data (DrawOPS) are not exported. Pin the
 * version: pdf-vectors.test.ts fails if the format changes.
 */
import type { Point } from '../geometry'

/** pdf.js path codes inside constructPath data (src/shared/util.js, not exported). */
export const DRAW_OPS = { moveTo: 0, lineTo: 1, curveTo: 2, quadraticCurveTo: 3, closePath: 4 } as const

/** An affine transform [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f. */
export type Matrix = [number, number, number, number, number, number]

export const IDENTITY: Readonly<Matrix> = [1, 0, 0, 1, 0, 0]

/** pdf.js Util.transform: applies m2 first, then m1. */
export function multiply(m1: ArrayLike<number>, m2: ArrayLike<number>): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ]
}

export function applyMatrix(m: ArrayLike<number>, x: number, y: number): Point {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] }
}

/** How much a transform scales lengths (exact for uniform scales, an average otherwise). */
export function matrixScale(m: ArrayLike<number>): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]))
}

/** pdf.js's OPS table (pdfjs.OPS). */
export type PdfOps = Readonly<Record<string, number>>

/** page.getOperatorList()'s result. */
export type OperatorListLike = { fnArray: ArrayLike<number>; argsArray: ArrayLike<unknown> }

/** A straight segment in PNG pixels. */
export type VectorSegment = {
  x1: number
  y1: number
  x2: number
  y2: number
  /** Stroke width in pixels (0 for a hairline), or a solid wall's thickness. */
  width: number
  /** 'stroke' for a stroked line; 'fill' for the centre line of a long thin filled polygon. */
  source: 'stroke' | 'fill'
  /** Which painted path it came from, in drawing order. */
  path: number
  /** The optional content (CAD layer) name, when the PDF has layers. */
  layer: string | null
}

/** A stroked curve, flattened, in PNG pixels: usually a door swing. */
export type CurveHint = { points: Point[]; width: number; path: number; layer: string | null }

/** A run of text on the page, in PNG pixels. */
export type PageText = {
  text: string
  /** Baseline start and end. */
  from: Point
  to: Point
  /** The middle of the text's box. */
  center: Point
  /** Font height in pixels. */
  height: number
  /** Direction of the baseline in degrees, clockwise on screen from +x. */
  angle: number
}

export type PageStats = {
  ops: number
  constructPath: number
  strokePaths: number
  fillPaths: number
  /** Straight stroked segments, any length. */
  strokeSegments: number
  /** Filled polygons that were not long and thin (columns, furniture, hatching). */
  otherFills: number
  textOps: number
  images: number
  /** Share of the page covered by pictures, 0 to 1. */
  imageCoverage: number
}

export type PageVectors = {
  /** The PNG's size in pixels. */
  width: number
  height: number
  /** Pixels per PDF point (the viewport scale times the page's user unit). */
  pxPerPt: number
  segments: VectorSegment[]
  curves: CurveHint[]
  texts: PageText[]
  stats: PageStats
}

export type ReadPageInput = {
  operatorList: OperatorListLike
  ops: PdfOps
  /** viewport.transform of the viewport the PNG is rendered with. */
  transform: ArrayLike<number>
  /** The PNG's size: Math.floor(viewport.width) and Math.floor(viewport.height). */
  width: number
  height: number
  /** page.getTextContent().items; marked content entries are skipped. */
  textItems?: readonly unknown[]
  /** Optional content group id to layer name, from pdf.getOptionalContentConfig(). */
  layerNames?: ReadonlyMap<string, string>
  /** optionalContentConfig.isVisible: content on hidden layers is not drawn, so it is skipped too. */
  isLayerVisible?: (group: unknown) => boolean
}

type GraphicsState = { ctm: Matrix; lineWidth: number }

const STROKE_OPS = ['stroke', 'closeStroke', 'fillStroke', 'eoFillStroke', 'closeFillStroke', 'closeEOFillStroke'] as const
const FILL_OPS = ['fill', 'eoFill', 'fillStroke', 'eoFillStroke', 'closeFillStroke', 'closeEOFillStroke'] as const
const IMAGE_OPS = [
  'paintImageXObject',
  'paintInlineImageXObject',
  'paintImageMaskXObject',
  'paintSolidColorImageMask',
] as const
const TEXT_OPS = ['showText', 'showSpacedText', 'nextLineShowText', 'nextLineSetSpacingShowText'] as const

function opSet(ops: PdfOps, names: readonly string[]): Set<number> {
  const out = new Set<number>()
  for (const n of names) if (typeof ops[n] === 'number') out.add(ops[n])
  return out
}

/** Cubic Bezier flattened into n pieces (the end points only, the start excluded). */
function flattenCubic(p0: Point, p1: Point, p2: Point, p3: Point, n = 8): Point[] {
  const out: Point[] = []
  for (let i = 1; i <= n; i++) {
    const t = i / n
    const u = 1 - t
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    })
  }
  return out
}

function flattenQuadratic(p0: Point, p1: Point, p2: Point, n = 4): Point[] {
  const out: Point[] = []
  for (let i = 1; i <= n; i++) {
    const t = i / n
    const u = 1 - t
    out.push({ x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y })
  }
  return out
}

/** Liang-Barsky: the part of a-b inside the box, or null. */
export function clipSegment(a: Point, b: Point, minX: number, minY: number, maxX: number, maxY: number): [Point, Point] | null {
  const dx = b.x - a.x
  const dy = b.y - a.y
  let t0 = 0
  let t1 = 1
  const edges: [number, number][] = [
    [-dx, a.x - minX],
    [dx, maxX - a.x],
    [-dy, a.y - minY],
    [dy, maxY - a.y],
  ]
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null
      continue
    }
    const r = q / p
    if (p < 0) {
      if (r > t1) return null
      if (r > t0) t0 = r
    } else {
      if (r < t0) return null
      if (r < t1) t1 = r
    }
  }
  return [
    { x: a.x + t0 * dx, y: a.y + t0 * dy },
    { x: a.x + t1 * dx, y: a.y + t1 * dy },
  ]
}

type SubPath = { lines: [Point, Point][]; curves: Point[][]; outline: Point[] }

/**
 * Splits one constructPath's data into subpaths, every point already through
 * the current transform: straight pieces, curve runs (flattened, start point
 * included) and the whole outline for fills.
 */
function walkPath(data: ArrayLike<number>, m: Matrix): SubPath[] {
  const out: SubPath[] = []
  let cur: SubPath | null = null
  let current: Point = { x: 0, y: 0 }
  let start: Point = { x: 0, y: 0 }
  let curveRun: Point[] | null = null
  const endCurveRun = () => {
    if (cur && curveRun && curveRun.length >= 2) cur.curves.push(curveRun)
    curveRun = null
  }
  const ensure = (): SubPath => {
    if (!cur) {
      cur = { lines: [], curves: [], outline: [current] }
      out.push(cur)
    }
    return cur
  }
  for (let k = 0; k < data.length; ) {
    const code = data[k++]
    switch (code) {
      case DRAW_OPS.moveTo: {
        endCurveRun()
        current = applyMatrix(m, data[k], data[k + 1])
        k += 2
        start = current
        cur = { lines: [], curves: [], outline: [current] }
        out.push(cur)
        break
      }
      case DRAW_OPS.lineTo: {
        endCurveRun()
        const p = applyMatrix(m, data[k], data[k + 1])
        k += 2
        const sp = ensure()
        sp.lines.push([current, p])
        sp.outline.push(p)
        current = p
        break
      }
      case DRAW_OPS.curveTo: {
        const c1 = applyMatrix(m, data[k], data[k + 1])
        const c2 = applyMatrix(m, data[k + 2], data[k + 3])
        const p = applyMatrix(m, data[k + 4], data[k + 5])
        k += 6
        const sp = ensure()
        const pts = flattenCubic(current, c1, c2, p)
        if (!curveRun) curveRun = [current]
        curveRun.push(...pts)
        sp.outline.push(...pts)
        current = p
        break
      }
      case DRAW_OPS.quadraticCurveTo: {
        const c1 = applyMatrix(m, data[k], data[k + 1])
        const p = applyMatrix(m, data[k + 2], data[k + 3])
        k += 4
        const sp = ensure()
        const pts = flattenQuadratic(current, c1, p)
        if (!curveRun) curveRun = [current]
        curveRun.push(...pts)
        sp.outline.push(...pts)
        current = p
        break
      }
      case DRAW_OPS.closePath: {
        endCurveRun()
        const sp = ensure()
        if (current.x !== start.x || current.y !== start.y) sp.lines.push([current, start])
        current = start
        // A new subpath starts here unless a moveTo comes next.
        cur = null
        break
      }
      default:
        // An unknown code: the rest of this path cannot be read safely.
        k = data.length
    }
  }
  endCurveRun()
  return out
}

function polygonArea(points: readonly Point[]): number {
  let a = 0
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) a += points[j].x * points[i].y - points[i].x * points[j].y
  return Math.abs(a) / 2
}

/**
 * A long thin filled polygon (a wall drawn solid) as its centre line and
 * thickness, or null. Long and thin: at least 4 times longer than thick, at
 * least `minLength` long, and nearly a rectangle along its longest edge.
 */
export function thinPolygonCenterline(
  points: readonly Point[],
  minLength: number,
): { a: Point; b: Point; thickness: number } | null {
  if (points.length < 3) return null
  let best = 0
  let ux = 1
  let uy = 0
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    const q = points[(i + 1) % points.length]
    const len = Math.hypot(q.x - p.x, q.y - p.y)
    if (len > best) {
      best = len
      ux = (q.x - p.x) / len
      uy = (q.y - p.y) / len
    }
  }
  if (best === 0) return null
  const nx = -uy
  const ny = ux
  let minT = Infinity
  let maxT = -Infinity
  let minN = Infinity
  let maxN = -Infinity
  for (const p of points) {
    const t = p.x * ux + p.y * uy
    const n = p.x * nx + p.y * ny
    if (t < minT) minT = t
    if (t > maxT) maxT = t
    if (n < minN) minN = n
    if (n > maxN) maxN = n
  }
  const length = maxT - minT
  const thickness = maxN - minN
  if (thickness <= 0 || length < minLength || length < thickness * 4) return null
  if (polygonArea(points) < 0.8 * length * thickness) return null
  const midN = (minN + maxN) / 2
  return {
    a: { x: minT * ux + midN * nx, y: minT * uy + midN * ny },
    b: { x: maxT * ux + midN * nx, y: maxT * uy + midN * ny },
    thickness,
  }
}

/** Area of the unit square under `m` that falls on the page, in pixels. */
function imageAreaOnPage(m: Matrix, width: number, height: number): number {
  const corners = [applyMatrix(m, 0, 0), applyMatrix(m, 1, 0), applyMatrix(m, 1, 1), applyMatrix(m, 0, 1)]
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const c of corners) {
    minX = Math.min(minX, c.x)
    minY = Math.min(minY, c.y)
    maxX = Math.max(maxX, c.x)
    maxY = Math.max(maxY, c.y)
  }
  const w = Math.max(0, Math.min(maxX, width) - Math.max(minX, 0))
  const h = Math.max(0, Math.min(maxY, height) - Math.max(minY, 0))
  return Math.min(Math.abs(m[0] * m[3] - m[1] * m[2]), w * h)
}

function isNumberArray(v: unknown): v is ArrayLike<number> {
  return (Array.isArray(v) || ArrayBuffer.isView(v)) && typeof (v as ArrayLike<unknown>)[0] === 'number'
}

/** Reads one page's operator list and text. See the file comment. */
export function readPageVectors(input: ReadPageInput): PageVectors {
  const { ops, width, height } = input
  const { fnArray, argsArray } = input.operatorList
  const STROKE = opSet(ops, STROKE_OPS)
  const FILL = opSet(ops, FILL_OPS)
  const IMAGE = opSet(ops, IMAGE_OPS)
  const TEXT = opSet(ops, TEXT_OPS)
  const viewport = Array.from(input.transform).slice(0, 6) as Matrix
  const pxPerPt = matrixScale(viewport)
  const minFillLength = 0.02 * Math.hypot(width, height)

  let gs: GraphicsState = { ctm: viewport, lineWidth: 1 }
  const stack: GraphicsState[] = []
  // Marked content: each entry says whether it hides its content and names its layer.
  const marked: { hidden: boolean; layer: string | null }[] = []
  let hiddenDepth = 0

  const segments: VectorSegment[] = []
  const curves: CurveHint[] = []
  const stats: PageStats = {
    ops: fnArray.length,
    constructPath: 0,
    strokePaths: 0,
    fillPaths: 0,
    strokeSegments: 0,
    otherFills: 0,
    textOps: 0,
    images: 0,
    imageCoverage: 0,
  }
  let imageArea = 0
  let pathIndex = 0

  const currentLayer = (): string | null => {
    for (let i = marked.length - 1; i >= 0; i--) if (marked[i].layer) return marked[i].layer
    return null
  }

  const addImage = (m: Matrix) => {
    stats.images++
    imageArea += imageAreaOnPage(m, width, height)
  }

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i]
    const args = argsArray[i] as unknown[] | null | undefined
    switch (fn) {
      case ops.save:
        stack.push(gs)
        gs = { ...gs }
        continue
      case ops.restore:
        gs = stack.pop() ?? gs
        continue
      case ops.transform:
        if (args && args.length >= 6) gs.ctm = multiply(gs.ctm, args as number[])
        continue
      case ops.setLineWidth:
        if (args && typeof args[0] === 'number') gs.lineWidth = args[0]
        continue
      case ops.setGState: {
        const entries = args?.[0]
        if (Array.isArray(entries)) {
          for (const entry of entries) {
            if (Array.isArray(entry) && entry[0] === 'LW' && typeof entry[1] === 'number') gs.lineWidth = entry[1]
          }
        }
        continue
      }
      case ops.paintFormXObjectBegin: {
        // A form acts as save plus its own matrix.
        stack.push(gs)
        gs = { ...gs }
        const matrix = args?.[0]
        if (isNumberArray(matrix) && matrix.length >= 6) gs.ctm = multiply(gs.ctm, matrix)
        continue
      }
      case ops.paintFormXObjectEnd:
        gs = stack.pop() ?? gs
        continue
      case ops.beginMarkedContent:
        marked.push({ hidden: false, layer: null })
        continue
      case ops.beginMarkedContentProps: {
        const tag = args?.[0]
        const props = args?.[1] as { type?: unknown; id?: unknown } | null | undefined
        let hidden = false
        let layer: string | null = null
        if (tag === 'OC' && props && typeof props === 'object') {
          if (input.isLayerVisible) {
            try {
              hidden = !input.isLayerVisible(props)
            } catch {
              hidden = false
            }
          }
          if (props.type === 'OCG' && typeof props.id === 'string') layer = input.layerNames?.get(props.id) ?? props.id
        }
        marked.push({ hidden, layer })
        if (hidden) hiddenDepth++
        continue
      }
      case ops.endMarkedContent: {
        const top = marked.pop()
        if (top?.hidden) hiddenDepth--
        continue
      }
      case ops.paintImageXObjectRepeat:
      case ops.paintImageMaskXObjectRepeat: {
        if (hiddenDepth > 0 || !args) continue
        // [objId, scaleX, scaleY, positions] or [img, scaleX, skewX, skewY, scaleY, positions]
        const isMask = fn === ops.paintImageMaskXObjectRepeat
        const scaleX = Number(args[1])
        const skewX = isMask ? Number(args[2] ?? 0) : 0
        const skewY = isMask ? Number(args[3] ?? 0) : 0
        const scaleY = Number(isMask ? args[4] : args[2])
        const positions = (isMask ? args[5] : args[3]) as ArrayLike<number> | undefined
        if (!positions || !Number.isFinite(scaleX) || !Number.isFinite(scaleY)) continue
        for (let p = 0; p + 1 < positions.length; p += 2) {
          addImage(multiply(gs.ctm, [scaleX, skewX, skewY, scaleY, positions[p], positions[p + 1]]))
        }
        continue
      }
      case ops.paintInlineImageXObjectGroup: {
        if (hiddenDepth > 0) continue
        const map = args?.[1]
        if (Array.isArray(map)) {
          for (const entry of map) {
            const t = (entry as { transform?: unknown })?.transform
            if (isNumberArray(t) && t.length >= 6) addImage(multiply(gs.ctm, t))
          }
        }
        continue
      }
      case ops.paintImageMaskXObjectGroup: {
        if (hiddenDepth > 0) continue
        const images = args?.[0]
        if (Array.isArray(images)) {
          for (const entry of images) {
            const t = (entry as { transform?: unknown })?.transform
            if (isNumberArray(t) && t.length >= 6) addImage(multiply(gs.ctm, t))
          }
        }
        continue
      }
    }

    if (TEXT.has(fn)) {
      stats.textOps++
      continue
    }
    if (IMAGE.has(fn)) {
      if (hiddenDepth === 0) addImage(gs.ctm)
      continue
    }
    if (fn !== ops.constructPath || !args) continue
    stats.constructPath++
    const paintOp = args[0] as number
    const holder = args[1] as ArrayLike<unknown> | null | undefined
    const data = holder?.[0]
    if (!(Array.isArray(data) || ArrayBuffer.isView(data))) continue
    const isStroke = STROKE.has(paintOp)
    const isFill = FILL.has(paintOp)
    // endPath only clips; rawFillPath only draws glyphs.
    if (!isStroke && !isFill) continue
    if (hiddenDepth > 0) continue
    const path = pathIndex++
    if (isStroke) stats.strokePaths++
    if (isFill) stats.fillPaths++
    const layer = currentLayer()
    const subpaths = walkPath(data as ArrayLike<number>, gs.ctm)
    const lw = gs.lineWidth <= 0 ? 0 : gs.lineWidth * matrixScale(gs.ctm)
    for (const sp of subpaths) {
      if (isFill) {
        // A long thin filled shape is a solid wall, outlined or not: keep its centre line.
        const c = thinPolygonCenterline(sp.outline, minFillLength)
        if (c) {
          const clipped = clipSegment(c.a, c.b, 0, 0, width, height)
          if (clipped) segments.push({ x1: clipped[0].x, y1: clipped[0].y, x2: clipped[1].x, y2: clipped[1].y, width: c.thickness, source: 'fill', path, layer })
          continue
        }
        if (!isStroke) {
          if (sp.outline.length >= 3) stats.otherFills++
          continue
        }
      }
      for (const [a, b] of sp.lines) {
        if (a.x === b.x && a.y === b.y) continue
        const clipped = clipSegment(a, b, 0, 0, width, height)
        if (!clipped) continue
        stats.strokeSegments++
        segments.push({ x1: clipped[0].x, y1: clipped[0].y, x2: clipped[1].x, y2: clipped[1].y, width: lw, source: 'stroke', path, layer })
      }
      for (const run of sp.curves) curves.push({ points: run, width: lw, path, layer })
    }
  }

  stats.imageCoverage = Math.min(1, imageArea / Math.max(1, width * height))
  const texts = input.textItems ? joinTextRuns(readTextItems(input.textItems, viewport)) : []
  return { width, height, pxPerPt, segments, curves, texts, stats }
}

/** page.getTextContent() items to PNG pixels. Empty items and marked content are skipped. */
export function readTextItems(items: readonly unknown[], viewport: ArrayLike<number>): PageText[] {
  const out: PageText[] = []
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as { str?: unknown; transform?: unknown; width?: unknown; height?: unknown }
    if (typeof item.str !== 'string' || !isNumberArray(item.transform) || item.transform.length < 6) continue
    const text = item.str.replace(/\s+/g, ' ').trim()
    if (text === '') continue
    const [a, b, c, d, e, f] = Array.from(item.transform)
    const dirLen = Math.hypot(a, b)
    if (dirLen === 0) continue
    const ux = a / dirLen
    const uy = b / dirLen
    // The text's up direction, at right angles to the baseline on the page.
    const upLen = Math.hypot(c, d)
    let vx = upLen > 0 ? c / upLen : -uy
    let vy = upLen > 0 ? d / upLen : ux
    if (vx * -uy + vy * ux < 0) {
      vx = -vx
      vy = -vy
    }
    const width = typeof item.width === 'number' && item.width > 0 ? item.width : 0
    const fontHeight = typeof item.height === 'number' && item.height > 0 ? item.height : upLen
    const from = applyMatrix(viewport, e, f)
    const to = applyMatrix(viewport, e + ux * width, f + uy * width)
    const center = applyMatrix(viewport, e + (ux * width) / 2 + (vx * fontHeight) / 2, f + (uy * width) / 2 + (vy * fontHeight) / 2)
    const height = fontHeight * matrixScale(viewport)
    const ax = viewport[0] * ux + viewport[2] * uy
    const ay = viewport[1] * ux + viewport[3] * uy
    out.push({ text, from, to, center, height, angle: (Math.atan2(ay, ax) * 180) / Math.PI })
  }
  return out
}

/**
 * Joins pieces of text that sit on one baseline with small gaps ("10.00" and
 * "m", or a label split per character) into one run. Pieces join when they
 * run the same way (to the nearest degree), are about as tall, and the next
 * starts within 0.6 of a letter height after the last ends.
 */
export function joinTextRuns(texts: readonly PageText[]): PageText[] {
  const items = texts.map((t) => ({ ...t, used: false }))
  // By direction, then along the baseline, so each run starts at its first piece.
  const key = (t: PageText) => {
    const bucket = Math.round(t.angle)
    const a = (bucket * Math.PI) / 180
    return { bucket, along: t.from.x * Math.cos(a) + t.from.y * Math.sin(a) }
  }
  const keys = new Map(items.map((t) => [t, key(t)]))
  items.sort((p, q) => {
    const kp = keys.get(p)!
    const kq = keys.get(q)!
    return kp.bucket - kq.bucket || kp.along - kq.along
  })
  const out: PageText[] = []
  for (let i = 0; i < items.length; i++) {
    const head = items[i]
    if (head.used) continue
    head.used = true
    const run: PageText = { text: head.text, from: head.from, to: head.to, center: head.center, height: head.height, angle: head.angle }
    const kh = keys.get(head)!
    const a = (head.angle * Math.PI) / 180
    const ux = Math.cos(a)
    const uy = Math.sin(a)
    const ba = (kh.bucket * Math.PI) / 180
    let endAlong = run.to.x * Math.cos(ba) + run.to.y * Math.sin(ba)
    // One pass in order: pieces are sorted by where they start, and the run only grows forward.
    for (let j = i + 1; j < items.length; j++) {
      const next = items[j]
      const kn = keys.get(next)!
      if (kn.bucket !== kh.bucket || kn.along > endAlong + run.height + 1) break
      if (next.used) continue
      if (Math.abs(next.height - run.height) > 0.25 * run.height) continue
      const dx = next.from.x - run.to.x
      const dy = next.from.y - run.to.y
      const along = dx * ux + dy * uy
      const across = -dx * uy + dy * ux
      if (Math.abs(across) > 0.3 * run.height) continue
      if (along < -0.2 * run.height || along > 0.6 * run.height) continue
      next.used = true
      run.text = along > 0.15 * run.height ? `${run.text} ${next.text}` : `${run.text}${next.text}`
      run.to = next.to
      endAlong = run.to.x * Math.cos(ba) + run.to.y * Math.sin(ba)
    }
    if (run.to !== head.to) {
      // Recentre on the whole run: the middle of the baseline, lifted by half the height.
      const mx = (run.from.x + run.to.x) / 2
      const my = (run.from.y + run.to.y) / 2
      const lift = { x: head.center.x - (head.from.x + head.to.x) / 2, y: head.center.y - (head.from.y + head.to.y) / 2 }
      run.center = { x: mx + lift.x, y: my + lift.y }
    }
    out.push(run)
  }
  return out
}

// ---------------------------------------------------------------- pdf.js glue

/** The parts of the pdfjs module this file uses. */
export type PdfjsLike = { OPS: PdfOps; AnnotationMode: { DISABLE: number } }

/** The parts of a PDFPageProxy this file uses. */
export type PdfPageLike = {
  getViewport(params: { scale: number }): { width: number; height: number; transform: number[] }
  getOperatorList(params?: { annotationMode?: number }): Promise<OperatorListLike>
  getTextContent(): Promise<{ items: unknown[] }>
}

/**
 * Reads a pdf.js page at `scale` (from pageRenderScale in image-size.ts):
 * the same viewport the PNG is rendered with, annotations left out as in the
 * render.
 */
export async function readPdfPage(
  pdfjs: PdfjsLike,
  page: PdfPageLike,
  options: { scale: number; layerNames?: ReadonlyMap<string, string>; isLayerVisible?: (group: unknown) => boolean },
): Promise<PageVectors> {
  const viewport = page.getViewport({ scale: options.scale })
  const [operatorList, text] = await Promise.all([
    page.getOperatorList({ annotationMode: pdfjs.AnnotationMode.DISABLE }),
    page.getTextContent(),
  ])
  return readPageVectors({
    operatorList,
    ops: pdfjs.OPS,
    transform: viewport.transform,
    width: Math.floor(viewport.width),
    height: Math.floor(viewport.height),
    textItems: text.items,
    layerNames: options.layerNames,
    isLayerVisible: options.isLayerVisible,
  })
}
