/**
 * Turns a checked draft from the model into the template's fixed items, in
 * centimeters (spec section 5 steps 4 to 6, PLAN change 21).
 *
 *  - Image pixels become canvas cm: (p - origin) * cmPerPx. The reference
 *    layer's placement comes back with the items, so the faded original lines
 *    up under them.
 *  - Walls given by segment ids are built from the PDF's own lines: double
 *    face lines become one centre line, pieces sharing ends join into one
 *    polyline, and the thickness comes from the PDF when it was drawn solid
 *    or thick, else from the model, else 15 cm. Walls given by points (a
 *    scan or picture) are straightened within 2 degrees and their loose ends
 *    joined. In a vector PDF the walls come from its lines (PLAN change 21),
 *    so a wall the model gave as points there is either a retype of lines
 *    another wall already uses (left out) or drawn by the model alone
 *    (kept, marked unsure, so the person checks it).
 *  - Doors and windows snap onto their wall: onto the line of the wall the
 *    model named (or the nearest one), and into the opening when they sit in
 *    a gap of the wall's line. One that is near no wall keeps its place and
 *    is marked unsure.
 *  - Items the model marked unsure stay, with its note.
 * Items that cannot be drawn (too few points, no size) are left out and
 * listed in `skipped`. Every item is checked with fixedItemSchema.
 */
import { wellFormedText } from '../canvas-schema'
import { normalizeDegrees, type Point } from '../geometry'
import { polylineLength, projectOntoWall, wallGapAt, wallSegments } from '../fixed-items'
import { fixedItemSchema, type FixedItem, type ReferenceMeta } from '../venue-schema'
import { chainSegments, pairParallelLines, type CleanSegment } from './cleanup'
import type { FloorplanDraft } from './draft-schema'

export const DEFAULT_WALL_THICKNESS_CM = 15
/** A PDF line at least this thick (in cm) is the wall's real thickness. */
const MIN_DRAWN_WALL_CM = 5
const DEFAULT_DOOR_WIDTH_CM = 90
const DEFAULT_WINDOW_WIDTH_CM = 120
const DEFAULT_LABEL_SIZE_CM = 30
/** Double face lines further apart than this are two walls. */
const MAX_DOUBLE_LINE_GAP_CM = 60
/** Loose ends of drawn walls closer than this join. */
const JOIN_ENDS_CM = 10
const REFERENCE_OPACITY = 0.5
/** A point wall within this many image pixels of PDF lines (beyond half their thickness) retypes them. */
const RETYPE_TOLERANCE_PX = 8
/** The unsure note on a wall the model drew by points over a vector PDF. */
export const MODEL_DRAWN_WALL_NOTE = 'Drawn by the AI, not from the PDF lines'

export type ConvertInput = {
  draft: FloorplanDraft
  /** The cleaned PDF lines the prompt listed; [] for a scan or picture. */
  segments?: readonly CleanSegment[]
  cmPerPx: number
  /** The image pixel that becomes canvas (0, 0). Default: the top left corner. */
  origin?: Point
  /** Makes fixed item ids. Default: crypto.randomUUID. */
  newId?: () => string
}

export type ConvertResult = {
  items: FixedItem[]
  /** Where the original image sits under the items. */
  reference: ReferenceMeta
  /** The model's wall ids to the fixed walls made from them. */
  wallIds: Record<string, string[]>
  /** Items left out, in a few words each. */
  skipped: string[]
  /** How many items are marked unsure. */
  unsure: number
}

function cleanText(text: string, max: number): string {
  return wellFormedText(text).replace(/\s+/g, ' ').trim().slice(0, max)
}

function joinNotes(a: string, b: string): string {
  return cleanText(a === '' ? b : `${a}. ${b}`, 500)
}

function dedupe(points: readonly Point[]): Point[] {
  const out: Point[] = []
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
    const last = out[out.length - 1]
    if (last && Math.abs(last.x - p.x) < 1e-6 && Math.abs(last.y - p.y) < 1e-6) continue
    out.push(p)
  }
  return out
}

/** Outline corners without the closing repeat of the first. */
function openOutline(points: readonly Point[]): Point[] {
  const out = dedupe(points)
  while (out.length > 1) {
    const a = out[0]
    const b = out[out.length - 1]
    if (Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6) out.pop()
    else break
  }
  return out
}

/** Each segment within `tolDeg` of level or plumb is made exactly so. */
function straightenPolyline(points: Point[], tolDeg: number): Point[] {
  const out = points.map((p) => ({ ...p }))
  const tol = Math.sin((tolDeg * Math.PI) / 180)
  for (let i = 0; i + 1 < out.length; i++) {
    const a = out[i]
    const b = out[i + 1]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len === 0) continue
    if (Math.abs(b.y - a.y) / len <= tol) {
      const y = (a.y + b.y) / 2
      a.y = y
      b.y = y
    } else if (Math.abs(b.x - a.x) / len <= tol) {
      const x = (a.x + b.x) / 2
      a.x = x
      b.x = x
    }
  }
  return out
}

/**
 * Joins the loose ends of drawn walls that come within `tol` of each other.
 * The joined point takes its x from ends whose wall piece is plumb and its y
 * from ends whose piece is level, so straightened pieces stay straight.
 */
function joinLooseEnds(walls: { points: Point[] }[], tol: number): void {
  type End = { w: number; i: number; plumb: boolean; level: boolean }
  const ends: End[] = []
  walls.forEach((w, k) => {
    const n = w.points.length
    if (n < 2) return
    for (const [i, j] of [
      [0, 1],
      [n - 1, n - 2],
    ]) {
      const a = w.points[i]
      const b = w.points[j]
      ends.push({ w: k, i, plumb: a.x === b.x && a.y !== b.y, level: a.y === b.y && a.x !== b.x })
    }
  })
  const done = new Set<number>()
  for (let a = 0; a < ends.length; a++) {
    if (done.has(a)) continue
    const pa = walls[ends[a].w].points[ends[a].i]
    const group = [a]
    for (let b = a + 1; b < ends.length; b++) {
      if (done.has(b)) continue
      // A straight wall's own two ends never join: that would shrink it to a point.
      if (ends[b].w === ends[a].w && walls[ends[a].w].points.length < 3) continue
      const pb = walls[ends[b].w].points[ends[b].i]
      if (Math.hypot(pa.x - pb.x, pa.y - pb.y) <= tol) group.push(b)
    }
    if (group.length < 2) continue
    const mean = (values: number[]) => values.reduce((t, v) => t + v, 0) / values.length
    const at = (g: number) => walls[ends[g].w].points[ends[g].i]
    const plumb = group.filter((g) => ends[g].plumb)
    const level = group.filter((g) => ends[g].level)
    const x = mean((plumb.length > 0 ? plumb : group).map((g) => at(g).x))
    const y = mean((level.length > 0 ? level : group).map((g) => at(g).y))
    for (const g of group) {
      done.add(g)
      walls[ends[g].w].points[ends[g].i] = { x, y }
    }
  }
}

function pointToSegment(p: Point, g: CleanSegment): number {
  const dx = g.x2 - g.x1
  const dy = g.y2 - g.y1
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - g.x1) * dx + (p.y - g.y1) * dy) / len2))
  return Math.hypot(p.x - (g.x1 + t * dx), p.y - (g.y1 + t * dy))
}

/**
 * True when every piece of a wall given by points (image pixels) runs along
 * these PDF lines: each of nine points spread along each piece lies within a
 * few pixels of one of them.
 */
function runsAlong(points: readonly Point[], lines: readonly CleanSegment[]): boolean {
  if (points.length < 2 || lines.length === 0) return false
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]
    const b = points[i + 1]
    for (let k = 0; k <= 8; k++) {
      const p = { x: a.x + ((b.x - a.x) * k) / 8, y: a.y + ((b.y - a.y) * k) / 8 }
      if (!lines.some((g) => pointToSegment(p, g) <= RETYPE_TOLERANCE_PX + g.thickness / 2)) return false
    }
  }
  return true
}

/** Draft into fixed items; see the file comment. */
export function draftToFixedItems(input: ConvertInput): ConvertResult {
  const { draft } = input
  const s = input.cmPerPx
  if (!(s > 0) || !Number.isFinite(s)) throw new Error('The scale must be a positive number of cm per pixel.')
  const origin = input.origin ?? { x: 0, y: 0 }
  const newId = input.newId ?? (() => globalThis.crypto.randomUUID())
  const toCm = (p: Point): Point => ({ x: (p.x - origin.x) * s, y: (p.y - origin.y) * s })
  const lenCm = (px: number) => (Number.isFinite(px) && px > 0 ? px * s : 0)
  const skipped: string[] = []
  const byId = new Map((input.segments ?? []).map((g) => [g.id, g]))
  const usedSegments = new Set<string>()

  const areas: FixedItem[] = []
  const walls: FixedItem[] = []
  const boxes: FixedItem[] = []
  const openings: FixedItem[] = []
  const labels: FixedItem[] = []
  const wallIds: Record<string, string[]> = {}

  const flags = (item: { unsure: boolean; unsure_note: string }) => ({
    unsure: item.unsure,
    unsureNote: item.unsure ? cleanText(item.unsure_note, 500) : '',
  })

  // ---- walls: first those built from the PDF's lines, so a wall the model
  // also typed out by points can be told apart as a repeat.
  const vector = byId.size > 0
  const drawn: { draftId: string; points: Point[]; thickness: number; flags: ReturnType<typeof flags> }[] = []
  const pointWalls: FloorplanDraft['walls'] = []
  for (const w of draft.walls) {
    const segs: CleanSegment[] = []
    for (const id of w.segment_ids) {
      const g = byId.get(id)
      if (!g) {
        skipped.push(`Wall ${w.id || '(no id)'}: no line ${id}`)
        continue
      }
      if (usedSegments.has(id)) continue
      usedSegments.add(id)
      segs.push(g)
    }
    const modelCm = lenCm(w.thickness_px)
    const made: string[] = []
    if (segs.length > 0) {
      const maxGapPx = Math.max(modelCm * 1.5, MAX_DOUBLE_LINE_GAP_CM) / s
      const centred = pairParallelLines(segs, maxGapPx)
      const chains = chainSegments(centred, Math.max(1, 2 / s))
      for (const chain of chains) {
        const pdfCm = chain.thickness * s
        const thickness = pdfCm >= MIN_DRAWN_WALL_CM ? pdfCm : modelCm >= 1 ? modelCm : DEFAULT_WALL_THICKNESS_CM
        const item = { id: newId(), type: 'wall' as const, points: chain.points.map(toCm), thickness, ...flags(w) }
        walls.push(item)
        made.push(item.id)
      }
    } else if (w.points.length > 0) {
      pointWalls.push(w)
    } else if (w.segment_ids.length === 0) {
      skipped.push(`Wall ${w.id || '(no id)'}: no lines and no points`)
    }
    if (w.id !== '' && made.length > 0) wallIds[w.id] = [...(wallIds[w.id] ?? []), ...made]
  }
  const usedLines = [...usedSegments].map((id) => byId.get(id)!)
  for (const w of pointWalls) {
    if (vector && runsAlong(w.points, usedLines)) {
      skipped.push(`Wall ${w.id || '(no id)'}: repeats PDF lines another wall already uses`)
      continue
    }
    const points = dedupe(w.points.map(toCm))
    if (points.length < 2) {
      skipped.push(`Wall ${w.id || '(no id)'}: fewer than 2 points`)
      continue
    }
    const modelCm = lenCm(w.thickness_px)
    const f = flags(w)
    // Over a vector PDF the person checks a wall the model drew itself (PLAN change 21).
    const checked = vector ? { unsure: true, unsureNote: joinNotes(f.unsureNote, MODEL_DRAWN_WALL_NOTE) } : f
    drawn.push({ draftId: w.id, points: straightenPolyline(points, 2), thickness: modelCm >= 1 ? modelCm : DEFAULT_WALL_THICKNESS_CM, flags: checked })
  }
  joinLooseEnds(drawn, JOIN_ENDS_CM)
  for (const d of drawn) {
    const first = d.points[0]
    const last = d.points[d.points.length - 1]
    const points = d.points.length >= 3 && Math.hypot(first.x - last.x, first.y - last.y) <= JOIN_ENDS_CM ? [...d.points.slice(0, -1), first] : d.points
    if (polylineLength(points) < 1) {
      skipped.push(`Wall ${d.draftId || '(no id)'}: too short`)
      continue
    }
    const item = { id: newId(), type: 'wall' as const, points, thickness: d.thickness, ...d.flags }
    walls.push(item)
    if (d.draftId !== '') wallIds[d.draftId] = [...(wallIds[d.draftId] ?? []), item.id]
  }

  // ---- rooms, zones, patio edges
  for (const [kind, list] of [
    ['room', draft.rooms],
    ['zone', draft.zones],
  ] as const) {
    for (const r of list) {
      const points = openOutline(r.points.map(toCm))
      if (points.length < 3) {
        skipped.push(`${kind === 'room' ? 'Room' : 'Zone'} ${r.name || '(no name)'}: fewer than 3 corners`)
        continue
      }
      const name = cleanText(r.name, 200)
      areas.push({ id: newId(), type: kind, points, ...(name ? { name } : {}), ...flags(r) })
    }
  }
  for (const e of draft.patio_edges) {
    const points = dedupe(e.points.map(toCm))
    if (points.length < 2) {
      skipped.push('Patio edge: fewer than 2 points')
      continue
    }
    areas.push({ id: newId(), type: 'patioEdge', points, ...flags(e) })
  }

  // ---- columns, stairs, bars
  const boxOf = (b: { center: Point; width_px: number; height_px: number; rotation: number }) => {
    const c = toCm(b.center)
    return { x: c.x, y: c.y, width: lenCm(b.width_px), height: lenCm(b.height_px), rotation: Number.isFinite(b.rotation) ? normalizeDegrees(b.rotation) : 0 }
  }
  for (const c of draft.columns) {
    const b = boxOf(c)
    if (!(b.width > 0 && b.height > 0)) {
      skipped.push('Column: no size')
      continue
    }
    boxes.push({ id: newId(), type: 'column', shape: c.shape === 'round' ? 'round' : 'rect', ...b, ...flags(c) })
  }
  for (const st of draft.stairs) {
    const b = boxOf(st)
    if (!(b.width > 0 && b.height > 0)) {
      skipped.push('Stairs: no size')
      continue
    }
    boxes.push({ id: newId(), type: 'stairs', ...b, ...flags(st) })
  }
  for (const bar of draft.bars) {
    const b = boxOf(bar)
    if (!(b.width > 0 && b.height > 0)) {
      skipped.push('Bar: no size')
      continue
    }
    boxes.push({ id: newId(), type: 'bar', ...b, label: cleanText(bar.label, 200), ...flags(bar) })
  }

  // ---- doors and windows
  const allWallSegs = wallSegments(walls)
  const place = (o: { position: Point; width_px: number; rotation: number; wall_id: string; segment_ids: string[] }, fallbackWidth: number) => {
    const at = toCm(o.position)
    let width = lenCm(o.width_px)
    if (!(width > 0)) {
      // The longest of its own lines, else the usual size.
      let longest = 0
      for (const id of o.segment_ids) {
        const g = byId.get(id)
        if (g) longest = Math.max(longest, Math.hypot(g.x2 - g.x1, g.y2 - g.y1) * s)
      }
      width = longest > 0 ? longest : fallbackWidth
    }
    const prefer = Number.isFinite(o.rotation) ? o.rotation : undefined
    const reach = Math.max(60, width)
    const named = new Set(wallIds[o.wall_id] ?? [])
    const namedSegs = allWallSegs.filter((g) => named.has(g.wallId))
    const hit =
      (namedSegs.length > 0 ? projectOntoWall(at, namedSegs, { maxDistance: reach, preferRotation: prefer }) : null) ??
      projectOntoWall(at, allWallSegs, { maxDistance: reach, preferRotation: prefer })
    if (!hit) return { x: at.x, y: at.y, width, rotation: prefer === undefined ? 0 : normalizeDegrees(prefer), wallId: null, onWall: false }
    let x = hit.x
    let y = hit.y
    const gap = wallGapAt({ x, y }, allWallSegs, { lineTol: 2, maxGap: Math.max(width * 2.5, 150), minGap: width * 0.4 })
    if (gap) {
      x = gap.middle.x
      y = gap.middle.y
      width = gap.width
    }
    return { x, y, width, rotation: hit.rotation, wallId: hit.wallId, onWall: true }
  }
  for (const d of draft.doors) {
    const p = place(d, DEFAULT_DOOR_WIDTH_CM)
    const f = flags(d)
    const swing = d.swing === 'unknown' ? 'left' : d.swing
    openings.push({
      id: newId(),
      type: 'door',
      wallId: p.wallId,
      x: p.x,
      y: p.y,
      rotation: p.rotation,
      width: p.width,
      swing,
      ...(p.onWall ? f : { unsure: true, unsureNote: joinNotes(f.unsureNote, 'Not on a wall') }),
    })
  }
  for (const w of draft.windows) {
    const p = place(w, DEFAULT_WINDOW_WIDTH_CM)
    const f = flags(w)
    openings.push({
      id: newId(),
      type: 'window',
      wallId: p.wallId,
      x: p.x,
      y: p.y,
      rotation: p.rotation,
      width: p.width,
      ...(p.onWall ? f : { unsure: true, unsureNote: joinNotes(f.unsureNote, 'Not on a wall') }),
    })
  }

  // ---- labels
  for (const l of draft.labels) {
    const text = cleanText(l.text, 500)
    if (text === '') {
      skipped.push('Label: no text')
      continue
    }
    const c = toCm(l.position)
    const size = lenCm(l.height_px)
    labels.push({ id: newId(), type: 'label', x: c.x, y: c.y, rotation: 0, text, fontSize: size > 0 ? size : DEFAULT_LABEL_SIZE_CM, ...flags(l) })
  }

  // Drawing order: areas under walls, openings over walls, labels on top.
  const items: FixedItem[] = []
  for (const item of [...areas, ...walls, ...boxes, ...openings, ...labels]) {
    const checked = fixedItemSchema.safeParse(item)
    if (checked.success) items.push(checked.data)
    else skipped.push(`${item.type}: ${checked.error.issues[0]?.message ?? 'not valid'}`)
  }
  return {
    items,
    reference: { scaleCmPerPx: s, offsetX: 0 - origin.x * s, offsetY: 0 - origin.y * s, rotation: 0, opacity: REFERENCE_OPACITY },
    wallIds,
    skipped,
    unsure: items.filter((i) => i.unsure).length,
  }
}
