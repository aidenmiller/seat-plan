/**
 * Fixed items that belong to a venue template: walls, rooms and the rest.
 * Every length is in centimeters. Layouts that use a template draw these on a
 * locked bottom layer.
 */
import { z } from 'zod'

const itemId = z.string().min(1).max(64)
const coord = z.number().finite().min(-1_000_000).max(1_000_000)
const length = z.number().finite().positive().max(1_000_000)
const rotation = z.number().finite().min(-3600).max(3600)
const point = z.object({ x: coord, y: coord })

const common = {
  id: itemId,
  name: z.string().max(200).optional(),
  /** Set by the AI import when the model was not sure of this item. */
  unsure: z.boolean(),
  unsureNote: z.string().max(500),
}

const box = { x: coord, y: coord, width: length, height: length, rotation }

export const fixedItemSchema = z.discriminatedUnion('type', [
  z.object({ ...common, type: z.literal('wall'), points: z.array(point).min(2).max(5000), thickness: length }),
  z.object({ ...common, type: z.literal('room'), points: z.array(point).min(3).max(5000) }),
  z.object({ ...common, type: z.literal('zone'), points: z.array(point).min(3).max(5000) }),
  z.object({ ...common, type: z.literal('patioEdge'), points: z.array(point).min(2).max(5000) }),
  z.object({
    ...common,
    type: z.literal('door'),
    wallId: itemId.nullable(),
    x: coord,
    y: coord,
    rotation,
    width: length,
    swing: z.enum(['left', 'right', 'double', 'none']),
  }),
  z.object({ ...common, type: z.literal('window'), wallId: itemId.nullable(), x: coord, y: coord, rotation, width: length }),
  z.object({ ...common, type: z.literal('column'), shape: z.enum(['rect', 'round']), ...box }),
  z.object({ ...common, type: z.literal('stairs'), ...box }),
  z.object({ ...common, type: z.literal('bar'), ...box, label: z.string().max(200) }),
  z.object({ ...common, type: z.literal('label'), x: coord, y: coord, rotation, text: z.string().max(500), fontSize: length }),
])

export const fixedItemsSchema = z.array(fixedItemSchema).max(20_000)

/** Where the original floor plan image sits under the fixed items. */
export const referenceMetaSchema = z.object({
  scaleCmPerPx: z.number().finite().positive(),
  offsetX: coord,
  offsetY: coord,
  rotation,
  opacity: z.number().min(0).max(1),
})

export type FixedItem = z.infer<typeof fixedItemSchema>
export type ReferenceMeta = z.infer<typeof referenceMetaSchema>
export const importedByValues = ['hand', 'pdf vectors', 'ai'] as const
export type ImportedBy = (typeof importedByValues)[number]
