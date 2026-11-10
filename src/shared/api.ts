/**
 * The contract between the browser and the route handlers: request bodies
 * (Zod, checked on the server) and reply shapes (types). Both sides import
 * this file, so a change here shows up as a type error on both.
 *
 * Dates travel as ISO strings. Lengths are centimeters.
 */
import { z } from 'zod'
import { authors, canvasSchema, wellFormedText, type Canvas } from '@/domain/canvas-schema'
import { cleanNotes, cleanOneLine } from '@/domain/csv/columns'
import type { ImportPlan } from '@/domain/csv/import-diff'
import { HEX_COLOR_RE } from '@/domain/group-colors'
import type { FloorplanDraft } from '@/domain/floorplan/draft-schema'
import { fixedItemsSchema, importedByValues, referenceMetaSchema, type FixedItem, type ReferenceMeta } from '@/domain/venue-schema'

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

// ---------- Venues ----------
//
// Venue templates are shared by all weddings (PLAN change 5). A template's
// fixed items, reference meta and reference image change only through a save,
// an accepted import or a restored revision; each raises the version, uses the
// same conflict check as layouts (DECISIONS 28) and writes a revision row.
// Renames leave the version alone.

export type VenueImportedBy = (typeof importedByValues)[number]

export type VenueSummary = {
  id: string
  name: string
  updatedAt: string
  /** Live layouts in live weddings that use this template. */
  usedBy: number
  version: number
  editedBy: 'Noa' | 'Aiden' | null
  importedBy: VenueImportedBy
  fixedItemCount: number
  hasReferenceImage: boolean
}

/** The largest floor plan image the server stores (PLAN change 6: the browser aims for about 3 MB). */
export const MAX_VENUE_IMAGE_BYTES = 3.5 * 1024 * 1024
/** The largest side of a stored image, in pixels (the model's own hard limit). */
export const MAX_VENUE_IMAGE_SIDE = 8000

/** A stored floor plan image. `url` serves it behind the site cookie. */
export type VenueImageInfo = {
  id: string
  templateId: string
  contentType: 'image/png' | 'image/jpeg'
  width: number
  height: number
  byteSize: number
  sha256: string
  url: string
  createdAt: string
}

export type VenueDetail = {
  id: string
  name: string
  version: number
  lastSaveId: string | null
  editedBy: 'Noa' | 'Aiden' | null
  updatedAt: string
  importedBy: VenueImportedBy
  fixedItems: FixedItem[]
  /** Where the reference image sits under the fixed items, or null without one. */
  reference: ReferenceMeta | null
  /** The original plan the template points at (set on Accept), or null. */
  referenceImage: VenueImageInfo | null
  /** Live layouts in live weddings that use this template. */
  usedBy: number
}

/** POST /api/venues. 201 VenueDetail. A retry with the same id gives the same template back. */
export const createVenueBody = z.object({ id: uuid.optional(), name, editedBy: author.optional() })
export type CreateVenueBody = z.infer<typeof createVenueBody>

/** PATCH /api/venues/:id: rename only. The version stays as it is. */
export const renameVenueBody = z.object({ name })
export type RenameVenueBody = z.infer<typeof renameVenueBody>

/** POST /api/venues/:id/duplicate. 201 VenueDetail. The default name is "<name> copy". */
export const duplicateVenueBody = z.object({ id: uuid.optional(), name: name.optional(), editedBy: author.optional() })
export type DuplicateVenueBody = z.infer<typeof duplicateVenueBody>

const venueSaveFields = {
  baseVersion: z.int().min(1),
  /** The same id on every retry of the same save. */
  saveId: uuid,
  editedBy: author,
}

/** PUT /api/venues/:id: the template editor's save. */
export const saveVenueBody = z.object({
  ...venueSaveFields,
  fixedItems: fixedItemsSchema,
  reference: referenceMetaSchema.nullable(),
})
export type SaveVenueBody = z.infer<typeof saveVenueBody>

/** POST /api/venues/:id/accept-import: the draft the editor shows, saved in one go. */
export const acceptImportBody = z.object({
  ...venueSaveFields,
  fixedItems: fixedItemsSchema,
  /** An image uploaded to this template (POST /api/venues/:id/images). */
  imageId: uuid,
  reference: referenceMetaSchema,
  importedBy: z.enum(['ai', 'pdf vectors']),
})
export type AcceptImportBody = z.infer<typeof acceptImportBody>

/** POST /api/venues/:id/revisions/:revisionId/restore ("Undo import" and the like). */
export const restoreRevisionBody = z.object(venueSaveFields)
export type RestoreRevisionBody = z.infer<typeof restoreRevisionBody>

/** 200 reply to a save, an accepted import or a restore. */
export type SaveVenueOk = {
  /** 'already-saved': this saveId landed earlier (a retry after a lost reply). */
  status: 'saved' | 'already-saved'
  version: number
  updatedAt: string
  editedBy: 'Noa' | 'Aiden' | null
}

/** 409: someone saved the template since baseVersion. */
export type SaveVenueConflict = {
  error: 'conflict'
  /** A plain sentence to show, naming who saved when known. */
  message: string
  version: number
  updatedAt: string
  editedBy: 'Noa' | 'Aiden' | null
  lastSaveId: string | null
}

/** 410: the template was deleted. 422: a body the server cannot accept. */
export type SaveVenueFailure = { error: 'gone' } | { error: 'invalid'; issues: string[] }

/** One revision: the template's fixed items, reference and image after a save. */
export type VenueRevision = {
  id: string
  reason: 'save' | 'import'
  createdAt: string
  fixedItemCount: number
  referenceImageId: string | null
  hasReference: boolean
}

/** GET /api/venues/:id/revisions: newest first, at most MAX_LISTED_REVISIONS. */
export type VenueRevisionList = {
  revisions: VenueRevision[]
  /** The revision just before the newest import: restoring it is "Undo import". Null without an import. */
  undoImportRevisionId: string | null
}
export const MAX_LISTED_REVISIONS = 200

/** A live layout in a live wedding that uses a template. */
export type VenueUse = { weddingId: string; weddingName: string; layoutId: string; layoutName: string }

/** 409 reply to DELETE /api/venues/:id while layouts use the template. */
export type VenueInUse = { error: 'in_use'; message: string; layouts: VenueUse[] }

/** GET /api/venues/:id/delete-summary. Delete is blocked while `layouts` is not empty. */
export type VenueDeleteSummary = {
  kind: 'venue'
  name: string
  layouts: VenueUse[]
  images: number
  revisions: number
}

/** GET /api/venues/:id/wall-check: every live layout using the template, with the tables a wall runs through. */
export type VenueWallCheck = {
  templateVersion: number
  layouts: (VenueUse & { tables: { tableId: string; label: string; wallIds: string[] }[] })[]
}

// ---------- Floor plan import ----------

const pixel = z.number().finite().min(-1_000_000).max(1_000_000)
const pixelPoint = z.object({ x: pixel, y: pixel })

/** The most PDF lines, texts and door hints one import may send. */
export const MAX_IMPORT_SEGMENTS = 2000
export const MAX_IMPORT_LABELS = 2000
export const MAX_IMPORT_DOOR_HINTS = 500

/**
 * POST /api/venues/:id/import. The image is one uploaded to this template,
 * with its size as stored. For a vector PDF, `segments` are the cleaned lines
 * (src/domain/floorplan/cleanup.ts) and `labels` the PDF's text, both in the
 * image's pixels; without segments the plan is read as a picture.
 */
export const floorplanImportBody = z.object({
  imageId: uuid,
  imageWidth: z.int().min(1).max(MAX_VENUE_IMAGE_SIDE),
  imageHeight: z.int().min(1).max(MAX_VENUE_IMAGE_SIDE),
  segments: z
    .array(
      z.object({
        id: z.string().regex(/^[A-Za-z0-9_-]{1,16}$/, 'Line ids are short letters and digits'),
        x1: pixel,
        y1: pixel,
        x2: pixel,
        y2: pixel,
        thickness: z.number().finite().min(0).max(100_000),
        source: z.enum(['stroke', 'fill']),
      }),
    )
    .max(MAX_IMPORT_SEGMENTS)
    .optional(),
  labels: z
    .array(z.object({ text: z.string().overwrite(wellFormedText).trim().min(1).max(200), center: pixelPoint }))
    .max(MAX_IMPORT_LABELS)
    .optional(),
  doorHints: z
    .array(
      z.object({
        hinge: pixelPoint,
        radius: z.number().finite().positive().max(1_000_000),
        from: pixelPoint,
        to: pixelPoint,
        sweep: z.number().finite(),
      }),
    )
    .max(MAX_IMPORT_DOOR_HINTS)
    .optional(),
})
  .superRefine((body, ctx) => {
    const seen = new Set<string>()
    body.segments?.forEach((s, i) => {
      if (seen.has(s.id)) ctx.addIssue({ code: 'custom', path: ['segments', i, 'id'], message: `Line id ${s.id} is sent twice` })
      seen.add(s.id)
    })
  })
export type FloorplanImportBody = z.input<typeof floorplanImportBody>

/**
 * The import route answers 200 with NDJSON (one JSON object per line):
 * progress lines about every 2 seconds, then one draft or error line. Errors
 * found before the call starts are ordinary JSON replies instead (404, 400,
 * 422, and 503 ImportNotConfigured).
 */
export type FloorplanImportLine =
  | {
      type: 'progress'
      elapsedMs: number
      /** Output tokens so far (an estimate until the reply ends). */
      outputTokens: number
    }
  | { type: 'draft'; draft: FloorplanDraft; model: string; outputTokens: number }
  | { type: 'error'; code: FloorplanImportErrorCode; message: string }

export type FloorplanImportErrorCode =
  | 'refusal'
  | 'max_tokens'
  | 'invalid_reply'
  | 'timeout'
  | 'auth'
  | 'busy'
  | 'bad_request'
  | 'unavailable'
  | 'failed'

/** 503 from the import route when the server has no ANTHROPIC_API_KEY. */
export type ImportNotConfigured = { error: 'not_configured'; message: string }
export const IMPORT_NOT_CONFIGURED_MESSAGE = 'The floor plan import needs ANTHROPIC_API_KEY set on the server.'

// ---------- Guests ----------

export const guestSides = ['Noa', 'Aiden', 'Both'] as const
export const guestRsvps = ['yes', 'no', 'pending'] as const
export type GuestSide = (typeof guestSides)[number]
export type GuestRsvp = (typeof guestRsvps)[number]

/**
 * The most rows one request may carry: pasted names, an import preview or an
 * import commit. More gives 413. Equal to MAX_IMPORT_ROWS in the CSV parser.
 */
export const MAX_GUEST_ROWS = 5000

/** First or last name: cleaned like the import's cells (spaces collapsed), not empty. */
const guestName = z.string().overwrite(cleanOneLine).min(1, 'Names cannot be empty').max(200)
/** One line of free text. Blank becomes null, so a cleared cell clears the field. */
const optionalLine = (max: number) =>
  z
    .string()
    .overwrite(cleanOneLine)
    .max(max)
    .nullable()
    .transform((v) => (v === '' ? null : v))
/** Notes: line breaks kept (LF), spaces tidied. Blank becomes null. */
const optionalNotes = z
  .string()
  .overwrite(cleanNotes)
  .max(10_000)
  .nullable()
  .transform((v) => (v === '' ? null : v))

/** A live guest. */
export type Guest = {
  id: string
  weddingId: string
  firstName: string
  lastName: string
  nickname: string | null
  /** Set on both partners (PLAN section 4). */
  partnerId: string | null
  /** The couple rule switch, kept the same on both partners (PLAN change 8). */
  coupleRuleEnabled: boolean
  household: string | null
  side: GuestSide
  rsvp: GuestRsvp
  meal: string | null
  isChild: boolean
  notes: string | null
  /** The groups the guest is in. */
  groupIds: string[]
  createdAt: string
  updatedAt: string
}

const guestFields = {
  nickname: optionalLine(100).optional(),
  household: optionalLine(200).optional(),
  side: z.enum(guestSides).optional(),
  rsvp: z.enum(guestRsvps).optional(),
  meal: optionalLine(200).optional(),
  isChild: z.boolean().optional(),
  notes: optionalNotes.optional(),
}

/** POST /api/weddings/:id/guests. Unset fields take their defaults (side Both, RSVP pending). */
export const createGuestBody = z.object({
  /** The browser may choose the id, so a retried create is harmless. */
  id: uuid.optional(),
  firstName: guestName,
  lastName: guestName,
  ...guestFields,
})
export type CreateGuestBody = z.input<typeof createGuestBody>

/** POST /api/weddings/:id/guests/bulk: pasted names, after the preview. All or nothing. */
export const bulkGuestsBody = z
  .object({ guests: z.array(createGuestBody).min(1).max(MAX_GUEST_ROWS) })
  .superRefine((body, ctx) => {
    const seen = new Set<string>()
    body.guests.forEach((g, i) => {
      if (!g.id) return
      const id = g.id.toLowerCase()
      if (seen.has(id)) ctx.addIssue({ code: 'custom', path: ['guests', i, 'id'], message: 'This id is sent twice' })
      seen.add(id)
    })
  })
export type BulkGuestsBody = z.input<typeof bulkGuestsBody>

/**
 * PATCH /api/guests/:id with only the changed fields (PLAN section 5).
 * partnerId links the two guests both ways, clears any earlier partner of
 * either, and turns the couple rule on for both (PLAN change 8); null
 * unlinks. coupleRuleEnabled sets the switch on the guest and their partner.
 */
export const updateGuestBody = z
  .object({
    firstName: guestName.optional(),
    lastName: guestName.optional(),
    ...guestFields,
    partnerId: uuid.nullable().optional(),
    coupleRuleEnabled: z.boolean().optional(),
    /**
     * With partnerId: the partner of each guest involved as this browser last
     * saw it (guest id to partner id, or null for none), such as
     * { [me]: oldPartner, [newPartner]: theirOldPartner }. If any has changed
     * since, the reply is 409 GuestConflict and nothing changes.
     */
    expectedPartners: z.record(uuid, uuid.nullable()).optional(),
  })
  .refine((b) => Object.keys(b).some((k) => k !== 'expectedPartners'), 'Nothing to change')
export type UpdateGuestBody = z.input<typeof updateGuestBody>

/** 200 reply to PATCH /api/guests/:id. */
export type UpdateGuestReply = {
  guest: Guest
  /** Other guests the change touched (old and new partners), as they are now. */
  alsoChanged: Guest[]
}

/** 409 reply to a partner change: someone changed one of the links a moment earlier, or a guest is gone. */
export type GuestConflict = {
  error: 'conflict'
  message: string
  /** The guests involved that are still on the list, as they are now. */
  guests: Guest[]
}

/** A seat a guest holds in a live layout. GET /api/weddings/:id/guests/seats lists every live guest's. */
export type GuestSeatPlace = { guestId: string; layoutId: string; layoutName: string; itemLabel: string }

/** GET /api/guests/:id/delete-summary: what the delete dialog lists. */
export type GuestDeleteSummary = {
  kind: 'guest'
  /** "First Last" */
  name: string
  /** Seats removing the guest clears, in live layouts, by layout name then table. */
  seats: GuestSeatPlace[]
  /** The partner whose link is cleared, if any. */
  partnerName: string | null
  /** Groups and rules the guest leaves. */
  groups: number
  rules: number
}

/** 200 reply to DELETE /api/guests/:id (no body needed). */
export type DeleteGuestReply = { ok: true; clearedSeats: GuestSeatPlace[] }

// ---------- Guest CSV import ----------

/** Spreadsheet row numbers travel as JSON object keys. */
const rowKey = z.string().regex(/^[1-9]\d{0,6}$/, 'Row numbers are whole numbers')
const optionalCell = (max: number) =>
  z
    .string()
    .overwrite(cleanOneLine)
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined))
export const GROUP_NAME_SEMICOLON = 'Group names cannot hold a semicolon.'
/**
 * A group name. No ";": the CSV groups cell splits on it, so a name holding
 * one would come back from an export as two groups.
 */
const groupName = z
  .string()
  .overwrite(cleanOneLine)
  .min(1, 'Group names cannot be empty')
  .max(100)
  .refine((v) => !v.includes(';'), GROUP_NAME_SEMICOLON.slice(0, -1))

/** One row of the file after column matching (ImportRow in src/domain/csv/columns.ts). */
export const importRowBody = z.object({
  rowNumber: z.int().min(1).max(9_999_999),
  /** Any 8-4-4-4-12 hex id: one that is not a guest of this wedding is matched by name instead. */
  guestId: z
    .guid()
    .overwrite((v) => v.toLowerCase())
    .optional(),
  firstName: guestName,
  lastName: guestName,
  nickname: optionalCell(100),
  partnerName: optionalCell(400),
  household: optionalCell(200),
  side: z.enum(guestSides).optional(),
  rsvp: z.enum(guestRsvps).optional(),
  meal: optionalCell(200),
  isChild: z.boolean().optional(),
  notes: z
    .string()
    .overwrite(cleanNotes)
    .max(10_000)
    .optional()
    .transform((v) => (v ? v : undefined)),
  groups: z.array(groupName).max(50),
  extraNotes: z.array(z.string().overwrite(cleanOneLine).min(1).max(5000)).max(100),
})
export type ImportRowBody = z.input<typeof importRowBody>

/** A needs-review pick: the guest the row is, or 'new' to add it as a new guest. */
const reviewPick = z.union([uuid.overwrite((v) => v.toLowerCase()), z.literal('new')])
/** An unmatched-partner pick: a guest, a row of the file, or null for no partner. */
const partnerPick = z.union([
  z.strictObject({ guestId: uuid.overwrite((v) => v.toLowerCase()) }),
  z.strictObject({ rowNumber: z.int().min(1).max(9_999_999) }),
  z.null(),
])

const importBodyFields = {
  rows: z.array(importRowBody).min(1).max(MAX_GUEST_ROWS),
  /** Needs-review picks by row number. */
  reviewPicks: z.record(rowKey, reviewPick).optional(),
  /** Unmatched-partner picks by row number. */
  partnerPicks: z.record(rowKey, partnerPick).optional(),
}

function uniqueRowNumbers(body: { rows: { rowNumber: number }[] }, ctx: z.RefinementCtx) {
  const seen = new Set<number>()
  body.rows.forEach((row, i) => {
    if (seen.has(row.rowNumber)) {
      ctx.addIssue({ code: 'custom', path: ['rows', i, 'rowNumber'], message: `Row ${row.rowNumber} is sent twice` })
    }
    seen.add(row.rowNumber)
  })
}

/** POST /api/weddings/:id/guests/import/preview. Over MAX_GUEST_ROWS rows gives 413. */
export const importPreviewBody = z.object(importBodyFields).superRefine(uniqueRowNumbers)
export type ImportPreviewBody = z.input<typeof importPreviewBody>

/**
 * POST /api/weddings/:id/guests/import/commit. The server builds the plan
 * again from these rows and picks, refuses (422 needs_review) while any
 * needs-review row has no pick, then applies it all in one transaction.
 */
export const importCommitBody = z
  .object({
    ...importBodyFields,
    /** Remove the guests in the wedding that the file leaves out. */
    removeMissing: z.boolean(),
    /**
     * The missing guests the summary showed, required with removeMissing.
     * When the server's list differs (someone added or removed a guest since
     * the preview), the reply is 409 { error: 'stale' } and nothing changes.
     */
    missingGuestIds: z.array(uuid.overwrite((v) => v.toLowerCase())).max(100_000).optional(),
  })
  .superRefine(uniqueRowNumbers)
  .superRefine((body, ctx) => {
    // Without the list there is nothing to check the removal against.
    if (body.removeMissing && body.missingGuestIds === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['missingGuestIds'],
        message: 'List the missing guests the summary showed',
      })
    }
  })
export type ImportCommitBody = z.input<typeof importCommitBody>

export type { ImportPlan }

/** 200 reply to the preview: the plan, and where the guests missing from the file sit. */
export type ImportPreview = {
  plan: ImportPlan
  /** Seats in live layouts held by guests in plan.missing. Removing them clears these. */
  missingSeats: GuestSeatPlace[]
}

/** 200 reply to the commit. */
export type ImportCommitResult = {
  created: number
  /** Guests with any change: fields, notes, partner or groups. */
  updated: number
  unchanged: number
  groupsCreated: number
  membershipsAdded: number
  partnersLinked: number
  removed: number
  /** Seats emptied in live layouts by removing missing guests. */
  clearedSeats: GuestSeatPlace[]
}

/** 422 reply to a commit while needs-review rows have no pick. `issues` says which. */
export type ImportNeedsReview = { error: 'needs_review'; issues: string[]; rowNumbers: number[] }

// ---------- Groups ----------

const hexColor = z
  .string()
  .regex(HEX_COLOR_RE, 'Colors are written like #2563EB')
  .overwrite((v) => v.toUpperCase())

/** Group names are unique in a wedding, ignoring case. */
export type Group = {
  id: string
  weddingId: string
  name: string
  /** #RRGGBB */
  color: string
  /** Live guests in the group. */
  memberIds: string[]
  createdAt: string
  updatedAt: string
}

/** POST /api/weddings/:id/groups. Without a color the group takes the next palette color. */
export const createGroupBody = z.object({
  id: uuid.optional(),
  name: groupName,
  color: hexColor.optional(),
  /** Members to add at once. */
  guestIds: z.array(uuid).max(MAX_GUEST_ROWS).optional(),
})
export type CreateGroupBody = z.input<typeof createGroupBody>

/** PATCH /api/groups/:id: rename or recolor. */
export const updateGroupBody = z
  .object({ name: groupName.optional(), color: hexColor.optional() })
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change')
export type UpdateGroupBody = z.input<typeof updateGroupBody>

/** POST /api/groups/:id/members. Guests already in the group are skipped. */
export const addGroupMembersBody = z.object({ guestIds: z.array(uuid).min(1).max(MAX_GUEST_ROWS) })
export type AddGroupMembersBody = z.input<typeof addGroupMembersBody>

/** 200 reply to POST /api/groups/:id/members. */
export type AddGroupMembersReply = {
  group: Group
  /** The guests this call added (not the ones already in it). */
  added: string[]
}

// ---------- Rules ----------
//
// Stored rules (spec section 7, PLAN section 4). Couple rules have no rows
// (PLAN change 8): they come from the guests' partner links and couple rule
// switches, through coupleRules() in src/domain/rules.ts, and are switched
// with PATCH /api/rules/couple. A StoredRule fits the domain's Rule, so a
// list goes straight into evaluateRules, clashes and dragTint.

export const ruleKinds = ['together', 'apart'] as const
export const ruleAppliesToValues = ['reception', 'ceremony', 'both'] as const

export type StoredRule = {
  id: string
  weddingId: string
  kind: (typeof ruleKinds)[number]
  /** Live guests only, by last name then first name. Removed guests' links stay in the database, hidden. */
  guestIds: string[]
  /** Only ever true on a together rule. */
  nextToEachOther: boolean
  appliesTo: (typeof ruleAppliesToValues)[number]
  enabled: boolean
  note: string | null
  /** Fewer than two live guests are left (PLAN change 7): shown as "needs guests" and not checked. */
  needsGuests: boolean
  createdAt: string
  updatedAt: string
}

export const RULE_NEEDS_TWO = 'A rule needs two or more guests'
export const NEXT_TO_ONLY_TOGETHER = 'Next to each other is only for together rules'

/**
 * Two or more different guests. Repeats are dropped, so adding a whole group
 * that holds someone already picked is fine. Adding a group copies its
 * members as they are now; later group changes leave the rule alone (PLAN
 * section 4).
 */
const ruleGuestIds = z
  .array(uuid.overwrite((v) => v.toLowerCase()))
  .max(MAX_GUEST_ROWS)
  .overwrite((ids) => [...new Set(ids)])
  .refine((ids) => ids.length >= 2, RULE_NEEDS_TWO)

/** POST /api/weddings/:id/rules. Defaults: not next to each other, both layout kinds, on. */
export const createRuleBody = z
  .object({
    /** The browser may choose the id, so a retried create is harmless. */
    id: uuid.optional(),
    kind: z.enum(ruleKinds),
    guestIds: ruleGuestIds,
    nextToEachOther: z.boolean().optional(),
    appliesTo: z.enum(ruleAppliesToValues).optional(),
    enabled: z.boolean().optional(),
    note: optionalNotes.optional(),
  })
  .refine((b) => b.kind === 'together' || !b.nextToEachOther, { path: ['nextToEachOther'], message: NEXT_TO_ONLY_TOGETHER })
export type CreateRuleBody = z.input<typeof createRuleBody>

/**
 * PATCH /api/rules/:id with only the changed fields. guestIds replaces the
 * rule's guest list. Turning a rule into an apart rule turns next to each
 * other off; asking for next to each other on an apart rule is refused (422).
 */
export const updateRuleBody = z
  .object({
    kind: z.enum(ruleKinds).optional(),
    guestIds: ruleGuestIds.optional(),
    nextToEachOther: z.boolean().optional(),
    appliesTo: z.enum(ruleAppliesToValues).optional(),
    enabled: z.boolean().optional(),
    note: optionalNotes.optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change')
  .refine((b) => !(b.kind === 'apart' && b.nextToEachOther === true), {
    path: ['nextToEachOther'],
    message: NEXT_TO_ONLY_TOGETHER,
  })
export type UpdateRuleBody = z.input<typeof updateRuleBody>

/**
 * PATCH /api/rules/couple: switches a couple rule on or off (PLAN change 8).
 * The switch is set on both partners in one transaction. The two guests must
 * still be linked to each other; otherwise the reply is 409 GuestConflict and
 * nothing changes.
 */
export const coupleRuleBody = z.object({
  guestIds: z
    .tuple([uuid.overwrite((v) => v.toLowerCase()), uuid.overwrite((v) => v.toLowerCase())])
    .refine(([a, b]) => a !== b, 'A couple is two different guests'),
  enabled: z.boolean(),
})
export type CoupleRuleBody = z.input<typeof coupleRuleBody>

/** 200 reply to PATCH /api/rules/couple: both partners as they are now, in the order sent. */
export type CoupleRuleReply = { guests: Guest[] }

// ---------- Errors ----------

/**
 * Every non-2xx JSON reply has an `error` field. 422 replies list `issues`
 * ("field: message"); 409, 413, 415 and 503 replies carry a plain `message` to show.
 */
export type ApiError = { error: string; issues?: string[]; message?: string }
