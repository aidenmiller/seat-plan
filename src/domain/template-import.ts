/**
 * The template editor's side of the floor plan import (spec section 5 steps
 * 5 to 7; PLAN section 7 "Scale" and "Draft and Accept"), and what it says
 * after a template save puts a wall through tables. Pure.
 *
 * Scale: the vector PDF's measured dimension lines when it has any, else the
 * dimension labels the model read. When they agree, the editor shows one
 * labelled line measured at that scale and asks to confirm. Otherwise the
 * draft opens at a first guess and the person clicks two points and types
 * the real distance; the draft is then scaled by real / measured.
 */
import type { CleanSegment } from './floorplan/cleanup'
import { chooseScale, type DimensionLabel, type ScaleCandidate, type ScaleChoice } from './floorplan/scale'
import type { FloorplanDraft } from './floorplan/draft-schema'
import { draftToFixedItems } from './floorplan/to-fixed-items'
import type { TemplateDoc } from './template-commands'
import type { Point } from './geometry'
import { plural } from './wording'
import type { VenueWallCheck } from '@/shared/api'

/** When nothing gives a scale, the image is taken to be this wide (cm) until the person sets it. */
export const GUESS_WIDTH_CM = 3000

/**
 * The labels to work the scale out from: the PDF's own measured dimension
 * lines when there are any (exact), else the model's dimension labels with a
 * value it could read.
 */
export function scaleLabels(measured: readonly DimensionLabel[], draft: Pick<FloorplanDraft, 'dimension_labels'>): DimensionLabel[] {
  if (measured.length > 0) return [...measured]
  return draft.dimension_labels
    .filter((d) => Number.isFinite(d.value_cm) && d.value_cm > 0)
    .map((d) => ({ text: d.text, valueCm: d.value_cm, from: d.from, to: d.to }))
}

export type ScaleStep = {
  choice: ScaleChoice
  /** cm per image pixel the draft opens at. */
  cmPerPx: number
  /** True when the labels agree: the person confirms one labelled line. False: two points are needed. */
  agreed: boolean
  /** The labelled line to show when they agree: the longest one, measured most exactly. */
  confirm: ScaleCandidate | null
  /**
   * When the labels disagree but at least two agree with each other: the
   * longest of those, to offer "Use the 3 that agree". The draft opens at
   * their scale. Null otherwise.
   */
  consensusConfirm: ScaleCandidate | null
}

const longest = (candidates: readonly ScaleCandidate[]): ScaleCandidate | null => [...candidates].sort((a, b) => b.pixels - a.pixels)[0] ?? null

/** The scale the draft opens at, and how the person checks it. */
export function planScale(labels: readonly DimensionLabel[], imageWidth: number): ScaleStep {
  const choice = chooseScale(labels)
  if (choice.status === 'agree' && choice.cmPerPx !== null) {
    return { choice, cmPerPx: choice.cmPerPx, agreed: true, confirm: longest(choice.candidates), consensusConfirm: null }
  }
  const guess = choice.consensus?.cmPerPx ?? GUESS_WIDTH_CM / Math.max(1, imageWidth)
  const consensusConfirm = choice.consensus && choice.consensus.count >= 2 ? longest(choice.consensus.candidates) : null
  return { choice, cmPerPx: guess, agreed: false, confirm: null, consensusConfirm }
}

/**
 * The step after "Use the 3 that agree": the agreeing labels' scale, checked
 * like labels that all agree (one of them drawn, measured, to confirm).
 * The same step when there is nothing to take.
 */
export function takeAgreeingLabels(step: ScaleStep): ScaleStep {
  const consensus = step.choice.consensus
  if (!step.consensusConfirm || !consensus) return step
  return { ...step, cmPerPx: consensus.cmPerPx, agreed: true, confirm: step.consensusConfirm }
}

/**
 * What the scale step says when it cannot simply confirm a label: "The
 * dimension labels differ by 72%. 3 of 4 agree." or that none were found.
 */
export function scaleProblemText(choice: ScaleChoice): string {
  if (choice.status !== 'disagree') return 'No dimension labels were found on the plan.'
  const spread = choice.spreadPercent >= 10 ? Math.round(choice.spreadPercent) : Math.round(choice.spreadPercent * 10) / 10
  const n = choice.candidates.length
  const agree = choice.consensus && choice.consensus.count >= 2 ? ` ${choice.consensus.count} of ${n} agree.` : ' No two of them agree.'
  return `The dimension labels differ by ${spread}%.${agree}`
}

/** "Use the 3 that agree", or "Use the 2 that agree". */
export function agreeingLabelsButton(choice: ScaleChoice): string {
  return `Use the ${choice.consensus?.count ?? 0} that agree`
}

/** What the model sent back and the PDF lines it named: enough to draw the draft again at another scale. */
export type DraftSource = {
  draft: FloorplanDraft
  /** The lines in the stored image's pixels, exactly as the model saw them; [] for a picture or scan. */
  segments: readonly CleanSegment[]
}

/**
 * The draft drawn again from the model's reply at a new scale (cm per image
 * pixel). Setting the scale redraws instead of stretching what was drawn:
 * sizes that were real centimeters from the start (the usual wall thickness,
 * door and window widths, label size) stay right, and the choices made in
 * centimeters (which PDF strokes are thick enough to be a wall's own
 * thickness, which face lines pair into one wall, how far a door reaches for
 * its wall) are made again at the true scale.
 */
export function redrawDraft(source: DraftSource, cmPerPx: number, newId: () => string): { doc: TemplateDoc; skipped: string[] } {
  const converted = draftToFixedItems({ draft: source.draft, segments: source.segments, cmPerPx, newId })
  return { doc: { items: converted.items, reference: converted.reference }, skipped: converted.skipped }
}

/** A labelled line's length (cm) at a scale. */
export function measuredCm(candidate: Pick<ScaleCandidate, 'pixels'>, cmPerPx: number): number {
  return candidate.pixels * cmPerPx
}

/** Image pixels to canvas cm at a scale, as the draft places them (origin at the image's top left). */
export function imageToCanvas(p: Point, cmPerPx: number): Point {
  return { x: p.x * cmPerPx, y: p.y * cmPerPx }
}

/**
 * The factor to scale the draft by after two points were clicked on it
 * (canvas cm at the draft's scale) and the real distance typed. Null when
 * the points are on top of each other or the distance is not a length.
 */
export function twoPointFactor(a: Point, b: Point, realCm: number): number | null {
  const measured = Math.hypot(b.x - a.x, b.y - a.y)
  if (!(measured > 0.5) || !(realCm > 0) || !Number.isFinite(realCm)) return null
  return realCm / measured
}

/** "3 items to check" for the draft's unsure items. */
export function unsureSummary(count: number): string {
  return count === 0 ? 'Nothing marked unsure.' : `${plural(count, 'item')} to check`
}

// ---------------------------------------------------------------- walls through tables

export type WallCheckLayout = VenueWallCheck['layouts'][number]

function key(layoutId: string, tableId: string): string {
  return `${layoutId}:${tableId}`
}

/**
 * The tables a wall runs through now that did not before, by layout, in the
 * order the server listed them. `before` null (not known) counts every
 * crossing as new.
 */
export function newWallCrossings(before: VenueWallCheck | null, after: VenueWallCheck): WallCheckLayout[] {
  const old = new Set<string>()
  for (const layout of before?.layouts ?? []) for (const t of layout.tables) old.add(key(layout.layoutId, t.tableId))
  const out: WallCheckLayout[] = []
  for (const layout of after.layouts) {
    const tables = layout.tables.filter((t) => !old.has(key(layout.layoutId, t.tableId)))
    if (tables.length > 0) out.push({ ...layout, tables })
  }
  return out
}

/**
 * After a save's wall check: the crossings it added, and the check the next
 * save is compared with. Without a baseline (it could not be fetched) nothing
 * is reported, since a crossing that was there before would read as new.
 */
export function advanceWallCheck(baseline: VenueWallCheck | null, check: VenueWallCheck): { fresh: WallCheckLayout[]; baseline: VenueWallCheck } {
  return { fresh: baseline ? newWallCrossings(baseline, check) : [], baseline: check }
}

/** "This change puts a wall through 2 tables in 1 layout". Null when nothing is crossed. */
export function wallCheckMessage(layouts: readonly WallCheckLayout[]): string | null {
  const tables = layouts.reduce((n, l) => n + l.tables.length, 0)
  if (tables === 0) return null
  return `This change puts a wall through ${plural(tables, 'table')} in ${plural(layouts.length, 'layout')}`
}

/** "Table 4 crosses a wall" for the layout editor's Problems tab. */
export function crossingLine(label: string): string {
  return `${label} crosses a wall`
}
