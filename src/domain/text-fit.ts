/**
 * Sizing and turning the text drawn inside items, worked out from the item
 * alone (no DOM, so no text measuring): a table's name and seat count, a
 * fixture's label. Widths are estimates from per-character shares of the
 * font size for the usual system sans fonts, a little generous so text stays
 * inside its item.
 *
 * Every size is in world units (cm), so text scales with the plan like
 * everything else in the world SVG.
 */
import type { Table } from './canvas-schema'

/** The smallest text drawn inside an item, in cm. Smaller text is cut short with an ellipsis instead. */
export const MIN_ITEM_FONT_CM = 6

const NARROW = new Set("iljtfrI1|!.,:;'`()[]{} ".split(''))
const WIDE = new Set('mwMW@%&'.split(''))

/** The rough width of `text` in ems (multiples of the font size). */
export function textWidthEm(text: string): number {
  let em = 0
  for (const ch of text) {
    if (NARROW.has(ch)) em += 0.32
    else if (WIDE.has(ch)) em += 0.9
    else if (ch >= 'A' && ch <= 'Z') em += 0.68
    else if (ch >= '0' && ch <= '9') em += 0.58
    else em += 0.56
  }
  return em
}

export type FittedText = { text: string; fontSize: number }

/**
 * The largest font size, up to `maxFont`, at which `text` fits in `maxWidth`.
 * Below `minFont` the text stays at `minFont` and is cut short with an ellipsis.
 */
export function fitText(text: string, maxWidth: number, maxFont: number, minFont: number = MIN_ITEM_FONT_CM): FittedText {
  const clean = text.trim()
  const floor = Math.min(minFont, maxFont)
  if (clean === '') return { text: '', fontSize: maxFont }
  const em = textWidthEm(clean)
  const size = Math.min(maxFont, maxWidth / em)
  if (size >= floor) return { text: clean, fontSize: size }
  const room = Math.max(0, maxWidth / floor - textWidthEm('…'))
  let used = 0
  let cut = ''
  for (const ch of clean) {
    const w = textWidthEm(ch)
    if (used + w > room) break
    used += w
    cut += ch
  }
  return { text: cut.trimEnd() === '' ? '…' : `${cut.trimEnd()}…`, fontSize: floor }
}

/** Degrees in (-90, 90]: the same line turned so it never reads upside down. */
export function uprightAngle(degrees: number): number {
  let a = ((degrees % 360) + 360) % 360
  if (a > 180) a -= 360
  if (a > 90) a -= 180
  else if (a <= -90) a += 180
  return a === 0 ? 0 : a
}

/**
 * The turn to give text inside an item's own (already rotated) frame, so it
 * reads upright on the canvas. Round tables keep their text level. Other
 * items run it along their long side, flipped when it would read upside down.
 */
export function labelRotation(item: { rotation: number; width: number; height: number }, keepLevel = false): number {
  if (keepLevel) return clean(-item.rotation)
  const along = item.height > item.width ? 90 : 0
  return clean(uprightAngle(item.rotation + along) - item.rotation)
}

function clean(v: number): number {
  const r = Math.round(v * 1e6) / 1e6
  return r === 0 ? 0 : r
}

/** True when a turn of `degrees` runs text across the item's height rather than its width. */
export function runsAcross(degrees: number): boolean {
  const a = ((Math.round(degrees) % 180) + 180) % 180
  return a > 45 && a < 135
}

export type CenterLabels = {
  /** Degrees, in the item's own frame. */
  rotation: number
  name: FittedText & { y: number }
  count: FittedText & { y: number }
}

/** "6/8": taken seats over seats. */
export function seatCountText(table: Pick<Table, 'seats' | 'seatCount'>): string {
  let taken = 0
  for (const seat of table.seats) if (seat.guestId !== null) taken++
  return `${taken}/${table.seatCount}`
}

/**
 * A table's name and seat count, on two lines in its middle (spec section 4,
 * "Detail levels"): as large as fits, never past 40 cm for the name.
 */
export function tableCenterLabels(table: Pick<Table, 'shape' | 'width' | 'height' | 'rotation' | 'name' | 'number' | 'seats' | 'seatCount'>): CenterLabels {
  const round = table.shape === 'round'
  const rotation = labelRotation(table, round)
  let along: number
  let across: number
  if (round) {
    along = table.width * 0.78
    across = table.width * 0.62
  } else if (runsAcross(rotation)) {
    along = table.height * 0.9
    across = table.width * 0.86
  } else {
    along = table.width * 0.9
    across = table.height * 0.86
  }
  const nameMax = Math.max(1, Math.min(40, across * 0.38))
  const countMax = Math.max(1, Math.min(32, nameMax * 0.8))
  const name = fitText(table.name.trim() || `Table ${table.number}`, along, nameMax)
  const count = fitText(seatCountText(table), along, countMax)
  const gap = name.fontSize * 0.2
  const total = name.fontSize + gap + count.fontSize
  const nameY = -total / 2 + name.fontSize / 2
  const countY = nameY + name.fontSize / 2 + gap + count.fontSize / 2
  return { rotation, name: { ...name, y: clean(nameY) }, count: { ...count, y: clean(countY) } }
}

export type IconAndLabel = {
  rotation: number
  /** Icon box side, cm, centered at (0, iconY). Zero when there is no room for it. */
  iconSize: number
  iconY: number
  label: FittedText & { y: number }
}

/** A fixture's icon above its label, as large as fits in its box. */
export function iconAndLabel(item: { width: number; height: number; rotation: number }, label: string): IconAndLabel {
  const rotation = labelRotation(item)
  const across = runsAcross(rotation)
  const along = (across ? item.height : item.width) * 0.86
  const depth = (across ? item.width : item.height) * 0.84
  const hasLabel = label.trim() !== ''
  let iconSize = Math.max(0, Math.min(90, Math.min(along, depth) * (hasLabel ? 0.42 : 0.6)))
  let fitted: FittedText = hasLabel ? fitText(label, along, Math.min(30, depth * 0.26)) : { text: '', fontSize: 0 }
  let gap = hasLabel ? Math.min(iconSize, fitted.fontSize) * 0.3 : 0
  let total = iconSize + gap + fitted.fontSize
  if (total > depth && total > 0) {
    const scale = depth / total
    iconSize *= scale
    gap *= scale
    if (hasLabel) fitted = fitText(label, along, Math.max(MIN_ITEM_FONT_CM, fitted.fontSize * scale))
    total = iconSize + gap + fitted.fontSize
  }
  // Too small for an icon anyone could read: the label alone.
  if (iconSize < 8) {
    iconSize = 0
    gap = 0
    total = fitted.fontSize
  }
  const top = -total / 2
  return {
    rotation,
    iconSize: clean(iconSize),
    iconY: clean(top + iconSize / 2),
    label: { ...fitted, y: clean(top + iconSize + gap + fitted.fontSize / 2) },
  }
}
