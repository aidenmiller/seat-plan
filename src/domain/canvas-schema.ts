/**
 * The saved layout document. Every length is in centimeters; x and y are an
 * item's center; rotation is in degrees, clockwise, about the center.
 * Shared by the browser (before sending) and the server (before writing).
 */
import { z } from 'zod'

export const CANVAS_SCHEMA_VERSION = 1
/** 24 in. The smallest table side, and the edge each seat needs on straight edges. */
export const MIN_TABLE_CM = 60.96
export const MAX_ITEMS = 3000
export const MAX_SEATS_ROUND_OR_SQUARE = 30
export const MAX_SEATS_RECT = 60

const itemId = z.string().min(1).max(64)
const coord = z.number().finite().min(-1_000_000).max(1_000_000)
const length = z.number().finite().positive().max(1_000_000)
const rotation = z.number().finite().min(-3600).max(3600)
const point = z.object({ x: coord, y: coord })

export const seatSchema = z.object({
  index: z.int().min(0),
  guestId: z.uuid().nullable(),
  /** Reserved for a future solver: "do not move this guest". */
  pinned: z.boolean().optional(),
})

const base = {
  id: itemId,
  x: coord,
  y: coord,
  rotation,
  locked: z.boolean(),
}

export const tableShapes = ['round', 'square', 'rect'] as const
export const seatSidesValues = ['all', 'noEnds', 'oneSide'] as const

export const tableSchema = z.object({
  ...base,
  kind: z.literal('table'),
  shape: z.enum(tableShapes),
  width: length,
  height: length,
  number: z.int().min(1).max(9999),
  name: z.string().max(100),
  seatCount: z.int().min(0).max(MAX_SEATS_RECT),
  seatSides: z.enum(seatSidesValues),
  seats: z.array(seatSchema).max(MAX_SEATS_RECT),
})

export const fixtureTypes = [
  'food',
  'bar',
  'dj',
  'danceFloor',
  'stage',
  'cake',
  'gifts',
  'photoBooth',
  'ceremonyStructure',
  'officiant',
  'aisleRunner',
  'musicians',
  'soundDesk',
  'welcomeSign',
  'entrance',
  'custom',
] as const

export const fixtureSchema = z.object({
  ...base,
  kind: z.literal('fixture'),
  type: z.enum(fixtureTypes),
  width: length,
  height: length,
  label: z.string().max(200),
})

export const chairRowSchema = z.object({
  ...base,
  kind: z.literal('chairRow'),
  chairCount: z.int().min(1).max(MAX_SEATS_RECT),
  spacing: length,
  blockId: itemId.nullable(),
  blockLabel: z.string().max(100).nullable(),
  rowNumber: z.int().min(1).max(999),
  rowLabel: z.string().max(100),
  reservedFor: z.string().max(200).nullable(),
  seats: z.array(seatSchema).max(MAX_SEATS_RECT),
})

export const shapeTypes = ['rect', 'ellipse', 'line', 'text', 'wall', 'room', 'door', 'window'] as const

const colorString = z.string().max(32)

export const shapeSchema = z.object({
  ...base,
  kind: z.literal('shape'),
  type: z.enum(shapeTypes),
  width: length,
  height: length,
  points: z.array(point).max(2000).optional(),
  text: z.string().max(2000).optional(),
  style: z.object({
    stroke: colorString,
    fill: colorString,
    strokeWidth: z.number().finite().min(0).max(1000),
    fontSize: z.number().finite().positive().max(10_000).optional(),
  }),
})

export const noteTypes = ['sticky', 'text', 'arrow', 'line', 'box', 'circle'] as const
export const noteColors = ['yellow', 'pink', 'blue', 'green', 'purple', 'grey'] as const
export const authors = ['Noa', 'Aiden'] as const

export const noteSchema = z.object({
  ...base,
  kind: z.literal('note'),
  type: z.enum(noteTypes),
  width: length,
  height: length,
  points: z.array(point).max(2000).optional(),
  text: z.string().max(5000),
  color: z.enum(noteColors),
  author: z.enum(authors),
  done: z.boolean(),
  createdAt: z.iso.datetime(),
  attachedTo: z.object({ start: itemId.nullable(), end: itemId.nullable() }),
})

export const itemSchema = z.discriminatedUnion('kind', [
  tableSchema,
  fixtureSchema,
  chairRowSchema,
  shapeSchema,
  noteSchema,
])

/**
 * Structural checks only. Seats held by removed or unknown guests and second
 * seats for one guest are handled by the server's canvas writer, which drops
 * them and reports them instead of refusing the save.
 */
export const canvasSchema = z
  .object({
    schemaVersion: z.literal(CANVAS_SCHEMA_VERSION),
    items: z.array(itemSchema).max(MAX_ITEMS),
  })
  .superRefine((canvas, ctx) => {
    const ids = new Set<string>()
    canvas.items.forEach((item, i) => {
      if (ids.has(item.id)) {
        ctx.addIssue({ code: 'custom', message: `Duplicate item id ${item.id}`, path: ['items', i, 'id'] })
      }
      ids.add(item.id)
      if (item.kind === 'table') {
        if (item.seats.length !== item.seatCount) {
          ctx.addIssue({ code: 'custom', message: 'seats.length must equal seatCount', path: ['items', i, 'seats'] })
        }
        if (item.width < MIN_TABLE_CM - 0.01 || item.height < MIN_TABLE_CM - 0.01) {
          ctx.addIssue({ code: 'custom', message: 'Tables are at least 24 in on every side', path: ['items', i] })
        }
        if (item.shape === 'round' && Math.abs(item.width - item.height) > 0.01) {
          ctx.addIssue({ code: 'custom', message: 'Round tables have width equal to height', path: ['items', i] })
        }
        const max = item.shape === 'rect' ? MAX_SEATS_RECT : MAX_SEATS_ROUND_OR_SQUARE
        if (item.seatCount > max) {
          ctx.addIssue({ code: 'custom', message: `At most ${max} seats on this table`, path: ['items', i, 'seatCount'] })
        }
      }
      if (item.kind === 'chairRow' && item.seats.length !== item.chairCount) {
        ctx.addIssue({ code: 'custom', message: 'seats.length must equal chairCount', path: ['items', i, 'seats'] })
      }
      if (item.kind === 'table' || item.kind === 'chairRow') {
        item.seats.forEach((seat, s) => {
          if (seat.index !== s) {
            ctx.addIssue({ code: 'custom', message: 'Seat indexes run 0..n-1 in order', path: ['items', i, 'seats', s] })
          }
        })
      }
    })
  })

export type Seat = z.infer<typeof seatSchema>
export type Table = z.infer<typeof tableSchema>
export type Fixture = z.infer<typeof fixtureSchema>
export type ChairRow = z.infer<typeof chairRowSchema>
export type Shape = z.infer<typeof shapeSchema>
export type Note = z.infer<typeof noteSchema>
export type Item = z.infer<typeof itemSchema>
export type Canvas = z.infer<typeof canvasSchema>
export type Author = (typeof authors)[number]

export function emptyCanvas(): Canvas {
  return { schemaVersion: CANVAS_SCHEMA_VERSION, items: [] }
}
