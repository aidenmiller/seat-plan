/**
 * Guest name labels at close level (spec section 4, "Detail levels"; PLAN
 * section 6, "Name labels", and change 17).
 *
 * Each taken seat gets a box that starts just outside its circle and runs
 * outward: from the table's center on round tables, straight out from the
 * edge on square and rect tables. The box ends halfway to whatever lies
 * that way first: another table's chair ring or a wall. In that box the
 * label is the full name if it fits at full size, else the first name and
 * last initial, shrunk down to 10 px on screen, else nothing (the seat
 * circle shows the initials, as at middle level), in the spec's order.
 * Labels turn so they never read upside down.
 *
 * After that, labels of different tables that would still cross (a name
 * running past the side of a neighbor's chairs into that neighbor's names)
 * are cut back to the same length until they clear, and refit. Labels of one
 * table never cross: they fan out from a round table and run side by side
 * from a straight edge, no thicker than the gap between seats.
 *
 * Text widths come from an injected measure(text, fontSizeCm), so the same
 * fitting serves the screen (canvas measureText) and print (font metrics).
 * Font sizes are worked out when the level changes or the zoom settles,
 * never on every frame. Pure: no DOM.
 */
import type { Item, Table } from './canvas-schema'
import { MIN_NAME_PX } from './detail-level'
import { itemFootprint, localToWorld, type Footprint, type Point } from './geometry'
import { initials } from './names'
import { seatLayout, SEAT_RADIUS_CM } from './seats'
import type { FixedItem } from './venue-schema'

/** The width of `text` at `fontSizeCm`, in cm. */
export type MeasureText = (text: string, fontSizeCm: number) => number

export type LabelName = { firstName: string; lastName: string }

/** A wall or other straight obstacle, in canvas cm. halfWidth is half its drawn thickness. */
export type Segment = { a: Point; b: Point; halfWidth?: number }

/** The largest name font, in cm (16 px at 100%). */
export const MAX_LABEL_FONT_CM = 16
/** Space between the seat circle and the start of its name. */
export const LABEL_GAP_CM = 4
/** From a seat's center to where its name starts. */
const START_CM = SEAT_RADIUS_CM + LABEL_GAP_CM
/** A box with nothing in its way still stops here. */
export const MAX_LABEL_ROOM_CM = 250
/** A name is at most this share of the space between its seat and the next seat on the same side. */
const LANE_SHARE = 0.8
/** The height a line of text takes, in multiples of its font size. */
const LINE_HEIGHT_EM = 1.2
const FIT_SLACK = 1e-6

export type LabelForm = 'full' | 'short' | 'initials'

export type SeatLabel = {
  seatIndex: number
  guestId: string
  /** The full name, first name and last initial, or no label (initials inside the seat circle). */
  form: LabelForm
  /** The label's text; for 'initials', the initials the circle shows. */
  text: string
  /** Font size in cm; 0 for 'initials' (the circle draws them as at middle level). */
  fontSize: number
  /** Where the text is anchored on the canvas: the seat end of the box, on the outward line. */
  x: number
  y: number
  /** Degrees clockwise, in (-90, 90], so the text never reads upside down. */
  rotation: number
  /** 'start': the text reads away from the seat. 'end': it reads toward the seat and ends beside it. */
  anchor: 'start' | 'end'
  /** The anchor and turn in the table's own frame, for drawing inside the table's group. */
  local: { x: number; y: number; rotation: number }
  /** The outward direction, degrees clockwise from +x. */
  direction: number
  /** The box's length along the outward line, from the anchor, in cm. */
  room: number
  /** How far the text runs along the line from the anchor, in cm; 0 for 'initials'. */
  length: number
}

export type LabelInput = {
  /** Every table on the canvas. Each one's taken seats get labels; all of them are obstacles. */
  tables: readonly Table[]
  /** Walls (see wallSegments). */
  walls?: readonly Segment[]
  /** The settled zoom: 10 px on screen is 10 / zoom cm. */
  zoom: number
  measure: MeasureText
  /** Names by guest id. Seats whose guest is missing get no label. */
  names: ReadonlyMap<string, LabelName>
}

/** Math.hypot, without its slow paths for huge numbers (none here). */
function len(dx: number, dy: number): number {
  return Math.sqrt(dx * dx + dy * dy)
}

// ---------------------------------------------------------------- names

/** "AB" for Anna Berg (names.ts initials). */
export function initialsFor(guest: LabelName): string {
  return initials(guest.firstName, guest.lastName)
}

export function fullLabel(guest: LabelName): string {
  return `${guest.firstName.trim()} ${guest.lastName.trim()}`.trim()
}

/** "Jane D.": first name and last initial; the first name alone when the last name has no letter. */
export function shortLabel(guest: LabelName): string {
  const first = guest.firstName.trim()
  const m = /\p{L}|\p{N}/u.exec(guest.lastName)
  if (!first) return guest.lastName.trim()
  return m ? `${first} ${m[0].toUpperCase()}.` : first
}

// ---------------------------------------------------------------- walls

function pathSegments(points: readonly Point[], closed: boolean, halfWidth: number, out: Segment[]): void {
  const n = points.length
  if (n < 2) return
  const count = closed && n >= 3 ? n : n - 1
  for (let i = 0; i < count; i++) out.push({ a: points[i], b: points[(i + 1) % n], halfWidth })
}

/**
 * Wall segments in canvas cm from a venue template's walls and room outlines
 * and the canvas's own wall and room shapes (walls and rooms are ordinary
 * shapes on a blank canvas).
 */
export function wallSegments(fixedItems: readonly FixedItem[], items: readonly Item[] = []): Segment[] {
  const out: Segment[] = []
  for (const f of fixedItems) {
    if (f.type === 'wall') pathSegments(f.points, false, f.thickness / 2, out)
    else if (f.type === 'room') pathSegments(f.points, true, 0, out)
  }
  for (const item of items) {
    if (item.kind !== 'shape' || (item.type !== 'wall' && item.type !== 'room')) continue
    const halfWidth = Math.max(item.style.strokeWidth, item.type === 'wall' ? item.height : 0) / 2
    let local: Point[]
    if (item.points && item.points.length >= (item.type === 'room' ? 3 : 2)) local = item.points
    else if (item.type === 'wall') {
      local = [
        { x: -item.width / 2, y: 0 },
        { x: item.width / 2, y: 0 },
      ]
    } else {
      local = [
        { x: -item.width / 2, y: -item.height / 2 },
        { x: item.width / 2, y: -item.height / 2 },
        { x: item.width / 2, y: item.height / 2 },
        { x: -item.width / 2, y: item.height / 2 },
      ]
    }
    pathSegments(
      local.map((p) => localToWorld(item, p)),
      item.type === 'room',
      halfWidth,
      out,
    )
  }
  return out
}

// ---------------------------------------------------------------- rays and boxes

/** A ray from (ox, oy) along the unit vector (dx, dy). */
type Ray = { ox: number; oy: number; dx: number; dy: number }

/** Distance along the ray to a circle grown by `grow`; 0 from inside, Infinity on a miss. */
function rayCircle(ray: Ray, cx: number, cy: number, r: number): number {
  const px = ray.ox - cx
  const py = ray.oy - cy
  const c = px * px + py * py - r * r
  if (c <= 0) return 0
  const b = px * ray.dx + py * ray.dy
  if (b >= 0) return Infinity
  const disc = b * b - c
  if (disc < 0) return Infinity
  return -b - Math.sqrt(disc)
}

/** Distance along the ray to a rectangle (center, half sizes, turn as cos and sin); 0 from inside, Infinity on a miss. */
function rayRect(ray: Ray, cx: number, cy: number, hw: number, hh: number, cos: number, sin: number): number {
  const px = ray.ox - cx
  const py = ray.oy - cy
  // Into the rectangle's frame: turn back by its rotation.
  const lx = px * cos + py * sin
  const ly = -px * sin + py * cos
  const dx = ray.dx * cos + ray.dy * sin
  const dy = -ray.dx * sin + ray.dy * cos
  let tMin = 0
  let tMax = Infinity
  if (Math.abs(dx) < 1e-12) {
    if (lx < -hw || lx > hw) return Infinity
  } else {
    let t1 = (-hw - lx) / dx
    let t2 = (hw - lx) / dx
    if (t1 > t2) [t1, t2] = [t2, t1]
    tMin = Math.max(tMin, t1)
    tMax = Math.min(tMax, t2)
  }
  if (Math.abs(dy) < 1e-12) {
    if (ly < -hh || ly > hh) return Infinity
  } else {
    let t1 = (-hh - ly) / dy
    let t2 = (hh - ly) / dy
    if (t1 > t2) [t1, t2] = [t2, t1]
    tMin = Math.max(tMin, t1)
    tMax = Math.min(tMax, t2)
  }
  return tMin <= tMax ? tMin : Infinity
}

/** An obstacle grown later by each label's half height. */
type Obstacle =
  | { kind: 'circle'; x: number; y: number; r: number; owner: number }
  | { kind: 'rect'; x: number; y: number; hw: number; hh: number; cos: number; sin: number; owner: number; reach: number }

function footprintObstacle(f: Footprint, owner: number): Obstacle {
  if (f.kind === 'circle') return { kind: 'circle', x: f.x, y: f.y, r: f.r, owner }
  const a = (f.rotation * Math.PI) / 180
  return { kind: 'rect', x: f.x, y: f.y, hw: f.halfW, hh: f.halfH, cos: Math.cos(a), sin: Math.sin(a), owner, reach: len(f.halfW, f.halfH) }
}

function segmentObstacle(s: Segment): Obstacle {
  const w = s.halfWidth ?? 0
  const mx = (s.a.x + s.b.x) / 2
  const my = (s.a.y + s.b.y) / 2
  const length = len(s.b.x - s.a.x, s.b.y - s.a.y)
  if (length < 1e-9) return { kind: 'circle', x: mx, y: my, r: w, owner: -1 }
  const cos = (s.b.x - s.a.x) / length
  const sin = (s.b.y - s.a.y) / length
  // A wall's rounded ends are taken as square: a little more room kept clear.
  return { kind: 'rect', x: mx, y: my, hw: length / 2 + w, hh: w, cos, sin, owner: -1, reach: len(length / 2 + w, w) }
}

/** Distance along the ray to the obstacle grown by `grow`, or Infinity. Skips it quickly when it cannot beat `best`. */
function rayObstacle(ray: Ray, o: Obstacle, grow: number, best: number): number {
  if (o.kind === 'circle') return rayCircle(ray, o.x, o.y, o.r + grow)
  // Quick reject on the rectangle's bounding circle.
  const px = o.x - ray.ox
  const py = o.y - ray.oy
  const reach = o.reach + grow * 1.5
  const along = px * ray.dx + py * ray.dy
  if (along < -reach) return Infinity
  const across = Math.abs(px * ray.dy - py * ray.dx)
  if (across > reach) return Infinity
  if (along - reach > best) return Infinity
  return rayRect(ray, o.x, o.y, o.hw + grow, o.hh + grow, o.cos, o.sin)
}

/** A label's box: from (x, y) along (ux, uy) for `length`, `half` to either side. */
type LabelBox = { x: number; y: number; ux: number; uy: number; length: number; half: number }

/** One separating axis test: true when the boxes' shadows on the axis (nx, ny) are apart. */
function apartOn(nx: number, ny: number, tx: number, ty: number, a: LabelBox, ahx: number, b: LabelBox, bhx: number): boolean {
  const ra = ahx * Math.abs(a.ux * nx + a.uy * ny) + a.half * Math.abs(a.ux * ny - a.uy * nx)
  const rb = bhx * Math.abs(b.ux * nx + b.uy * ny) + b.half * Math.abs(b.ux * ny - b.uy * nx)
  return Math.abs(tx * nx + ty * ny) > ra + rb
}

/** True when two label boxes (their first `la` and `lb` cm) overlap. Separating axis test on two rectangles. */
function boxesOverlap(a: LabelBox, la: number, b: LabelBox, lb: number): boolean {
  const ahx = la / 2
  const bhx = lb / 2
  const tx = b.x + b.ux * bhx - (a.x + a.ux * ahx)
  const ty = b.y + b.uy * bhx - (a.y + a.uy * ahx)
  // Quick: bounding circles apart.
  const reach = ahx + a.half + bhx + b.half
  if (tx * tx + ty * ty > reach * reach) return false
  // Axes: each box's length direction and its normal.
  if (apartOn(a.ux, a.uy, tx, ty, a, ahx, b, bhx)) return false
  if (apartOn(-a.uy, a.ux, tx, ty, a, ahx, b, bhx)) return false
  if (apartOn(b.ux, b.uy, tx, ty, a, ahx, b, bhx)) return false
  if (apartOn(-b.uy, b.ux, tx, ty, a, ahx, b, bhx)) return false
  return true
}

/** True when a label box comes within `r` of a table's center. */
function reaches(box: LabelBox, table: { x: number; y: number }, r: number): boolean {
  const h = box.length / 2
  const dx = box.x + box.ux * h - table.x
  const dy = box.y + box.uy * h - table.y
  const range = r + h + box.half
  return dx * dx + dy * dy <= range * range
}

// ---------------------------------------------------------------- fitting

type Fit = { form: LabelForm; text: string; fontSize: number; length: number }

/** The largest font from `maxFont` down to `minFont` at which `text` fits in `room`, or null. */
function fitFont(text: string, room: number, maxFont: number, minFont: number, measure: MeasureText): { fontSize: number; length: number } | null {
  if (text === '' || room <= 0 || maxFont < minFont) return null
  let size = maxFont
  let width = measure(text, size)
  // Text width grows with the font size; a few steps settle a measure that is not quite linear.
  for (let i = 0; i < 4 && width > room * (1 + FIT_SLACK); i++) {
    if (!(width > 0)) break
    size = Math.min(size * (room / width), size * (1 - 1e-9))
    if (size < minFont * (1 - FIT_SLACK)) return null
    width = measure(text, size)
  }
  if (width > room * (1 + FIT_SLACK) || size < minFont * (1 - FIT_SLACK)) return null
  return { fontSize: Math.max(size, minFont), length: width }
}

/** A guest's label texts, each worked out once and only when needed. */
class NameTexts {
  private shortText: string | null = null
  private initialsText: string | null = null
  readonly full: string
  constructor(private readonly name: LabelName) {
    this.full = fullLabel(name)
  }
  get short(): string {
    return (this.shortText ??= shortLabel(this.name))
  }
  get initials(): string {
    return (this.initialsText ??= initialsFor(this.name))
  }
}

/**
 * The spec's order (section 4, "Detail levels"): the full name at full size;
 * if it does not fit, the first name and last initial, shrunk as far as the
 * 10 px floor; then the initials inside the seat circle. A name with no
 * shorter form shrinks itself instead.
 */
function fitName(name: NameTexts, room: number, maxFont: number, minFont: number, measure: MeasureText): Fit {
  const whole = fitFont(name.full, room, maxFont, Math.max(maxFont, minFont), measure)
  if (whole) return { form: 'full', text: name.full, fontSize: whole.fontSize, length: whole.length }
  const shorter = name.short !== name.full
  const text = shorter ? name.short : name.full
  const shrunk = fitFont(text, room, maxFont, minFont, measure)
  if (shrunk) return { form: shorter ? 'short' : 'full', text, fontSize: shrunk.fontSize, length: shrunk.length }
  return { form: 'initials', text: name.initials, fontSize: 0, length: 0 }
}

/** Degrees in (-180, 180]. */
function signedDegrees(d: number): number {
  let a = d % 360
  if (a <= -180) a += 360
  else if (a > 180) a -= 360
  return Math.abs(a) < 1e-9 ? 0 : a
}

// ---------------------------------------------------------------- the layout

type Work = {
  table: number
  seatIndex: number
  guestId: string
  name: NameTexts
  /** Seat center. */
  sx: number
  sy: number
  ux: number
  uy: number
  direction: number
  maxFont: number
  room: number
  fit: Fit
}

/**
 * The space beside each label where it starts: to the next label start on
 * the same side (or round the ring). Labels on one side run side by side;
 * round a table they fan out, so the space only grows further out.
 */
function laneWidths(sides: readonly string[], xs: readonly number[], ys: readonly number[]): number[] {
  const n = sides.length
  const out = new Array<number>(n).fill(Infinity)
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    if (j === i || sides[i] !== sides[j]) continue
    const d = len(xs[i] - xs[j], ys[i] - ys[j])
    if (d < out[i]) out[i] = d
    if (d < out[j]) out[j] = d
  }
  return out
}

/** Labels for every taken seat of every table, by table id, in seat order. */
export function layoutLabels(input: LabelInput): Map<string, SeatLabel[]> {
  const { tables, zoom, measure, names } = input
  const minFont = MIN_NAME_PX / (zoom > 0 ? zoom : 1e-9)
  const obstacles: Obstacle[] = tables.map((t, i) => footprintObstacle(itemFootprint(t), i))
  for (const s of input.walls ?? []) obstacles.push(segmentObstacle(s))

  // 1. Each label's box, from its seat to halfway to the first obstacle out that way.
  const work: Work[] = []
  const reach = new Float64Array(tables.length)
  tables.forEach((table, ti) => {
    let any = false
    for (const seat of table.seats) {
      if (seat.guestId !== null && names.has(seat.guestId)) {
        any = true
        break
      }
    }
    if (!any) return
    // Only obstacles a label could reach: a box ends halfway to what it meets, and is at most MAX_LABEL_ROOM_CM long.
    const own = obstacles[ti]
    const ownReach = own.kind === 'circle' ? own.r : own.reach
    const range = ownReach + 2 * (START_CM + MAX_LABEL_ROOM_CM) + MAX_LABEL_FONT_CM * LINE_HEIGHT_EM
    const near: Obstacle[] = []
    for (const o of obstacles) {
      if (o.owner === ti) continue
      const r = o.kind === 'circle' ? o.r : o.reach
      if (len(o.x - own.x, o.y - own.y) - r <= range) near.push(o)
    }
    const places = seatLayout(table)
    const directions = places.map((p) => signedDegrees(p.angle + 180))
    const uxs = directions.map((d) => Math.cos((d * Math.PI) / 180))
    const uys = directions.map((d) => Math.sin((d * Math.PI) / 180))
    const lanes = laneWidths(
      places.map((p) => p.side),
      places.map((p, i) => p.x + uxs[i] * START_CM),
      places.map((p, i) => p.y + uys[i] * START_CM),
    )
    for (const place of places) {
      const guestId = table.seats[place.index]?.guestId ?? null
      if (guestId === null) continue
      const known = names.get(guestId)
      if (!known) continue
      const name = new NameTexts(known)
      const direction = directions[place.index]
      const ux = uxs[place.index]
      const uy = uys[place.index]
      const maxFont = Math.min(MAX_LABEL_FONT_CM, lanes[place.index] * LANE_SHARE)
      const half = (maxFont * LINE_HEIGHT_EM) / 2
      const ray: Ray = { ox: place.x, oy: place.y, dx: ux, dy: uy }
      let hit = Infinity
      for (const o of near) {
        const t = rayObstacle(ray, o, half, hit)
        if (t < hit) hit = t
      }
      const end = hit === Infinity ? Infinity : SEAT_RADIUS_CM + (hit - SEAT_RADIUS_CM) / 2
      const room = Math.max(0, Math.min(MAX_LABEL_ROOM_CM, end - START_CM))
      const fit = fitName(name, room, maxFont, minFont, measure)
      work.push({ table: ti, seatIndex: place.index, guestId, name, sx: place.x, sy: place.y, ux, uy, direction, maxFont, room, fit })
      const far = len(place.x - table.x, place.y - table.y) + START_CM + fit.length + half
      if (far > reach[ti]) reach[ti] = far
    }
  })

  // 2. Labels of different tables that still cross are cut back to one length until they clear.
  const boxes: LabelBox[] = work.map((w) => ({
    x: w.sx + w.ux * START_CM,
    y: w.sy + w.uy * START_CM,
    ux: w.ux,
    uy: w.uy,
    length: w.fit.length,
    half: (w.fit.fontSize * LINE_HEIGHT_EM) / 2,
  }))
  const byTable: number[][] = tables.map(() => [])
  work.forEach((w, i) => {
    if (w.fit.length > 0) byTable[w.table].push(i)
  })
  for (let ta = 0; ta < tables.length; ta++) {
    if (byTable[ta].length === 0) continue
    for (let tb = ta + 1; tb < tables.length; tb++) {
      if (byTable[tb].length === 0) continue
      const d = len(tables[ta].x - tables[tb].x, tables[ta].y - tables[tb].y)
      if (d > reach[ta] + reach[tb]) continue
      // Only labels that reach into the other table's reach can cross its labels.
      const nearA = byTable[ta].filter((i) => reaches(boxes[i], tables[tb], reach[tb]))
      if (nearA.length === 0) continue
      const nearB = byTable[tb].filter((i) => reaches(boxes[i], tables[ta], reach[ta]))
      for (const ia of nearA) {
        const a = boxes[ia]
        for (const ib of nearB) {
          const b = boxes[ib]
          if (a.length <= 0 || b.length <= 0 || !boxesOverlap(a, a.length, b, b.length)) continue
          // The longest common length at which the two boxes clear.
          let lo = 0
          let hi = Math.max(a.length, b.length)
          for (let k = 0; k < 18; k++) {
            const mid = (lo + hi) / 2
            if (boxesOverlap(a, Math.min(a.length, mid), b, Math.min(b.length, mid))) hi = mid
            else lo = mid
          }
          // Refit no larger than before, so the label only shrinks and pairs already cleared stay clear.
          for (const i of [ia, ib]) {
            const w = work[i]
            if (w.fit.length <= lo) continue
            w.room = Math.min(w.room, lo)
            w.fit = fitName(w.name, w.room, w.fit.fontSize, minFont, measure)
            boxes[i].length = w.fit.length
            boxes[i].half = (w.fit.fontSize * LINE_HEIGHT_EM) / 2
          }
        }
      }
    }
  }

  // 3. Turned upright, with the same anchor in the table's frame.
  const out = new Map<string, SeatLabel[]>()
  for (const t of tables) out.set(t.id, [])
  for (const w of work) {
    const table = tables[w.table]
    const ax = w.sx + w.ux * START_CM
    const ay = w.sy + w.uy * START_CM
    const flip = !(w.direction > -90 && w.direction <= 90)
    const rotation = flip ? signedDegrees(w.direction + 180) : w.direction
    const lrad = (-table.rotation * Math.PI) / 180
    const dx = ax - table.x
    const dy = ay - table.y
    const lx = dx * Math.cos(lrad) - dy * Math.sin(lrad)
    const ly = dx * Math.sin(lrad) + dy * Math.cos(lrad)
    out.get(table.id)!.push({
      seatIndex: w.seatIndex,
      guestId: w.guestId,
      form: w.fit.form,
      text: w.fit.text,
      fontSize: w.fit.fontSize,
      x: ax,
      y: ay,
      rotation,
      anchor: flip ? 'end' : 'start',
      local: { x: lx, y: ly, rotation: signedDegrees(rotation - table.rotation) },
      direction: w.direction,
      room: w.room,
      length: w.fit.length,
    })
  }
  return out
}

/** A label's box on the canvas as four corners (for tests and debugging): the text's extent, or nothing for initials. */
export function labelCorners(label: SeatLabel): Point[] {
  if (label.form === 'initials' || label.length <= 0) return []
  const rad = (label.direction * Math.PI) / 180
  const ux = Math.cos(rad)
  const uy = Math.sin(rad)
  const half = (label.fontSize * LINE_HEIGHT_EM) / 2
  const nx = -uy * half
  const ny = ux * half
  const ex = ux * label.length
  const ey = uy * label.length
  return [
    { x: label.x + nx, y: label.y + ny },
    { x: label.x + ex + nx, y: label.y + ey + ny },
    { x: label.x + ex - nx, y: label.y + ey - ny },
    { x: label.x - nx, y: label.y - ny },
  ]
}

/** True when two labels' text boxes overlap (separating axis test). */
export function labelsOverlap(a: SeatLabel, b: SeatLabel): boolean {
  if (a.length <= 0 || b.length <= 0) return false
  const box = (l: SeatLabel): LabelBox => {
    const rad = (l.direction * Math.PI) / 180
    return { x: l.x, y: l.y, ux: Math.cos(rad), uy: Math.sin(rad), length: l.length, half: (l.fontSize * LINE_HEIGHT_EM) / 2 }
  }
  const ba = box(a)
  const bb = box(b)
  return boxesOverlap(ba, ba.length, bb, bb.length)
}
