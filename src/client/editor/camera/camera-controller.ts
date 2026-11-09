/**
 * The camera controller (PLAN section 6, "Units and camera" and "Two drawing
 * layers"). The camera lives here, outside React state:
 *
 *  - During a gesture (wheel, pinch, pan), each change asks for one
 *    animation frame. The frame writes one CSS transform,
 *    matrix(k,0,0,k,x,y), on the HTML wrapper around the world SVG: the
 *    move from the camera the SVG was last drawn with to the camera now. No
 *    will-change, so the browser keeps the vectors.
 *  - About 150 ms after the last change, the controller writes the camera
 *    into the SVG (a transform on its root <g>), resets the wrapper, updates
 *    the --zoom CSS variable and the data-detail attribute on the viewport,
 *    and saves the camera for this device.
 *  - React hears only the zoom percent text (when it changes) and the detail
 *    level (when it changes, at settle). Frame listeners (the overlay) run
 *    in the same frame as the wrapper write, so handles never lag.
 *  - Each frame also writes the grid's CSS variables on the viewport:
 *    --grid-step (px between the lines shown), --grid-x and --grid-y (where a
 *    line falls), for a CSS background grid.
 *
 * Screen points are CSS px from the viewport's top left; world points are cm.
 */
import {
  clampZoom,
  DEFAULT_CAMERA,
  fitToContent,
  panBy as panCamera,
  relativeTransform,
  screenToWorld as toWorld,
  stepZoom,
  worldToScreen as toScreen,
  zoomAt as zoomCameraAt,
  zoomPercent,
  zoomTo as zoomCameraTo,
  centerOn as centerCameraOn,
  NO_FIT_INSETS,
  type Camera,
  type FitInsets,
  type Viewport,
} from '@/domain/camera'
import { levelForZoom, type DetailLevel } from '@/domain/detail-level'
import type { Box, Point } from '@/domain/geometry'
import { visibleGridStepCm } from '@/domain/snapping'
import type { LengthUnit } from '@/domain/units'

export const SETTLE_MS = 150

export type FrameScheduler = {
  requestFrame(callback: () => void): number
  cancelFrame(id: number): void
  setTimer(callback: () => void, ms: number): number
  clearTimer(id: number): void
}

export function browserScheduler(): FrameScheduler {
  return {
    requestFrame: (cb) => requestAnimationFrame(() => cb()),
    cancelFrame: (id) => cancelAnimationFrame(id),
    setTimer: (cb, ms) => window.setTimeout(cb, ms),
    clearTimer: (id) => window.clearTimeout(id),
  }
}

type StyleLike = { transform: string; transformOrigin: string; setProperty(name: string, value: string): void }

/** The elements the camera writes to. */
export type CameraTargets = {
  /** The fixed-size viewport: measured for its size, holds --zoom, --grid-* and data-detail. */
  viewport: { style: StyleLike; getBoundingClientRect(): { left: number; top: number; width: number; height: number }; setAttribute(name: string, value: string): void }
  /** The HTML wrapper around the world SVG, moved during gestures. */
  wrapper: { style: StyleLike }
  /** The world SVG's root <g>, given the camera at settle. */
  world: { setAttribute(name: string, value: string): void }
}

export type CameraControllerOptions = {
  initial?: Camera
  scheduler?: FrameScheduler
  settleMs?: number
  gridUnit?: LengthUnit
  /** After each settle: save the camera for this device. */
  onSettle?(camera: Camera): void
}

export type CameraController = {
  /** The camera now, mid-gesture included. */
  get(): Camera
  /** The camera the world SVG was last drawn with. */
  drawn(): Camera
  viewportSize(): Viewport
  /** Re-reads the viewport's size and place on the page. */
  measure(): void
  /** Moves the camera. `immediate` (buttons, fit, search) redraws at once instead of after the gesture. */
  set(camera: Camera, options?: { immediate?: boolean }): void
  panBy(dx: number, dy: number): void
  /** Zooms by `factor` toward a screen point (the pointer). */
  zoomAt(screen: Point, factor: number): void
  zoomTo(screen: Point, zoom: number, options?: { immediate?: boolean }): void
  zoomIn(): void
  zoomOut(): void
  /** 100%, about the viewport's center. */
  zoomReset(): void
  /** Fits a world box (the content) in the viewport, less the fit insets. */
  fit(box: Box | null): void
  /**
   * What covers the viewport's edges (the toolbar, the zoom controls and on
   * phones the bottom sheet's strip). Every fit (the zoom button, the canvas
   * menu, Ctrl+1, the first fit on mount) keeps the content clear of them.
   */
  setFitInsets(insets: FitInsets): void
  fitInsets(): FitInsets
  /** Shows a world point at the viewport's center, at `zoom` or the zoom now. */
  centerOn(world: Point, zoom?: number): void
  screenToWorld(screen: Point): Point
  worldToScreen(world: Point): Point
  /** A pointer event's clientX and clientY to a screen point. */
  clientToScreen(clientX: number, clientY: number): Point
  setGridUnit(unit: LengthUnit): void
  /** Starts writing to the page. Returns detach. */
  attach(targets: CameraTargets): () => void
  /** Every frame the camera moves, and once at settle, with the camera now. */
  subscribeFrame(listener: (camera: Camera) => void): () => void
  subscribeSettle(listener: (camera: Camera) => void): () => void
  /** "75%": changes during a zoom. For React, through useSyncExternalStore. */
  zoomText(): string
  subscribeZoomText(listener: () => void): () => void
  /** Far, middle or close: changes only when a gesture settles. */
  detailLevel(): DetailLevel
  subscribeDetailLevel(listener: () => void): () => void
  /** Writes the zoom text into an element on each frame, without React. Returns unbind. */
  bindZoomLabel(element: { textContent: string | null }): () => void
  /** True between the first change of a gesture and its settle. */
  isMoving(): boolean
  /** Settles now. */
  flush(): void
  destroy(): void
}

function fmt(n: number): string {
  const v = Math.round(n * 1e6) / 1e6
  return String(v === 0 ? 0 : v)
}

/** A CSS or SVG matrix for a uniform scale and a move. */
export function cssMatrix(scale: number, x: number, y: number): string {
  return `matrix(${fmt(scale)},0,0,${fmt(scale)},${fmt(x)},${fmt(y)})`
}

/** The world <g> transform for a camera: world cm to screen px. */
export function worldTransform(camera: Camera): string {
  return cssMatrix(camera.zoom, camera.x, camera.y)
}

/** The wrapper's transform mid-gesture: from the drawn camera to the live one. Empty when they match. */
export function wrapperTransform(drawn: Camera, live: Camera): string {
  const t = relativeTransform(drawn, live)
  if (Math.abs(t.scale - 1) < 1e-9 && Math.abs(t.x) < 1e-6 && Math.abs(t.y) < 1e-6) return ''
  return cssMatrix(t.scale, t.x, t.y)
}

/** The grid's CSS variables: px between the lines shown and where one falls. */
export function gridVars(camera: Camera, unit: LengthUnit): { step: number; x: number; y: number } {
  const step = visibleGridStepCm(unit, camera.zoom) * camera.zoom
  const mod = (v: number) => ((v % step) + step) % step
  return { step, x: mod(camera.x), y: mod(camera.y) }
}

function sameCamera(a: Camera, b: Camera): boolean {
  return a.zoom === b.zoom && a.x === b.x && a.y === b.y
}

function cleanCamera(c: Camera): Camera {
  const zoom = clampZoom(c.zoom)
  return { zoom, x: Number.isFinite(c.x) ? c.x : 0, y: Number.isFinite(c.y) ? c.y : 0 }
}

export function createCameraController(options: CameraControllerOptions = {}): CameraController {
  const scheduler = options.scheduler ?? browserScheduler()
  const settleMs = options.settleMs ?? SETTLE_MS
  let live = cleanCamera(options.initial ?? DEFAULT_CAMERA)
  let drawn = live
  let unit: LengthUnit = options.gridUnit ?? 'ft'
  let size: Viewport = { width: 0, height: 0 }
  let insets: FitInsets = NO_FIT_INSETS
  let origin = { left: 0, top: 0 }
  let targets: CameraTargets | null = null
  let frame = 0
  let timer: number | null = null
  let level: DetailLevel = levelForZoom(null, live.zoom)
  let text = zoomPercent(live.zoom)

  const frameListeners = new Set<(camera: Camera) => void>()
  const settleListeners = new Set<(camera: Camera) => void>()
  const textListeners = new Set<() => void>()
  const levelListeners = new Set<() => void>()
  const labels = new Set<{ textContent: string | null }>()

  const center = (): Point => ({ x: size.width / 2, y: size.height / 2 })

  function writeGrid() {
    if (!targets) return
    const g = gridVars(live, unit)
    const style = targets.viewport.style
    style.setProperty('--grid-step', `${fmt(g.step)}px`)
    style.setProperty('--grid-x', `${fmt(g.x)}px`)
    style.setProperty('--grid-y', `${fmt(g.y)}px`)
  }

  function updateText() {
    const next = zoomPercent(live.zoom)
    if (next === text) return
    text = next
    for (const label of labels) label.textContent = text
    for (const l of [...textListeners]) l()
  }

  function drawFrame() {
    frame = 0
    if (targets) {
      targets.wrapper.style.transform = wrapperTransform(drawn, live)
      writeGrid()
    }
    updateText()
    for (const l of [...frameListeners]) l(live)
  }

  function writeDrawn() {
    if (!targets) return
    targets.world.setAttribute('transform', worldTransform(drawn))
    targets.wrapper.style.transform = ''
    targets.viewport.style.setProperty('--zoom', fmt(drawn.zoom))
    targets.viewport.setAttribute('data-detail', level)
    writeGrid()
  }

  function settle() {
    if (timer !== null) scheduler.clearTimer(timer)
    timer = null
    if (frame) scheduler.cancelFrame(frame)
    frame = 0
    drawn = live
    const nextLevel = levelForZoom(level, live.zoom)
    const levelChanged = nextLevel !== level
    level = nextLevel
    writeDrawn()
    updateText()
    for (const l of [...frameListeners]) l(live)
    if (levelChanged) for (const l of [...levelListeners]) l()
    for (const l of [...settleListeners]) l(live)
    options.onSettle?.(live)
  }

  function change(next: Camera, immediate = false) {
    const c = cleanCamera(next)
    if (sameCamera(c, live) && !immediate) return
    live = c
    if (immediate) {
      settle()
      return
    }
    if (!frame) frame = scheduler.requestFrame(drawFrame)
    if (timer !== null) scheduler.clearTimer(timer)
    timer = scheduler.setTimer(settle, settleMs)
  }

  function measure() {
    if (!targets) return
    const r = targets.viewport.getBoundingClientRect()
    size = { width: r.width, height: r.height }
    origin = { left: r.left, top: r.top }
  }

  const controller: CameraController = {
    get: () => live,
    drawn: () => drawn,
    viewportSize: () => size,
    measure,
    set: (camera, opts) => change(camera, opts?.immediate === true),
    panBy: (dx, dy) => change(panCamera(live, dx, dy)),
    zoomAt: (screen, factor) => change(zoomCameraAt(live, screen, factor)),
    zoomTo: (screen, zoom, opts) => change(zoomCameraTo(live, screen, zoom), opts?.immediate === true),
    zoomIn: () => change(stepZoom(live, size, 1), true),
    zoomOut: () => change(stepZoom(live, size, -1), true),
    zoomReset: () => change(zoomCameraTo(live, center(), 1), true),
    fit: (box) => change(fitToContent(box, size, undefined, { insets }), true),
    setFitInsets(next) {
      insets = Object.freeze({ top: next.top, right: next.right, bottom: next.bottom, left: next.left })
    },
    fitInsets: () => insets,
    centerOn: (world, zoom) => change(centerCameraOn(live, world, size, zoom ?? live.zoom), true),
    screenToWorld: (screen) => toWorld(live, screen),
    worldToScreen: (world) => toScreen(live, world),
    clientToScreen: (clientX, clientY) => ({ x: clientX - origin.left, y: clientY - origin.top }),
    setGridUnit(next) {
      if (next === unit) return
      unit = next
      writeGrid()
    },
    attach(next) {
      targets = next
      next.wrapper.style.transformOrigin = '0 0'
      drawn = live
      measure()
      writeDrawn()
      let observer: ResizeObserver | null = null
      const onWindow = () => measure()
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(() => measure())
        observer.observe(next.viewport as unknown as Element)
      }
      if (typeof window !== 'undefined') {
        window.addEventListener('resize', onWindow)
        window.addEventListener('scroll', onWindow, true)
      }
      return () => {
        observer?.disconnect()
        if (typeof window !== 'undefined') {
          window.removeEventListener('resize', onWindow)
          window.removeEventListener('scroll', onWindow, true)
        }
        if (targets === next) targets = null
      }
    },
    subscribeFrame(listener) {
      frameListeners.add(listener)
      return () => void frameListeners.delete(listener)
    },
    subscribeSettle(listener) {
      settleListeners.add(listener)
      return () => void settleListeners.delete(listener)
    },
    zoomText: () => text,
    subscribeZoomText(listener) {
      textListeners.add(listener)
      return () => void textListeners.delete(listener)
    },
    detailLevel: () => level,
    subscribeDetailLevel(listener) {
      levelListeners.add(listener)
      return () => void levelListeners.delete(listener)
    },
    bindZoomLabel(element) {
      labels.add(element)
      element.textContent = text
      return () => void labels.delete(element)
    },
    isMoving: () => timer !== null,
    flush() {
      if (timer !== null || frame) settle()
    },
    destroy() {
      if (timer !== null) scheduler.clearTimer(timer)
      if (frame) scheduler.cancelFrame(frame)
      timer = null
      frame = 0
      targets = null
      frameListeners.clear()
      settleListeners.clear()
      textListeners.clear()
      levelListeners.clear()
      labels.clear()
    },
  }
  return controller
}
