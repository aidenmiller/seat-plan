/**
 * Does a PDF page hold vector drawing or a scanned picture (spec section 5,
 * step 2)? A vector page goes through the line reader and the model only
 * names its lines (PLAN change 21); a raster page goes to the model as a
 * picture alone, like a PNG or JPG upload.
 *
 * Text is not used as a sign of vector drawing: scanned plans that went
 * through OCR carry invisible text over the picture.
 */
import type { PageStats, PageVectors, VectorSegment } from './pdf-vectors'

export type PageKind = 'vector' | 'raster'

export type PageClass = {
  kind: PageKind
  /** Share of the page covered by pictures, 0 to 1. */
  imageCoverage: number
  /** Stroked straight segments at least 1% of the page diagonal long. */
  longSegments: number
  reason: 'picture' | 'too few lines' | 'lines'
}

/** A page mostly covered by a picture with fewer lines than this on top is a scan. */
export const RASTER_MAX_SEGMENTS = 50
/** A picture covering at least this much of the page counts as the plan itself. */
export const RASTER_MIN_COVERAGE = 0.5
/** Fewer long lines than this is not a drawing we can read (a blank or text page). */
export const VECTOR_MIN_SEGMENTS = 4

function isLong(s: VectorSegment, minLength: number): boolean {
  return Math.hypot(s.x2 - s.x1, s.y2 - s.y1) >= minLength
}

/** Classifies from image coverage and the number of long stroked lines. */
export function classifyCounts(imageCoverage: number, longSegments: number): Omit<PageClass, 'imageCoverage' | 'longSegments'> {
  if (imageCoverage >= RASTER_MIN_COVERAGE && longSegments < RASTER_MAX_SEGMENTS) return { kind: 'raster', reason: 'picture' }
  if (longSegments < VECTOR_MIN_SEGMENTS) return { kind: 'raster', reason: 'too few lines' }
  return { kind: 'vector', reason: 'lines' }
}

export function classifyPage(page: Pick<PageVectors, 'width' | 'height' | 'segments'> & { stats: Pick<PageStats, 'imageCoverage'> }): PageClass {
  const minLength = 0.01 * Math.hypot(page.width, page.height)
  let longSegments = 0
  for (const s of page.segments) if (s.source === 'stroke' && isLong(s, minLength)) longSegments++
  const imageCoverage = page.stats.imageCoverage
  return { ...classifyCounts(imageCoverage, longSegments), imageCoverage, longSegments }
}

/** A channel darker than this is ink. Pages render on white, so a blank one is 255 throughout. */
const INK_BELOW = 230

/**
 * True when an RGBA picture holds no ink at all: every pixel is near white or
 * fully transparent. A scanned page whose picture pdf.js could not decode
 * renders like this, and must not go to the model as the plan.
 */
export function isBlankPicture(rgba: ArrayLike<number>): boolean {
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) continue
    if (rgba[i] < INK_BELOW || rgba[i + 1] < INK_BELOW || rgba[i + 2] < INK_BELOW) return false
  }
  return true
}
