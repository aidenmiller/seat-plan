/**
 * Detail levels (spec section 4, "Detail levels"; PLAN section 6). The level
 * comes from how many screen pixels one seat circle covers, so every table
 * switches at the same zoom. Going up: middle at 22 px, close at 36 px.
 * Going down: middle below 30 px, far below 18 px. The gap between the up
 * and down points keeps labels from flickering at a boundary.
 */
import { SEAT_DIAMETER_CM } from './seats'

export type DetailLevel = 'far' | 'middle' | 'close'

export const UP_TO_MIDDLE_PX = 22
export const UP_TO_CLOSE_PX = 36
export const DOWN_TO_MIDDLE_PX = 30
export const DOWN_TO_FAR_PX = 18

/** How many screen pixels a seat circle covers at this zoom. */
export function seatScreenPx(zoom: number): number {
  return SEAT_DIAMETER_CM * zoom
}

/** The level after a zoom change, from the level before it. */
export function nextLevel(prev: DetailLevel, seatPx: number): DetailLevel {
  switch (prev) {
    case 'far':
      if (seatPx >= UP_TO_CLOSE_PX) return 'close'
      return seatPx >= UP_TO_MIDDLE_PX ? 'middle' : 'far'
    case 'middle':
      if (seatPx >= UP_TO_CLOSE_PX) return 'close'
      return seatPx < DOWN_TO_FAR_PX ? 'far' : 'middle'
    case 'close':
      if (seatPx < DOWN_TO_FAR_PX) return 'far'
      return seatPx < DOWN_TO_MIDDLE_PX ? 'middle' : 'close'
  }
}

/** The level for a first view with no level before it: the going-up points. */
export function initialLevel(seatPx: number): DetailLevel {
  return nextLevel('far', seatPx)
}

export function levelForZoom(prev: DetailLevel | null, zoom: number): DetailLevel {
  const px = seatScreenPx(zoom)
  return prev === null ? initialLevel(px) : nextLevel(prev, px)
}
