/**
 * The floor plan import's request body (POST /api/venues/:id/import), built
 * from what the browser read off the plan. Pure, so it is tested without a
 * browser.
 *
 * Lines, text and door hints are in the pixels of the image the browser
 * rendered; the uploaded image has the same size (the server reads its size
 * from the bytes), and if it ever does not, everything is scaled to it.
 * Coordinates are rounded to a tenth of a pixel, text is cut to 200
 * characters, and each list is capped at what the route takes.
 */
import type { CleanSegment, DoorHint } from '@/domain/floorplan/cleanup'
import type { DimensionLabel } from '@/domain/floorplan/scale'
import type { Point } from '@/domain/geometry'
import { MAX_IMPORT_DOOR_HINTS, MAX_IMPORT_LABELS, MAX_IMPORT_SEGMENTS, type FloorplanImportBody } from '@/shared/api'

/** What the browser read off one plan: the picture's size, and for a vector PDF its lines, text and door swings. */
export type PlanData = {
  width: number
  height: number
  /** 'vector': a PDF page drawn with lines (PLAN change 21). 'raster': a picture or a scan. */
  kind: 'vector' | 'raster'
  segments: readonly CleanSegment[]
  texts: readonly { text: string; center: Point }[]
  doorHints: readonly DoorHint[]
  /** The PDF's dimension texts paired with the lines they measure (scale.ts). */
  dimensionLabels: readonly DimensionLabel[]
}

/**
 * A plan an import runs on: what was read off it, and where it came from
 * ('stored': the venue's saved plan picture, run again from the Plan image tab).
 */
export type ImportPlan = PlanData & { source: 'image' | 'pdf' | 'stored'; page: number | null }

/**
 * The venue's stored plan picture, to run the import on again. It is read
 * as a picture: a vector PDF's lines are not kept, so a plan read from them
 * is run again by picking the PDF.
 */
export function storedImagePlan(image: { width: number; height: number }): ImportPlan {
  return { width: image.width, height: image.height, kind: 'raster', segments: [], texts: [], doorHints: [], dimensionLabels: [], source: 'stored', page: null }
}

const tenth = (v: number) => Math.round(v * 10) / 10

export function floorplanBody(plan: PlanData, image: { id: string; width: number; height: number }): FloorplanImportBody {
  const fx = plan.width > 0 ? image.width / plan.width : 1
  const fy = plan.height > 0 ? image.height / plan.height : 1
  const f = Math.sqrt(fx * fy)
  const at = (p: Point): Point => ({ x: tenth(p.x * fx), y: tenth(p.y * fy) })
  const body: FloorplanImportBody = { imageId: image.id, imageWidth: image.width, imageHeight: image.height }
  if (plan.kind === 'vector' && plan.segments.length > 0) {
    body.segments = plan.segments.slice(0, MAX_IMPORT_SEGMENTS).map((s) => ({
      id: s.id,
      x1: tenth(s.x1 * fx),
      y1: tenth(s.y1 * fy),
      x2: tenth(s.x2 * fx),
      y2: tenth(s.y2 * fy),
      thickness: tenth(Math.max(0, s.thickness * f)),
      source: s.source,
    }))
  }
  const labels = plan.texts
    .map((t) => ({ text: t.text.replace(/\s+/g, ' ').trim().slice(0, 200).trim(), center: at(t.center) }))
    .filter((t) => t.text !== '')
    .slice(0, MAX_IMPORT_LABELS)
  if (labels.length > 0) body.labels = labels
  if (plan.kind === 'vector') {
    const hints = plan.doorHints
      .filter((h) => h.radius > 0 && Number.isFinite(h.sweep))
      .slice(0, MAX_IMPORT_DOOR_HINTS)
      .map((h) => ({ hinge: at(h.hinge), radius: tenth(h.radius * f) || 0.1, from: at(h.from), to: at(h.to), sweep: tenth(h.sweep) }))
    if (hints.length > 0) body.doorHints = hints
  }
  return body
}

/** The PDF's measured dimension lines in the uploaded image's pixels. */
export function scaledDimensionLabels(plan: PlanData, image: { width: number; height: number }): DimensionLabel[] {
  const fx = plan.width > 0 ? image.width / plan.width : 1
  const fy = plan.height > 0 ? image.height / plan.height : 1
  if (fx === 1 && fy === 1) return [...plan.dimensionLabels]
  return plan.dimensionLabels.map((d) => ({ ...d, from: { x: d.from.x * fx, y: d.from.y * fy }, to: { x: d.to.x * fx, y: d.to.y * fy } }))
}

/** The kinds of file the import takes. */
export type PlanFileKind = 'pdf' | 'png' | 'jpeg'

/** PNG, JPG or PDF, by type or, when the browser gives none, by name. Null for anything else. */
export function planFileKind(file: { type: string; name: string }): PlanFileKind | null {
  const type = file.type.toLowerCase()
  const name = file.name.toLowerCase()
  if (type === 'application/pdf' || (type === '' && name.endsWith('.pdf'))) return 'pdf'
  if (type === 'image/png' || (type === '' && name.endsWith('.png'))) return 'png'
  if (type === 'image/jpeg' || type === 'image/jpg' || (type === '' && /\.jpe?g$/.test(name))) return 'jpeg'
  return null
}

/** "1:05" for an import's running time. */
export function elapsedText(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
