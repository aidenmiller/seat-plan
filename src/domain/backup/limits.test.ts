/**
 * The backup format must hold anything the app lets a planner save: a
 * wedding the app accepts must always back up, and a file the app writes
 * must always restore. This walks every text field and count the API (and
 * the database's checks) limit, finds the largest value the API accepts by
 * trying, and fails when the backup format would refuse that value, so a
 * limit raised on one side and not the other fails here first.
 *
 * Each text field is tried with plain letters and with letters that grow
 * when normalised to NFC (U+0958 becomes two code units, U+FB2C three): a
 * backup field that normalises where the API does not would otherwise turn
 * a 200-character name into 400.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { DISPLAY_NAME_MAX, EMAIL_MAX } from '@/domain/accounts'
import { canvasSchema } from '@/domain/canvas-schema'
import { PARTNER_NAME_MAX } from '@/domain/partners'
import { fixedItemsSchema } from '@/domain/venue-schema'
import {
  createGroupBody,
  createGuestBody,
  createLayoutBody,
  createRuleBody,
  createVenueBody,
  createWeddingBody,
  importRowBody,
  MAX_GUEST_ROWS,
  MAX_VENUE_IMAGE_BYTES,
  MAX_VENUE_IMAGE_SIDE,
  saveLayoutBody,
  saveVenueBody,
  updateWeddingBody,
} from '@/shared/api'
import {
  BACKUP_LIMITS,
  backupGroupSchema,
  backupGuestSchema,
  backupImageSchema,
  backupLayoutSchema,
  backupMemberSchema,
  backupRuleSchema,
  backupTemplateSchema,
  backupWeddingSchema,
} from './schema'

/** The database's own caps (src/server/db/schema.ts checks). */
const DB = {
  /** layouts_edited_by_name_length, venue_templates_edited_by_name_length */
  editedByName: 200,
  /** venue_images_size_cap */
  imageBytes: 4_194_304,
}

const UNBOUNDED = Number.POSITIVE_INFINITY

/**
 * The largest n for which `make(n)` passes (every field here accepts all n up
 * to its limit): doubling until one fails, then bisecting. UNBOUNDED past
 * `ceiling`.
 */
function largestAccepted(schema: z.ZodType, make: (n: number) => unknown, ceiling = 4_000_000): number {
  if (!schema.safeParse(make(1)).success) return 0
  let lo = 1
  let hi = 2
  while (schema.safeParse(make(hi)).success) {
    if (hi >= ceiling) return UNBOUNDED
    lo = hi
    hi = Math.min(hi * 2, ceiling)
  }
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2)
    if (schema.safeParse(make(mid)).success) lo = mid
    else hi = mid
  }
  return lo
}

const makers: [string, (n: number) => string][] = [
  ['plain letters', (n) => 'a'.repeat(n)],
  ['letters NFC doubles', (n) => 'क़'.repeat(n)],
  ['letters NFC triples', (n) => 'שּׁ'.repeat(n)],
]

/** Every text field: what the API accepts for it, and the backup format's field. */
const textFields: { field: string; api: z.ZodType[]; backup: z.ZodType }[] = [
  { field: 'wedding name', api: [createWeddingBody.shape.name], backup: backupWeddingSchema.shape.name },
  { field: 'partner 1 name', api: [createWeddingBody.shape.partner1Name, updateWeddingBody.shape.partner1Name], backup: backupWeddingSchema.shape.partner1Name },
  { field: 'partner 2 name', api: [createWeddingBody.shape.partner2Name, updateWeddingBody.shape.partner2Name], backup: backupWeddingSchema.shape.partner2Name },
  { field: 'guest first name', api: [createGuestBody.shape.firstName, importRowBody.shape.firstName], backup: backupGuestSchema.shape.firstName },
  { field: 'guest last name', api: [createGuestBody.shape.lastName, importRowBody.shape.lastName], backup: backupGuestSchema.shape.lastName },
  { field: 'guest nickname', api: [createGuestBody.shape.nickname, importRowBody.shape.nickname], backup: backupGuestSchema.shape.nickname },
  { field: 'guest household', api: [createGuestBody.shape.household, importRowBody.shape.household], backup: backupGuestSchema.shape.household },
  { field: 'guest meal', api: [createGuestBody.shape.meal, importRowBody.shape.meal], backup: backupGuestSchema.shape.meal },
  { field: 'guest notes', api: [createGuestBody.shape.notes, importRowBody.shape.notes], backup: backupGuestSchema.shape.notes },
  { field: 'group name', api: [createGroupBody.shape.name, importRowBody.shape.groups.element], backup: backupGroupSchema.shape.name },
  { field: 'rule note', api: [createRuleBody.shape.note], backup: backupRuleSchema.shape.note },
  { field: 'layout name', api: [createLayoutBody.shape.name], backup: backupLayoutSchema.shape.name },
  { field: 'venue name', api: [createVenueBody.shape.name], backup: backupTemplateSchema.shape.name },
]

describe('the backup format holds whatever the API accepts', () => {
  for (const { field, api, backup } of textFields) {
    for (const [what, make] of makers) {
      it(`${field} (${what})`, () => {
        for (const schema of api) {
          const apiMax = largestAccepted(schema, make)
          expect(apiMax, `${field}: the API sets no limit, so the backup cannot match it`).not.toBe(UNBOUNDED)
          expect(apiMax, `${field}: the API accepts nothing`).toBeGreaterThan(0)
          expect(backup.safeParse(make(apiMax)).success, `${field}: the API accepts ${apiMax} (${what}), the backup format does not`).toBe(true)
        }
      })
    }
  }

  it('guest notes as a CSV import writes them: the file’s notes and every extra column appended as a line', () => {
    const notesMax = largestAccepted(importRowBody.shape.notes, (n) => 'a'.repeat(n))
    const extraLines = largestAccepted(importRowBody.shape.extraNotes, (n) => Array.from({ length: n }, (_, i) => `x${i}`), 10_000)
    const extraLineMax = largestAccepted(importRowBody.shape.extraNotes.element, (n) => 'a'.repeat(n))
    // One import of a new guest: notes, then each extra line after a line break (import-diff.ts, appendLines).
    const oneImport = notesMax + extraLines * (extraLineMax + 1)
    expect(backupGuestSchema.shape.notes.safeParse('a'.repeat(oneImport)).success, `one import can write ${oneImport} characters of notes`).toBe(true)
  })

  it('member emails and display names, and who last saved a layout', () => {
    expect(largestAccepted(backupMemberSchema.shape.email, (n) => 'a'.repeat(n))).toBeGreaterThanOrEqual(EMAIL_MAX)
    expect(largestAccepted(backupMemberSchema.shape.displayName, (n) => 'a'.repeat(n))).toBeGreaterThanOrEqual(DISPLAY_NAME_MAX)
    expect(largestAccepted(backupLayoutSchema.shape.editedBy, (n) => 'a'.repeat(n))).toBeGreaterThanOrEqual(Math.max(DB.editedByName, DISPLAY_NAME_MAX))
    expect(largestAccepted(backupWeddingSchema.shape.partner1Name, (n) => 'a'.repeat(n))).toBeGreaterThanOrEqual(PARTNER_NAME_MAX)
  })

  it('the minimum gap between tables', () => {
    const apiMax = largestAccepted(updateWeddingBody.shape.minGapCm, (n) => n, 10_000_000)
    expect(backupWeddingSchema.shape.minGapCm.safeParse(apiMax).success).toBe(true)
  })

  it('floor plan images: as large as the server or the database stores, as wide as the server takes', () => {
    const biggest = Math.max(MAX_VENUE_IMAGE_BYTES, DB.imageBytes)
    const base64Length = Math.ceil(biggest / 3) * 4
    expect(largestAccepted(backupImageSchema.shape.data, (n) => 'A'.repeat(n), 20_000_000)).toBeGreaterThanOrEqual(base64Length)
    expect(backupImageSchema.shape.width.safeParse(MAX_VENUE_IMAGE_SIDE).success).toBe(true)
    expect(backupImageSchema.shape.height.safeParse(MAX_VENUE_IMAGE_SIDE).success).toBe(true)
  })

  it('canvases, walls and venue placement are checked with the very schemas the editors save through', () => {
    expect(backupLayoutSchema.shape.canvas).toBe(canvasSchema)
    expect(saveLayoutBody.shape.canvas).toBe(canvasSchema)
    expect(backupTemplateSchema.shape.fixedItems).toBe(fixedItemsSchema)
    expect(saveVenueBody.shape.fixedItems).toBe(fixedItemsSchema)
  })

  it('counts: at least what one request may add, and the API sets no limit per wedding for the rest', () => {
    // One import or paste adds up to MAX_GUEST_ROWS guests; one group or rule can hold all of them.
    expect(BACKUP_LIMITS.guests).toBeGreaterThanOrEqual(MAX_GUEST_ROWS)
    expect(BACKUP_LIMITS.groupMembers).toBeGreaterThanOrEqual(BACKUP_LIMITS.guests)
    expect(BACKUP_LIMITS.ruleGuests).toBeGreaterThanOrEqual(BACKUP_LIMITS.guests)
    // Every layout can use its own venue.
    expect(BACKUP_LIMITS.templates).toBeGreaterThanOrEqual(BACKUP_LIMITS.layouts)
    // No API limit per wedding: these bounds stay far above any real wedding (members were 100, layouts 200, groups 500).
    expect(BACKUP_LIMITS.members).toBeGreaterThanOrEqual(1000)
    expect(BACKUP_LIMITS.layouts).toBeGreaterThanOrEqual(1000)
    expect(BACKUP_LIMITS.groups).toBeGreaterThanOrEqual(5000)
    expect(BACKUP_LIMITS.rules).toBeGreaterThanOrEqual(10_000)
  })
})
