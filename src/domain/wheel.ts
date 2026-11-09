/**
 * Telling a mouse wheel from a trackpad (PLAN change 11). Browsers report a
 * mouse wheel and a two-finger trackpad scroll as the same wheel event. The
 * wheel zooms toward the pointer and the trackpad pans, as the spec says.
 *
 *  - Ctrl on a wheel event is a trackpad pinch (Chrome, Firefox, Edge send
 *    pinch that way) or Ctrl+wheel: always zoom.
 *  - Lines or pages (deltaMode 1 or 2), or large whole steps on one axis with
 *    wheelDeltaY a multiple of 120, come from a mouse wheel.
 *  - Small or fractional steps, or x and y together, come from a trackpad.
 *  - Within one gesture (events less than 250 ms apart) the first answer
 *    holds, so a trackpad flick's large momentum steps keep panning.
 *
 * Some mice still look like trackpads, so the "Mouse wheel" setting can force
 * zoom or pan for every wheel event that is not a pinch.
 */

export type WheelAction = 'zoom' | 'pan'
export type WheelDevice = 'mouse' | 'trackpad'
export type WheelSetting = 'auto' | 'zoom' | 'pan'

export type WheelLike = {
  deltaX: number
  deltaY: number
  /** 0 pixels, 1 lines, 2 pages. */
  deltaMode: number
  ctrlKey: boolean
  /** Chrome, Safari and Edge: ±120 per wheel notch. Undefined elsewhere. */
  wheelDeltaY?: number
  /** Milliseconds, as on DOM events. */
  timeStamp?: number
}

export type WheelRecord = { time: number; device: WheelDevice }
/** Recent wheel events, oldest first. */
export type WheelHistory = readonly WheelRecord[]

/** Events closer together than this belong to one gesture. */
export const GESTURE_GAP_MS = 250
/** A whole-number step at least this big, alone on one axis, looks like a wheel notch. */
export const LARGE_STEP_PX = 50
export const LINE_PX = 16
export const PAGE_PX = 800
const HISTORY_LENGTH = 8

/** A wheel event's own evidence, ignoring history. Strong evidence overrides the gesture so far. */
function evidence(e: WheelLike): { device: WheelDevice; strong: boolean } {
  if (e.deltaMode === 1 || e.deltaMode === 2) return { device: 'mouse', strong: true }
  if (e.deltaX !== 0 && e.deltaY !== 0) return { device: 'trackpad', strong: false }
  const step = e.deltaX !== 0 ? e.deltaX : e.deltaY
  const size = Math.abs(step)
  const notch = e.wheelDeltaY !== undefined && e.wheelDeltaY !== 0 && e.wheelDeltaY % 120 === 0
  if (e.deltaX === 0 && size >= LARGE_STEP_PX) {
    // Chrome scales deltaY with page zoom, so a notch can be fractional; wheelDeltaY stays 120.
    if (notch) return { device: 'mouse', strong: false }
    if (e.wheelDeltaY === undefined && Number.isInteger(step)) return { device: 'mouse', strong: false }
  }
  return { device: 'trackpad', strong: false }
}

function now(e: WheelLike, at?: number): number {
  return at ?? e.timeStamp ?? 0
}

/** The device that sent the event, using the gesture so far when there is one. */
export function wheelDevice(e: WheelLike, history: WheelHistory = [], at?: number): WheelDevice {
  const own = evidence(e)
  const last = history.length > 0 ? history[history.length - 1] : null
  const t = now(e, at)
  if (!own.strong && last && t - last.time >= 0 && t - last.time < GESTURE_GAP_MS) return last.device
  return own.device
}

/** Whether a wheel event zooms or pans. A pinch (Ctrl) always zooms; the setting decides the rest, or the device on 'auto'. */
export function classifyWheel(e: WheelLike, history: WheelHistory = [], setting: WheelSetting = 'auto', at?: number): WheelAction {
  if (e.ctrlKey) return 'zoom'
  if (setting === 'zoom' || setting === 'pan') return setting
  return wheelDevice(e, history, at) === 'mouse' ? 'zoom' : 'pan'
}

/** The history with this event added; call after classifyWheel. */
export function rememberWheel(history: WheelHistory, e: WheelLike, at?: number): WheelHistory {
  const record = { time: now(e, at), device: wheelDevice(e, history, at) }
  const next = [...history, record]
  return next.length > HISTORY_LENGTH ? next.slice(next.length - HISTORY_LENGTH) : next
}

function toPixels(delta: number, deltaMode: number): number {
  if (deltaMode === 1) return delta * LINE_PX
  if (deltaMode === 2) return delta * PAGE_PX
  return delta
}

/**
 * The zoom factor for one wheel event: above 1 zooms in. Pinches send small
 * steps, so they count for more than a wheel's. One step never more than
 * doubles or halves the zoom.
 */
export function wheelZoomFactor(deltaY: number, deltaMode: number, ctrlKey: boolean): number {
  const px = toPixels(deltaY, deltaMode)
  const k = ctrlKey ? 0.01 : 0.0015
  return Math.min(2, Math.max(0.5, Math.exp(-px * k)))
}

/** How far a pan moves the camera, in screen pixels: content follows the fingers. */
export function wheelPanDelta(e: Pick<WheelLike, 'deltaX' | 'deltaY' | 'deltaMode'>): { dx: number; dy: number } {
  return { dx: -toPixels(e.deltaX, e.deltaMode) || 0, dy: -toPixels(e.deltaY, e.deltaMode) || 0 }
}
