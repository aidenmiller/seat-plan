/**
 * Colors, fonts and line widths for the world SVG. Every length is in world
 * units (cm). The world SVG sets each of these as an SVG attribute, with no
 * class or style, so it draws the same when copied out for print or export.
 *
 * On screen, two lines must keep a width in screen px at every zoom: the
 * tight ring ([data-tight-outline]) and a table's outline
 * ([data-table-body]). A rule in globals.css overrides their stroke-width
 * with --zoom, which the camera writes on the viewport at settle; the
 * attributes stay as the print widths.
 */
import type { Fixture, Note } from '@/domain/canvas-schema'
import { SEAT_EMPTY_COLOR, SEAT_TAKEN_COLOR } from '@/domain/seats'

export const WORLD_FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"

export const SEAT_TAKEN = SEAT_TAKEN_COLOR
export const SEAT_EMPTY = SEAT_EMPTY_COLOR

export const INK = '#1c1917'
export const INK_SOFT = '#57534e'

export const TABLE_FILL = '#ffffff'
export const TABLE_STROKE = '#57534e'
export const TABLE_STROKE_CM = 2.5
/** On screen a table's outline is never thinner than this (globals.css). */
export const TABLE_STROKE_MIN_SCREEN_PX = 1
/** The yellow ring around a tight table (spec section 4, "Seats"). */
export const TIGHT_STROKE = '#eab308'
/** The ring's width in print; on screen it is TIGHT_STROKE_SCREEN_PX at every zoom (globals.css). */
export const TIGHT_STROKE_CM = 6
export const TIGHT_STROKE_SCREEN_PX = 3
/** How far the yellow ring sits outside the seat circles (or the table's edge where a side has no seats). */
export const TIGHT_OFFSET_CM = 6

export const FIXTURE_STROKE_CM = 2
export const FIXTURE_LABEL = '#292524'

/** Fill and line color for each fixture type: light fills so seats stay the strongest color on the plan. */
export const FIXTURE_COLORS: Record<Fixture['type'], { fill: string; stroke: string }> = {
  food: { fill: '#fef3c7', stroke: '#b45309' },
  bar: { fill: '#e0f2fe', stroke: '#0369a1' },
  dj: { fill: '#ede9fe', stroke: '#6d28d9' },
  danceFloor: { fill: '#fdf4ff', stroke: '#a21caf' },
  stage: { fill: '#f5f5f4', stroke: '#57534e' },
  cake: { fill: '#fce7f3', stroke: '#be185d' },
  gifts: { fill: '#dcfce7', stroke: '#15803d' },
  photoBooth: { fill: '#ffedd5', stroke: '#c2410c' },
  ceremonyStructure: { fill: '#f5f5f4', stroke: '#57534e' },
  officiant: { fill: '#f5f5f4', stroke: '#57534e' },
  aisleRunner: { fill: '#f5f5f4', stroke: '#57534e' },
  musicians: { fill: '#ede9fe', stroke: '#6d28d9' },
  soundDesk: { fill: '#ede9fe', stroke: '#6d28d9' },
  welcomeSign: { fill: '#f5f5f4', stroke: '#57534e' },
  entrance: { fill: '#f5f5f4', stroke: '#57534e' },
  custom: { fill: '#f5f5f4', stroke: '#57534e' },
}

export const NOTE_COLORS: Record<Note['color'], string> = {
  yellow: '#fef08a',
  pink: '#fbcfe8',
  blue: '#bfdbfe',
  green: '#bbf7d0',
  purple: '#e9d5ff',
  grey: '#e5e7eb',
}

/** The venue layer: the template's fixed items, drawn quieter than the layout's own items. */
export const VENUE = {
  wall: '#44403c',
  outline: '#78716c',
  zone: '#a8a29e',
  fill: '#e7e5e4',
  label: '#78716c',
  window: '#ffffff',
  /** Doors and windows sit on walls: a gap this thick hides the wall behind the opening. */
  gapCm: 24,
} as const

/** Lines, arrows and outlines of notes, a shade darker than the sticky colors. */
export const NOTE_STROKES: Record<Note['color'], string> = {
  yellow: '#a16207',
  pink: '#be185d',
  blue: '#1d4ed8',
  green: '#15803d',
  purple: '#7e22ce',
  grey: '#4b5563',
}
