/**
 * The backup file (spec section 11, PLAN section 7 "Backup and restore"): one
 * JSON document holding a wedding's guests, groups, rules, layouts and the
 * venue templates those layouts use, with each template's floor plan image as
 * base64. Share links are left out.
 *
 * The browser checks a file with backupFileSchema before restoring it, and
 * the server checks each restore step with the matching part (restoreStartSchema,
 * backupLayoutSchema, backupTemplateSchema), so both read the file the same way.
 */
import { z } from 'zod'
import { canvasSchema, cleanText, wellFormedText } from '../canvas-schema'
import { cleanNotes, cleanOneLine } from '../csv/columns'
import { HEX_COLOR_RE } from '../group-colors'
import { fixedItemsSchema, importedByValues, referenceMetaSchema } from '../venue-schema'

export const BACKUP_FORMAT = 'seat-plan-backup'
export const BACKUP_VERSION = 1

/** The most rows of each kind a backup may hold. Guests match MAX_GUEST_ROWS in src/shared/api.ts. */
export const BACKUP_LIMITS = {
  guests: 5000,
  groups: 500,
  groupMembers: 100_000,
  rules: 2000,
  ruleGuests: 100_000,
  layouts: 200,
  templates: 200,
} as const

const id = z.uuid().overwrite((v) => v.toLowerCase())
const line = (max: number) => z.string().overwrite(cleanOneLine).max(max)
const name = line(200).min(1, 'Names cannot be empty')
/** One line of text or null; blank becomes null. */
const optionalLine = (max: number) =>
  line(max)
    .nullable()
    .transform((v) => (v ? v : null))
const optionalNotes = z
  .string()
  .overwrite(cleanNotes)
  .max(10_000)
  .nullable()
  .transform((v) => (v ? v : null))

export const backupWeddingSchema = z.object({
  id,
  name,
  date: z.iso.date().nullable(),
  unit: z.enum(['ft', 'm']),
  minGapCm: z.number().finite().positive().max(10_000),
})

export const backupGuestSchema = z.object({
  id,
  firstName: name,
  lastName: name,
  nickname: optionalLine(100),
  partnerId: id.nullable(),
  coupleRuleEnabled: z.boolean(),
  household: optionalLine(200),
  side: z.enum(['Noa', 'Aiden', 'Both']),
  rsvp: z.enum(['yes', 'no', 'pending']),
  meal: optionalLine(200),
  isChild: z.boolean(),
  notes: optionalNotes,
})

export const backupGroupSchema = z.object({
  id,
  name: line(100)
    .min(1, 'Group names cannot be empty')
    .refine((v) => !v.includes(';'), 'Group names cannot hold a semicolon'),
  color: z
    .string()
    .regex(HEX_COLOR_RE)
    .overwrite((v) => v.toUpperCase()),
})

export const backupRuleSchema = z
  .object({
    id,
    kind: z.enum(['together', 'apart']),
    nextToEachOther: z.boolean(),
    appliesTo: z.enum(['reception', 'ceremony', 'both']),
    enabled: z.boolean(),
    note: z
      .string()
      .overwrite(wellFormedText)
      .max(2000)
      .nullable()
      .transform((v) => (v ? v : null)),
  })
  .refine((r) => r.kind === 'together' || !r.nextToEachOther, 'Only together rules can keep guests next to each other')

export const backupLayoutSchema = z.object({
  id,
  name,
  kind: z.enum(['reception', 'ceremony']),
  venueTemplateId: id.nullable(),
  // A display name, any string (a backup can name someone besides Noa and Aiden).
  editedBy: cleanText(200).nullable(),
  canvas: canvasSchema,
})

export const backupTemplateSchema = z.object({
  id,
  name,
  fixedItems: fixedItemsSchema,
  reference: referenceMetaSchema.nullable(),
  importedBy: z.enum(importedByValues),
  /** The template's floor plan image, in the file's images list, or null without one. */
  imageId: id.nullable(),
})

/** Base64 of an image of at most 3.5 MB (MAX_VENUE_IMAGE_BYTES). */
const MAX_IMAGE_BASE64 = Math.ceil((3.5 * 1024 * 1024) / 3) * 4

export const backupImageSchema = z.object({
  id,
  templateId: id,
  contentType: z.enum(['image/png', 'image/jpeg']),
  width: z.int().min(1).max(8000),
  height: z.int().min(1).max(8000),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  data: z
    .string()
    .max(MAX_IMAGE_BASE64)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/, 'Image data must be base64'),
})

const header = {
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(BACKUP_VERSION),
}

const weddingRows = {
  wedding: backupWeddingSchema,
  guests: z.array(backupGuestSchema).max(BACKUP_LIMITS.guests),
  groups: z.array(backupGroupSchema).max(BACKUP_LIMITS.groups),
  groupMembers: z.array(z.object({ groupId: id, guestId: id })).max(BACKUP_LIMITS.groupMembers),
  rules: z.array(backupRuleSchema).max(BACKUP_LIMITS.rules),
  ruleGuests: z.array(z.object({ ruleId: id, guestId: id })).max(BACKUP_LIMITS.ruleGuests),
}

type WeddingRows = { guests: { id: string }[]; groups: { id: string; name: string }[]; rules: { id: string }[] }

/**
 * Every guest, group and rule id appears once, across all three lists (they
 * share one old-to-new id map), and group names are unique ignoring case, as
 * the database requires.
 */
function checkWeddingRows(rows: WeddingRows, ctx: z.RefinementCtx) {
  const seen = new Set<string>()
  for (const [list, items] of [
    ['guests', rows.guests],
    ['groups', rows.groups],
    ['rules', rows.rules],
  ] as const) {
    items.forEach((item, i) => {
      if (seen.has(item.id)) ctx.addIssue({ code: 'custom', path: [list, i, 'id'], message: `The id ${item.id} appears twice` })
      seen.add(item.id)
    })
  }
  const names = new Set<string>()
  rows.groups.forEach((group, i) => {
    const key = group.name.toLowerCase()
    if (names.has(key)) ctx.addIssue({ code: 'custom', path: ['groups', i, 'name'], message: `Two groups are named ${group.name}` })
    names.add(key)
  })
}

/**
 * The first restore step, POST /api/weddings/restore: the wedding and its
 * rows. `jobId` is chosen by the browser, so a retried first step finds the
 * wedding the first try made instead of making a second one.
 */
export const restoreStartSchema = z
  .object({ ...header, jobId: id.optional(), ...weddingRows })
  .superRefine(checkWeddingRows)

/** A whole backup file. */
export const backupFileSchema = z
  .object({
    ...header,
    exportedAt: z.iso.datetime({ offset: true }),
    ...weddingRows,
    layouts: z.array(backupLayoutSchema).max(BACKUP_LIMITS.layouts),
    templates: z.array(backupTemplateSchema).max(BACKUP_LIMITS.templates),
    images: z.array(backupImageSchema).max(BACKUP_LIMITS.templates),
  })
  .superRefine(checkWeddingRows)
  .superRefine((file, ctx) => {
    const layoutIds = new Set<string>()
    file.layouts.forEach((layout, i) => {
      if (layoutIds.has(layout.id)) ctx.addIssue({ code: 'custom', path: ['layouts', i, 'id'], message: `The layout ${layout.id} appears twice` })
      layoutIds.add(layout.id)
    })
    const templateIds = new Set<string>()
    file.templates.forEach((template, i) => {
      if (templateIds.has(template.id)) ctx.addIssue({ code: 'custom', path: ['templates', i, 'id'], message: `The venue ${template.id} appears twice` })
      templateIds.add(template.id)
    })
  })

export type BackupWedding = z.output<typeof backupWeddingSchema>
export type BackupGuest = z.output<typeof backupGuestSchema>
export type BackupGroup = z.output<typeof backupGroupSchema>
export type BackupRule = z.output<typeof backupRuleSchema>
export type BackupLayout = z.output<typeof backupLayoutSchema>
export type BackupTemplate = z.output<typeof backupTemplateSchema>
export type BackupImage = z.output<typeof backupImageSchema>
export type BackupFile = z.output<typeof backupFileSchema>
export type RestoreStart = z.output<typeof restoreStartSchema>
/** What the browser sends for the first step (before Zod fills in or cleans anything). */
export type RestoreStartInput = z.input<typeof restoreStartSchema>
export type BackupLayoutInput = z.input<typeof backupLayoutSchema>
export type BackupTemplateInput = z.input<typeof backupTemplateSchema>
