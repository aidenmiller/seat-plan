/**
 * Snapping while dragging (spec section 4; PLAN section 6, "Snapping and
 * guides"; DECISIONS 35).
 *
 * The grid is 1 ft or 0.5 m by the wedding's unit. On each drag frame the
 * moving selection's edges and centers are checked against every other
 * shape's edges and centers; a match within a few screen pixels snaps to it
 * and wins over the grid. Holding Alt turns both off: the caller passes
 * snapGrid and snapGuides as false. A plain scan is fast enough for 640
 * shapes, so there is no spatial index.
 */
import type { Box } from './geometry'
import type { LengthUnit } from './units'

export const FOOT_GRID_CM = 30.48
export const METER_GRID_CM = 50
/** Grid lines closer than this on screen are thinned out (DECISIONS 35). */
export const MIN_GRID_LINE_PX = 8
/** How close, in screen pixels, an edge or center must come to another's to snap to it. */
export const GUIDE_TOLERANCE_PX = 6

/**
 * A line to draw while dragging. axis 'x' is a vertical line at x = at,
 * running from y = from to y = to; axis 'y' is a horizontal line at y = at,
 * running from x = from to x = to.
 */
export type Guide = { axis: 'x' | 'y'; at: number; from: number; to: number }

export type SnapOptions = {
  gridStep: number
  tolerancePx?: number
  zoom: number
  snapGrid: boolean
  snapGuides: boolean
  /**
   * The box that snaps to the grid, where the pointer alone would put it:
   * the selection's bodies (tables without their chairs), so a 60 in round
   * lands with its center and edges on 1 ft lines. Defaults to `moving`.
   */
  gridBox?: Box
}

export type SnapResult = {
  /** Add these to the pointer's own move to land on the snap. */
  dx: number
  dy: number
  /** What each axis snapped to. */
  snappedX: 'guide' | 'grid' | null
  snappedY: 'guide' | 'grid' | null
  guides: Guide[]
}

export function gridStepCm(unit: LengthUnit): number {
  return unit === 'm' ? METER_GRID_CM : FOOT_GRID_CM
}

/** The nearest multiple of `step`. A step of 0 or less leaves the value alone. */
export function snapToGrid(value: number, step: number): number {
  if (!(step > 0)) return value
  const snapped = Math.round(value / step) * step
  // Clear float noise (3 * 30.48 is 91.44000000000001) and negative zero.
  const clean = Math.round(snapped * 1e6) / 1e6
  return clean === 0 ? 0 : clean
}

/**
 * The spacing of the grid lines to draw: the grid step, or every fifth line
 * (feet) or every second (meters) when lines would sit closer than 8 px.
 */
export function visibleGridStepCm(unit: LengthUnit, zoom: number): number {
  let step = gridStepCm(unit)
  const factor = unit === 'm' ? 2 : 5
  for (let i = 0; i < 6 && step * zoom < MIN_GRID_LINE_PX; i++) step *= factor
  return step
}

function anchors(min: number, max: number): [number, number, number] {
  return [min, (min + max) / 2, max]
}

/** The smallest move, within `tolerance`, that lines one of `moving` up with one of the other boxes' anchors. */
function guideOffset(moving: readonly number[], others: readonly Box[], axis: 'x' | 'y', tolerance: number): number | null {
  let best: number | null = null
  let bestAbs = Infinity
  for (const o of others) {
    const theirs = axis === 'x' ? anchors(o.minX, o.maxX) : anchors(o.minY, o.maxY)
    for (const t of theirs) {
      for (const m of moving) {
        const d = t - m
        const a = Math.abs(d)
        if (a <= tolerance && a < bestAbs) {
          best = d
          bestAbs = a
        }
      }
    }
  }
  return best
}

/** The smallest move that puts an edge or the center of the box on a grid line. */
function gridOffset(moving: readonly number[], step: number): number {
  let best = 0
  let bestAbs = Infinity
  for (const m of moving) {
    const d = snapToGrid(m, step) - m
    const a = Math.abs(d)
    if (a < bestAbs) {
      best = d
      bestAbs = a
    }
  }
  return best
}

const ALIGNED_CM = 0.01

/** Guide lines for every edge or center of `moved` that lines up with another box. */
function guidesFor(moved: Box, others: readonly Box[], axis: 'x' | 'y'): Guide[] {
  const own = axis === 'x' ? anchors(moved.minX, moved.maxX) : anchors(moved.minY, moved.maxY)
  const lines = new Map<number, Guide>()
  for (const o of others) {
    const theirs = axis === 'x' ? anchors(o.minX, o.maxX) : anchors(o.minY, o.maxY)
    for (const at of own) {
      if (!theirs.some((t) => Math.abs(t - at) <= ALIGNED_CM)) continue
      const from = axis === 'x' ? Math.min(moved.minY, o.minY) : Math.min(moved.minX, o.minX)
      const to = axis === 'x' ? Math.max(moved.maxY, o.maxY) : Math.max(moved.maxX, o.maxX)
      const key = Math.round(at / ALIGNED_CM)
      const line = lines.get(key)
      if (line) {
        line.from = Math.min(line.from, from)
        line.to = Math.max(line.to, to)
      } else lines.set(key, { axis, at, from, to })
    }
  }
  return [...lines.values()].sort((a, b) => a.at - b.at)
}

/**
 * Snaps a moving selection. `moving` is the selection's box where the
 * pointer alone would put it; `others` are the boxes of everything not
 * moving (footprints, so chairs count). Each axis snaps on its own: to the
 * nearest edge or center of another shape within the tolerance, or else to
 * the grid, by whichever edge or center of `gridBox` (the bodies) is closest
 * to a line.
 */
export function snapMove(moving: Box, others: readonly Box[], options: SnapOptions): SnapResult {
  const zoom = options.zoom > 0 ? options.zoom : 1
  const tolerance = (options.tolerancePx ?? GUIDE_TOLERANCE_PX) / zoom
  const ax = anchors(moving.minX, moving.maxX)
  const ay = anchors(moving.minY, moving.maxY)
  const grid = options.gridBox ?? moving

  let dx = 0
  let dy = 0
  let snappedX: SnapResult['snappedX'] = null
  let snappedY: SnapResult['snappedY'] = null
  if (options.snapGuides) {
    const gx = guideOffset(ax, others, 'x', tolerance)
    const gy = guideOffset(ay, others, 'y', tolerance)
    if (gx !== null) {
      dx = gx
      snappedX = 'guide'
    }
    if (gy !== null) {
      dy = gy
      snappedY = 'guide'
    }
  }
  if (options.snapGrid && options.gridStep > 0) {
    if (snappedX === null) {
      dx = gridOffset(anchors(grid.minX, grid.maxX), options.gridStep)
      snappedX = 'grid'
    }
    if (snappedY === null) {
      dy = gridOffset(anchors(grid.minY, grid.maxY), options.gridStep)
      snappedY = 'grid'
    }
  }

  let guides: Guide[] = []
  if (options.snapGuides && others.length > 0) {
    const moved = { minX: moving.minX + dx, minY: moving.minY + dy, maxX: moving.maxX + dx, maxY: moving.maxY + dy }
    guides = [...guidesFor(moved, others, 'x'), ...guidesFor(moved, others, 'y')]
  }
  return { dx, dy, snappedX, snappedY, guides }
}
