/**
 * Image sizes for the floor plan import (PLAN change 6, section 7 "Floor plan
 * import").
 *
 * The model reads an image at full size only when its long edge is at most
 * 2,576 px and it costs at most 4,784 visual tokens, where tokens =
 * ceil(w / 28) * ceil(h / 28). A larger image is shrunk by the API without
 * telling us, and the coordinates in the reply would no longer match our
 * pixels, so we send the largest image that fits. The same image is stored
 * (at most 2,576 px on the long edge and under about 3 MB) and drawn on the
 * hidden reference layer, so the model's pixels, the PDF's lines and the
 * stored image share one pixel space.
 */

export type Size = { width: number; height: number }

/** The model's high resolution tier (Claude 4.7 and later). */
export const MODEL_MAX_EDGE = 2576
export const MODEL_MAX_TOKENS = 4784
/** Images are measured in tiles of 28 by 28 pixels. */
export const MODEL_TILE = 28

/** The stored image: what the reference layer and the model both use. */
export const STORED_MAX_EDGE = 2576
/** Vercel refuses bodies over 4.5 MB; aim well under it. */
export const STORED_TARGET_BYTES = 3_000_000

/** Visual tokens the model spends on an image of this size. */
export function visualTokens(width: number, height: number): number {
  return Math.ceil(width / MODEL_TILE) * Math.ceil(height / MODEL_TILE)
}

/** True when the model reads this size as it is, with no shrinking. */
export function fitsModel(width: number, height: number, maxEdge = MODEL_MAX_EDGE, maxTokens = MODEL_MAX_TOKENS): boolean {
  return (
    Math.ceil(width / MODEL_TILE) * MODEL_TILE <= maxEdge &&
    Math.ceil(height / MODEL_TILE) * MODEL_TILE <= maxEdge &&
    visualTokens(width, height) <= maxTokens
  )
}

/** Rounds halves to the even neighbour, as the API's own resize does. */
function roundHalfEven(v: number): number {
  const f = Math.floor(v)
  if (v - f !== 0.5) return Math.round(v)
  return f % 2 === 0 ? f : f + 1
}

/**
 * The size the model would shrink this image to (the vision docs' reference
 * resizedSize): the same size when it already fits, else the largest size
 * with the same shape that does. Never larger than the input.
 */
export function modelImageSize(width: number, height: number, maxEdge = MODEL_MAX_EDGE, maxTokens = MODEL_MAX_TOKENS): Size {
  const w0 = Math.max(1, Math.round(width))
  const h0 = Math.max(1, Math.round(height))
  if (fitsModel(w0, h0, maxEdge, maxTokens)) return { width: w0, height: h0 }
  if (h0 > w0) {
    const turned = modelImageSize(h0, w0, maxEdge, maxTokens)
    return { width: turned.height, height: turned.width }
  }
  const aspect = w0 / h0
  let lo = 1
  let hi = w0
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (fitsModel(mid, Math.max(roundHalfEven(mid / aspect), 1), maxEdge, maxTokens)) lo = mid
    else hi = mid
  }
  return { width: lo, height: Math.max(roundHalfEven(lo / aspect), 1) }
}

/**
 * The largest image the model reads without shrinking, for a picture of this
 * shape: unlike modelImageSize it grows small inputs too. Use it to pick the
 * size a vector drawing is rendered at.
 */
export function largestModelSize(width: number, height: number, maxEdge = MODEL_MAX_EDGE, maxTokens = MODEL_MAX_TOKENS): Size {
  if (!(width > 0 && height > 0)) return { width: 1, height: 1 }
  // Grow past every limit first, then let the reference resize bring it back.
  const grow = (maxEdge * 4) / Math.max(width, height)
  return modelImageSize(width * grow, height * grow, maxEdge, maxTokens)
}

/**
 * The scale to render a PDF page at, from its viewport at scale 1 (which
 * already has the page's rotation and crop): the canvas is
 * floor(width * scale) by floor(height * scale) pixels and the model reads
 * it without shrinking.
 */
export function pageRenderScale(
  viewportWidth: number,
  viewportHeight: number,
  maxEdge = MODEL_MAX_EDGE,
  maxTokens = MODEL_MAX_TOKENS,
): { scale: number } & Size {
  const target = largestModelSize(viewportWidth, viewportHeight, maxEdge, maxTokens)
  let scale = target.width / viewportWidth
  for (let i = 0; i < 200; i++) {
    const w = Math.floor(viewportWidth * scale)
    const h = Math.floor(viewportHeight * scale)
    if (w >= 1 && h >= 1 && fitsModel(w, h, maxEdge, maxTokens)) return { scale, width: w, height: h }
    scale *= 0.995
  }
  const w = Math.max(1, Math.floor(viewportWidth * scale))
  const h = Math.max(1, Math.floor(viewportHeight * scale))
  return { scale, width: w, height: h }
}

/**
 * The size to store an uploaded picture at: the size the model reads without
 * shrinking (which also keeps the long edge at most 2,576 px). Never grows a
 * small picture.
 */
export function storedImageSize(width: number, height: number): Size {
  const fit = modelImageSize(width, height, Math.min(MODEL_MAX_EDGE, STORED_MAX_EDGE), MODEL_MAX_TOKENS)
  return fit
}

/**
 * When an encoded image came out at `bytes`, the smaller size to try next so
 * it lands under `targetBytes`, or null when it already does. Encoded size
 * grows about with the pixel count, so the side shrinks by the square root of
 * the ratio, with 10% to spare. Never returns less than 64 px on a side.
 */
export function shrinkForBytes(size: Size, bytes: number, targetBytes = STORED_TARGET_BYTES): Size | null {
  if (bytes <= targetBytes) return null
  const factor = Math.sqrt(targetBytes / bytes) * 0.9
  const width = Math.max(64, Math.floor(size.width * factor))
  const height = Math.max(64, Math.floor(size.height * factor))
  if (width >= size.width && height >= size.height) return null
  return { width: Math.min(width, size.width), height: Math.min(height, size.height) }
}
