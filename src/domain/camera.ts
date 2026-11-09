/**
 * The editor's camera (PLAN section 6, "Units and camera"; DECISIONS 1).
 * A screen point is world * zoom + (x, y), in CSS pixels from the top left
 * of the canvas viewport; at zoom 1 one cm is one pixel. Zoom runs from 10%
 * to 800%. The camera lives in each device's browser storage, never in the
 * saved canvas (PLAN change 1).
 */
import type { Box, Point } from './geometry'

export type Camera = { zoom: number; x: number; y: number }
export type Viewport = { width: number; height: number }

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 8
/** The zoom buttons step through these. */
export const ZOOM_STEPS: readonly number[] = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8]
/** Space left around the content by fit to content, in screen pixels. */
export const FIT_PADDING_PX = 48
/** Fit to content never zooms in past this, so one small table does not fill the screen. */
export const FIT_MAX_ZOOM = 2

export const DEFAULT_CAMERA: Camera = Object.freeze({ zoom: 1, x: 0, y: 0 })

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

export function worldToScreen(camera: Camera, p: Point): Point {
  return { x: p.x * camera.zoom + camera.x, y: p.y * camera.zoom + camera.y }
}

export function screenToWorld(camera: Camera, s: Point): Point {
  return { x: (s.x - camera.x) / camera.zoom, y: (s.y - camera.y) / camera.zoom }
}

/** A camera at `zoom` (clamped) that keeps the world point under `screenPoint` where it is. */
export function zoomTo(camera: Camera, screenPoint: Point, zoom: number): Camera {
  const next = clampZoom(zoom)
  const world = screenToWorld(camera, screenPoint)
  return { zoom: next, x: screenPoint.x - world.x * next, y: screenPoint.y - world.y * next }
}

/** Zooms by `factor` toward `screenPoint` (the pointer, or the viewport center for buttons). */
export function zoomAt(camera: Camera, screenPoint: Point, factor: number): Camera {
  if (!Number.isFinite(factor) || factor <= 0) return camera
  return zoomTo(camera, screenPoint, camera.zoom * factor)
}

export function panBy(camera: Camera, dx: number, dy: number): Camera {
  return { zoom: camera.zoom, x: camera.x + dx, y: camera.y + dy }
}

/** The next button step above (direction 1) or below (-1) the current zoom. */
export function nextZoomStep(zoom: number, direction: 1 | -1): number {
  const eps = 1e-6
  if (direction > 0) return ZOOM_STEPS.find((s) => s > zoom + eps) ?? MAX_ZOOM
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) if (ZOOM_STEPS[i] < zoom - eps) return ZOOM_STEPS[i]
  return MIN_ZOOM
}

/** The zoom in or zoom out button: to the next step, about the viewport's center. */
export function stepZoom(camera: Camera, viewport: Viewport, direction: 1 | -1): Camera {
  return zoomTo(camera, { x: viewport.width / 2, y: viewport.height / 2 }, nextZoomStep(camera.zoom, direction))
}

/** "75%" */
export function zoomPercent(zoom: number): string {
  return `${Math.round(zoom * 100)}%`
}

/** A camera that shows `world` at the viewport's center, at `zoom` (default: the current zoom). */
export function centerOn(camera: Camera, world: Point, viewport: Viewport, zoom: number = camera.zoom): Camera {
  const z = clampZoom(zoom)
  return { zoom: z, x: viewport.width / 2 - world.x * z, y: viewport.height / 2 - world.y * z }
}

/** What covers the viewport's edges (toolbar, zoom controls, a bottom sheet), in screen px. */
export type FitInsets = { top: number; right: number; bottom: number; left: number }
export const NO_FIT_INSETS: FitInsets = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 })

const insetPx = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0)

/**
 * The part of the viewport fit to content may use: the viewport less its
 * insets. A pair of insets that would leave nothing (an unmeasured or tiny
 * viewport) is ignored on that axis, so fit still frames the content.
 */
export function fitArea(viewport: Viewport, insets: FitInsets = NO_FIT_INSETS): { x: number; y: number; width: number; height: number } {
  let left = insetPx(insets.left)
  let right = insetPx(insets.right)
  let top = insetPx(insets.top)
  let bottom = insetPx(insets.bottom)
  if (viewport.width - left - right < 1) left = right = 0
  if (viewport.height - top - bottom < 1) top = bottom = 0
  return { x: left, y: top, width: viewport.width - left - right, height: viewport.height - top - bottom }
}

/**
 * The camera that fits `box` in the viewport with `padding` screen pixels
 * around it, centered, never past `maxZoom`. With `insets`, it fits and
 * centers the box in the part of the viewport they leave free, so the
 * toolbar and, on phones, the bottom sheet never cover it. An empty canvas
 * (null box) shows the origin at 100% in the middle of that part.
 */
export function fitToContent(
  box: Box | null,
  viewport: Viewport,
  padding: number = FIT_PADDING_PX,
  options: { maxZoom?: number; insets?: FitInsets } = {},
): Camera {
  const area = fitArea(viewport, options.insets)
  const screenCenter = { x: area.x + area.width / 2, y: area.y + area.height / 2 }
  const at = (world: Point, zoom: number): Camera => {
    const z = clampZoom(zoom)
    return { zoom: z, x: screenCenter.x - world.x * z, y: screenCenter.y - world.y * z }
  }
  if (!box) return at({ x: 0, y: 0 }, 1)
  const center = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }
  const w = Math.max(box.maxX - box.minX, 1)
  const h = Math.max(box.maxY - box.minY, 1)
  const availW = Math.max(area.width - 2 * padding, 1)
  const availH = Math.max(area.height - 2 * padding, 1)
  const zoom = Math.min(availW / w, availH / h, options.maxZoom ?? FIT_MAX_ZOOM)
  return at(center, zoom)
}

/** The part of the world the viewport shows. */
export function visibleWorldBox(camera: Camera, viewport: Viewport): Box {
  const a = screenToWorld(camera, { x: 0, y: 0 })
  const b = screenToWorld(camera, { x: viewport.width, y: viewport.height })
  return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y }
}

/**
 * The CSS transform that takes what was drawn with `from` to where `to`
 * would draw it: screen' = screen * scale + (x, y). During a gesture the
 * editor moves the wrapper by this instead of redrawing (PLAN section 6).
 */
export function relativeTransform(from: Camera, to: Camera): { scale: number; x: number; y: number } {
  const scale = to.zoom / from.zoom
  return { scale, x: to.x - from.x * scale, y: to.y - from.y * scale }
}

/** A camera read back from browser storage, or null when the value is not one. */
export function parseCamera(value: unknown): Camera | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  const { zoom, x, y } = v
  if (typeof zoom !== 'number' || typeof x !== 'number' || typeof y !== 'number') return null
  if (!Number.isFinite(zoom) || !Number.isFinite(x) || !Number.isFinite(y) || zoom <= 0) return null
  if (Math.abs(x) > 1e9 || Math.abs(y) > 1e9) return null
  return { zoom: clampZoom(zoom), x, y }
}
