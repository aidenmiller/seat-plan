/**
 * The backup file (spec section 11, PLAN section 7 "Backup and restore"): one
 * JSON document holding a wedding's guests, groups, rules, layouts and the
 * venue templates those layouts use, with each template's floor plan image as
 * base64. Share links are left out.
 *
 * The browser checks a file with backupFileSchema before restoring it, and
 * the server checks each restore step with the matching part (restoreStartSchema,
 * backupLayoutSchema, backupTemplateSchema), so both read the file the same way.
 *
 * Version 2 adds the partners' names to the wedding, stores guest sides as
 * 'partner1' / 'partner2' / 'both' (migration 0007), and lists the wedding's
 * members. A version 1 file (sides 'Noa' / 'Aiden' / 'Both') still reads: the
 * two schemas upgrade it to version 2 (upgrade.ts), so nothing after them
 * sees version 1. Members are for reading only; a restore never adds them.
 */
import { z } from 'zod'
import { canvasSchema, cleanText, wellFormedText } from '../canvas-schema'
import { cleanNotes, cleanOneLine } from '../csv/columns'
import { HEX_COLOR_RE } from '../group-colors'
import { guestSides, PARTNER_NAME_MAX } from '../partners'
import { fixedItemsSchema, importedByValues, referenceMetaSchema } from '../venue-schema'
import { upgradeRestoreStartV1, upgradeV1 } from './upgrade'

export const BACKUP_FORMAT = 'seat-plan-backup'
export const BACKUP_VERSION = 2

/**
 * The most rows of each kind a backup may hold. They bound what reading a
 * file can cost, and they must never refuse a wedding the app accepts, or
 * that wedding could not be backed up (the nightly job checks every backup
 * against this format before it uploads it, and fails the wedding by field
 * when it does not fit). limits.test.ts compares them with the API.
 *
 * The API caps what one request adds (MAX_GUEST_ROWS guests in one import or
 * paste, and as many in one group or rule) but not how many rows a wedding
 * gathers over time, so these sit far above any real wedding.
 */
export const BACKUP_LIMITS = {
  guests: 20_000,
  groups: 5000,
  groupMembers: 200_000,
  rules: 10_000,
  ruleGuests: 200_000,
  layouts: 1000,
  templates: 1000,
  members: 1000,
} as const

/** The longest names: weddings, guests, layouts and venues (src/shared/api.ts). */
const NAME_MAX = 200
/** Rule notes, as the API takes them (optionalNotes in src/shared/api.ts). */
const RULE_NOTE_MAX = 10_000
/**
 * Guest notes. The API takes 10,000 characters, but a CSV import adds each
 * column it does not know to the notes as a line (up to 100 lines of 5,000
 * characters each time, src/domain/csv/import-diff.ts), so notes can grow past
 * that. A sanity bound, far above what an import writes.
 */
const GUEST_NOTES_MAX = 1_000_000
/** The largest floor plan image the database stores (venue_images_size_cap: 4 MiB; the server takes up to 3.5 MB). */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024

const id = z.uuid().overwrite((v) => v.toLowerCase())
const line = (max: number) => z.string().overwrite(cleanOneLine).max(max)
/** A guest's first or last name: cleaned as the API cleans it (one line, NFC). */
const guestName = line(NAME_MAX).min(1, 'Names cannot be empty')
/**
 * A wedding's, layout's or venue's name: cleaned as the API cleans it (made
 * well formed and trimmed, nothing more). Cleaning it as a guest name is (to
 * NFC) could lengthen a name the API took past its limit.
 */
const title = z.string().overwrite(wellFormedText).trim().min(1, 'Names cannot be empty').max(NAME_MAX)
/** One line of text or null; blank becomes null. */
const optionalLine = (max: number) =>
  line(max)
    .nullable()
    .transform((v) => (v ? v : null))
const optionalNotes = z
  .string()
  .overwrite(cleanNotes)
  .max(GUEST_NOTES_MAX)
  .nullable()
  .transform((v) => (v ? v : null))

const backupWeddingV1Schema = z.object({
  id,
  name: title,
  date: z.iso.date().nullable(),
  unit: z.enum(['ft', 'm']),
  minGapCm: z.number().finite().positive().max(10_000),
})

export const backupWeddingSchema = backupWeddingV1Schema.extend({
  partner1Name: optionalLine(PARTNER_NAME_MAX),
  partner2Name: optionalLine(PARTNER_NAME_MAX),
})

const backupGuestV1Schema = z.object({
  id,
  firstName: guestName,
  lastName: guestName,
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

export const backupGuestSchema = backupGuestV1Schema.extend({ side: z.enum(guestSides) })

/** Who could open the wedding when it was backed up. For reading only: a restore never makes anyone on this list a member. */
export const backupMemberSchema = z.object({
  userId: z.uuid(),
  email: line(254),
  displayName: line(200),
  role: z.enum(['owner', 'editor']),
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
      .max(RULE_NOTE_MAX)
      .nullable()
      .transform((v) => (v ? v : null)),
  })
  .refine((r) => r.kind === 'together' || !r.nextToEachOther, 'Only together rules can keep guests next to each other')

export const backupLayoutSchema = z.object({
  id,
  name: title,
  kind: z.enum(['reception', 'ceremony']),
  venueTemplateId: id.nullable(),
  // A display name, any string (a backup can name someone besides Noa and Aiden).
  editedBy: cleanText(200).nullable(),
  canvas: canvasSchema,
})

export const backupTemplateSchema = z.object({
  id,
  name: title,
  fixedItems: fixedItemsSchema,
  reference: referenceMetaSchema.nullable(),
  importedBy: z.enum(importedByValues),
  /** The template's floor plan image, in the file's images list, or null without one. */
  imageId: id.nullable(),
})

/** Base64 of an image of at most MAX_IMAGE_BYTES. */
const MAX_IMAGE_BASE64 = Math.ceil(MAX_IMAGE_BYTES / 3) * 4

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

const format = z.literal(BACKUP_FORMAT)

/** Groups, rules and their links: the same in both versions. */
const linkRows = {
  groups: z.array(backupGroupSchema).max(BACKUP_LIMITS.groups),
  groupMembers: z.array(z.object({ groupId: id, guestId: id })).max(BACKUP_LIMITS.groupMembers),
  rules: z.array(backupRuleSchema).max(BACKUP_LIMITS.rules),
  ruleGuests: z.array(z.object({ ruleId: id, guestId: id })).max(BACKUP_LIMITS.ruleGuests),
}

const weddingRowsV1 = {
  wedding: backupWeddingV1Schema,
  guests: z.array(backupGuestV1Schema).max(BACKUP_LIMITS.guests),
  ...linkRows,
}

const weddingRows = {
  wedding: backupWeddingSchema,
  guests: z.array(backupGuestSchema).max(BACKUP_LIMITS.guests),
  ...linkRows,
}

/** What a file holds besides the wedding's rows and members. */
const fileRows = {
  exportedAt: z.iso.datetime({ offset: true }),
  layouts: z.array(backupLayoutSchema).max(BACKUP_LIMITS.layouts),
  templates: z.array(backupTemplateSchema).max(BACKUP_LIMITS.templates),
  images: z.array(backupImageSchema).max(BACKUP_LIMITS.templates),
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

/** Every layout and every template id appears once. */
function checkFileRows(file: { layouts: { id: string }[]; templates: { id: string }[] }, ctx: z.RefinementCtx) {
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
}

const restoreStartV1Schema = z
  .object({ format, version: z.literal(1), jobId: id.optional(), ...weddingRowsV1 })
  .superRefine(checkWeddingRows)

const restoreStartV2Schema = z
  .object({ format, version: z.literal(BACKUP_VERSION), jobId: id.optional(), ...weddingRows })
  .superRefine(checkWeddingRows)

/**
 * The first restore step, POST /api/weddings/restore: the wedding and its
 * rows. `jobId` is chosen by the browser, so a retried first step finds the
 * wedding the first try made instead of making a second one. A browser still
 * running the page from before version 2 sends version 1, which is upgraded.
 */
export const restoreStartSchema = z.discriminatedUnion('version', [
  restoreStartV1Schema.transform(upgradeRestoreStartV1),
  restoreStartV2Schema,
])

/** A version 1 file: sides 'Noa' / 'Aiden' / 'Both', no partner names, no members. */
export const backupFileV1Schema = z
  .object({ format, version: z.literal(1), ...weddingRowsV1, ...fileRows })
  .superRefine(checkWeddingRows)
  .superRefine(checkFileRows)

/** A version 2 file. Members may be missing (an empty list). */
export const backupFileV2Schema = z
  .object({
    format,
    version: z.literal(BACKUP_VERSION),
    ...weddingRows,
    members: z.array(backupMemberSchema).max(BACKUP_LIMITS.members).default([]),
    ...fileRows,
  })
  .superRefine(checkWeddingRows)
  .superRefine(checkFileRows)

/** A whole backup file of either version, read as version 2. */
export const backupFileSchema = z.discriminatedUnion('version', [backupFileV1Schema.transform(upgradeV1), backupFileV2Schema])

/** An image as a stored backup lists it: everything but its bytes, which the backup store keeps once, by sha256. */
export const storedBackupImageSchema = backupImageSchema.omit({ data: true })

/**
 * A backup as the backup store keeps it (src/server/backups): a version 2
 * file whose images hold no data. Each image's bytes are stored once, by
 * sha256, and backups/assemble.ts puts them back in, which makes a normal
 * version 2 file again. The keys are in the order a downloaded file writes
 * them (Zod writes its output in this order).
 */
export const storedBackupHeadSchema = z
  .object({
    format,
    version: z.literal(BACKUP_VERSION),
    exportedAt: fileRows.exportedAt,
    wedding: weddingRows.wedding,
    guests: weddingRows.guests,
    members: z.array(backupMemberSchema).max(BACKUP_LIMITS.members),
    groups: weddingRows.groups,
    groupMembers: weddingRows.groupMembers,
    rules: weddingRows.rules,
    ruleGuests: weddingRows.ruleGuests,
    layouts: fileRows.layouts,
    templates: fileRows.templates,
    images: z.array(storedBackupImageSchema).max(BACKUP_LIMITS.templates),
  })
  .superRefine(checkWeddingRows)
  .superRefine(checkFileRows)

export type BackupWedding = z.output<typeof backupWeddingSchema>
export type BackupGuest = z.output<typeof backupGuestSchema>
export type BackupMember = z.output<typeof backupMemberSchema>
export type BackupGroup = z.output<typeof backupGroupSchema>
export type BackupRule = z.output<typeof backupRuleSchema>
export type BackupLayout = z.output<typeof backupLayoutSchema>
export type BackupTemplate = z.output<typeof backupTemplateSchema>
export type BackupImage = z.output<typeof backupImageSchema>
/** A file as version 2, whichever version it was written in (backupFileSchema's output). */
export type BackupFile = z.output<typeof backupFileV2Schema>
export type BackupFileV1 = z.output<typeof backupFileV1Schema>
export type StoredBackupHead = z.output<typeof storedBackupHeadSchema>
export type StoredBackupImage = z.output<typeof storedBackupImageSchema>
/** The first restore step as version 2 (restoreStartSchema's output). */
export type RestoreStart = z.output<typeof restoreStartV2Schema>
export type RestoreStartV1 = z.output<typeof restoreStartV1Schema>
/** What the browser sends for the first step (before Zod fills in or cleans anything). */
export type RestoreStartInput = z.input<typeof restoreStartSchema>
export type BackupLayoutInput = z.input<typeof backupLayoutSchema>
export type BackupTemplateInput = z.input<typeof backupTemplateSchema>
