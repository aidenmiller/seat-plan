/**
 * The contract between the browser and the route handlers: request bodies
 * (Zod, checked on the server) and reply shapes (types). Both sides import
 * this file, so a change here shows up as a type error on both.
 *
 * Dates travel as ISO strings. Lengths are centimeters.
 */
import { z } from 'zod'
import { authors, canvasSchema, wellFormedText, type Canvas } from '@/domain/canvas-schema'
import type { FixedItem } from '@/domain/venue-schema'

export const uuid = z.uuid()
/** Cleaned like the canvas text (no NUL, no lone surrogates), then trimmed. */
const name = z.string().overwrite(wellFormedText).trim().min(1, 'Names cannot be empty').max(200)
const author = z.enum(authors)

// ---------- Weddings ----------

export type WeddingSummary = {
  id: string
  name: string
  /** YYYY-MM-DD */
  date: string | null
  unit: 'ft' | 'm'
  minGapCm: number
  guestCount: number
  layoutCount: number
  updatedAt: string
}

export const createWeddingBody = z.object({
  /** The browser may choose the id, so a retried create is harmless. */
  id: uuid.optional(),
  name,
  date: z.iso.date().nullable().optional(),
  unit: z.enum(['ft', 'm']).optional(),
})
export type CreateWeddingBody = z.infer<typeof createWeddingBody>

export const updateWeddingBody = z
  .object({
    name: name.optional(),
    date: z.iso.date().nullable().optional(),
    unit: z.enum(['ft', 'm']).optional(),
    minGapCm: z.number().finite().positive().max(10_000).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change')
export type UpdateWeddingBody = z.infer<typeof updateWeddingBody>

/** Every delete needs the typed word (spec section 10). */
export const deleteBody = z.object({ confirm: z.literal('delete') })

export type WeddingDeleteSummary = {
  kind: 'wedding'
  name: string
  layouts: number
  guests: number
  groups: number
  rules: number
}

// ---------- Layouts ----------

export type LayoutKind = 'reception' | 'ceremony'

export type LayoutSummary = {
  id: string
  weddingId: string
  name: string
  kind: LayoutKind
  venueTemplateId: string | null
  /** Null for a blank canvas. */
  venueName: string | null
  /** True when the layout's venue template was deleted (the name is then the old one). */
  venueDeleted: boolean
  version: number
  editedBy: 'Noa' | 'Aiden' | null
  updatedAt: string
  /** Small vector preview drawn by the server (an SVG document, no scripts). */
  thumbSvg: string
}

export type LayoutTemplateInfo = {
  id: string
  name: string
  version: number
  fixedItems: FixedItem[]
  /** True when the template was deleted after this layout chose it. */
  deleted: boolean
}

export type LayoutDetail = LayoutSummary & {
  canvas: Canvas
  lastSaveId: string | null
  /**
   * The ids of the most recent saves that landed (newest first, up to 20),
   * so a tab can tell that its own save landed even after someone saved since.
   */
  recentSaveIds: string[]
  template: LayoutTemplateInfo | null
}

export const createLayoutBody = z.object({
  id: uuid.optional(),
  name,
  kind: z.enum(['reception', 'ceremony']),
  venueTemplateId: uuid.nullable(),
  editedBy: author,
})
export type CreateLayoutBody = z.infer<typeof createLayoutBody>

export const updateLayoutBody = z
  .object({ name: name.optional(), venueTemplateId: uuid.nullable().optional() })
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change')
export type UpdateLayoutBody = z.infer<typeof updateLayoutBody>

/** PUT /api/layouts/:id (PLAN section 5, "Saving layouts"). */
export const saveLayoutBody = z.object({
  baseVersion: z.int().min(1),
  /** The same id on every retry of the same snapshot. */
  saveId: uuid,
  editedBy: author,
  tabId: z.string().min(1).max(64),
  canvas: canvasSchema,
})
export type SaveLayoutBody = z.infer<typeof saveLayoutBody>

/** A seat the server emptied while saving, and why. */
export type DroppedSeat = {
  itemId: string
  seatIndex: number
  guestId: string
  reason: 'removed-guest' | 'unknown-guest' | 'second-seat'
}

export type SaveLayoutOk = {
  /** 'already-saved': this saveId landed earlier (a retry after a lost reply). */
  status: 'saved' | 'already-saved'
  version: number
  updatedAt: string
  editedBy: 'Noa' | 'Aiden' | null
  /** Seats the server emptied. The editor applies the same change on screen. */
  droppedSeats: DroppedSeat[]
}

/** 409 */
export type SaveLayoutConflict = {
  error: 'conflict'
  version: number
  updatedAt: string
  editedBy: 'Noa' | 'Aiden' | null
  lastSaveId: string | null
  /** As in LayoutDetail. */
  recentSaveIds: string[]
}

/** 410: the layout or its wedding was deleted. 422: a canvas the server cannot fix. */
export type SaveLayoutFailure = { error: 'gone' } | { error: 'invalid'; issues: string[] }

export type LayoutVersionInfo = {
  version: number
  updatedAt: string
  editedBy: 'Noa' | 'Aiden' | null
  lastSaveId: string | null
  /** As in LayoutDetail. */
  recentSaveIds: string[]
}

/** Duplicate, and "keep mine as a new copy" (which sends its canvas). */
export const duplicateLayoutBody = z.object({
  id: uuid.optional(),
  name: name.optional(),
  canvas: canvasSchema.optional(),
  editedBy: author,
})
export type DuplicateLayoutBody = z.infer<typeof duplicateLayoutBody>

export type LayoutDeleteSummary = {
  kind: 'layout'
  name: string
  tables: number
  seatedGuests: number
  notes: number
  shareLinks: number
}

// ---------- Venues (list only in milestone 2) ----------

export type VenueSummary = {
  id: string
  name: string
  updatedAt: string
  /** Live layouts in live weddings that use this template. */
  usedBy: number
}

// ---------- Errors ----------

/** Every non-2xx JSON reply has an `error` field. */
export type ApiError = { error: string; issues?: string[] }
