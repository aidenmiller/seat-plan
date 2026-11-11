import 'server-only'
import { createHash } from 'node:crypto'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  type BackupFile,
  type BackupLayout,
  type BackupTemplate,
  type RestoreStart,
} from '@/domain/backup/schema'
import { partnerPairs, remapCanvas, remapWeddingRows, restoredName, sameWalls } from '@/domain/backup/remap'
import { nameKey } from '@/domain/names'
import { fixedItemsSchema, type FixedItem } from '@/domain/venue-schema'
import type { RestoredLayout, RestoredTemplate, RestoreStarted } from '@/shared/api'
import { writeCanvas } from './canvas-write'
import { editorName } from './editor-name'
import {
  groupMembers,
  groups,
  guests,
  layouts,
  ruleGuests,
  rules,
  venueImages,
  venueTemplateRevisions,
  venueTemplates,
  weddings,
} from './db/schema'
import type { Db, Tx } from './locks'
import { chunks } from './repo/guests'
import { addTemplateImage, type AddImageResult } from './repo/venues'

/**
 * Backup and restore (spec section 11, PLAN section 7).
 *
 * Backup streams one JSON file: the wedding, its live guests, groups, members,
 * rules and rule guests, its live layouts with their canvases, and the venue
 * templates those layouts use, each with its current floor plan image as
 * base64 (images come last, one at a time, so a large file never sits in
 * memory whole). Share links are left out.
 *
 * Restore makes a new wedding in steps, each its own request under Vercel's
 * 4.5 MB limit: the wedding's rows, then each template and its image, then
 * each layout. The browser picks a job id, and every new id is worked out
 * from the job id and the old id (restoredId). That is the one old-to-new id
 * map: each step rewrites the ids it holds through it without the server
 * keeping any state between steps, and a step sent again after a lost reply
 * finds the rows the first try made.
 */

// ---------------------------------------------------------------- ids

/**
 * The new id for `oldId` in restore job `jobId`: a uuid (version 8, RFC 9562)
 * made from a hash of the two. The new wedding's id is restoredId(jobId, 'wedding').
 */
export function restoredId(jobId: string, oldId: string): string {
  const hex = createHash('sha256').update(`seat-plan restore\n${jobId.toLowerCase()}\n${oldId.toLowerCase()}`).digest('hex')
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

export function restoredWeddingId(jobId: string): string {
  return restoredId(jobId, 'wedding')
}

// ---------------------------------------------------------------- backup

type BackupHead = Omit<BackupFile, 'images'>
type ImageRef = { id: string; templateId: string }

/** The file's name: "<wedding> backup YYYY-MM-DD.json". */
export function backupFileName(weddingName: string, now = new Date()): string {
  const safe = weddingName.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Wedding'
  return `${safe} backup ${now.toISOString().slice(0, 10)}.json`
}

/** Everything but the image bytes. Null when the wedding is missing or deleted. */
async function backupHead(db: Db, weddingId: string): Promise<{ head: BackupHead; images: ImageRef[] } | null> {
  const [wedding] = await db
    .select({ id: weddings.id, name: weddings.name, date: weddings.date, unit: weddings.unit, minGapCm: weddings.minGapCm })
    .from(weddings)
    .where(and(eq(weddings.id, weddingId), isNull(weddings.deletedAt)))
  if (!wedding) return null

  const liveGuest = and(eq(guests.weddingId, weddingId), isNull(guests.deletedAt))
  const [guestRows, groupRows, memberRows, ruleRows, ruleGuestRows, layoutRows] = await Promise.all([
    db
      .select({
        id: guests.id,
        firstName: guests.firstName,
        lastName: guests.lastName,
        nickname: guests.nickname,
        partnerId: guests.partnerId,
        coupleRuleEnabled: guests.coupleRuleEnabled,
        household: guests.household,
        side: guests.side,
        rsvp: guests.rsvp,
        meal: guests.meal,
        isChild: guests.isChild,
        notes: guests.notes,
      })
      .from(guests)
      .where(liveGuest)
      .orderBy(asc(guests.createdAt), asc(guests.id)),
    db
      .select({ id: groups.id, name: groups.name, color: groups.color })
      .from(groups)
      .where(eq(groups.weddingId, weddingId))
      .orderBy(asc(groups.createdAt), asc(groups.id)),
    db
      .select({ groupId: groupMembers.groupId, guestId: groupMembers.guestId })
      .from(groupMembers)
      .innerJoin(guests, eq(guests.id, groupMembers.guestId))
      .where(and(eq(groupMembers.weddingId, weddingId), liveGuest))
      .orderBy(asc(groupMembers.groupId), asc(groupMembers.createdAt), asc(groupMembers.guestId)),
    db
      .select({
        id: rules.id,
        kind: rules.kind,
        nextToEachOther: rules.nextToEachOther,
        appliesTo: rules.appliesTo,
        enabled: rules.enabled,
        note: rules.note,
      })
      .from(rules)
      .where(eq(rules.weddingId, weddingId))
      .orderBy(asc(rules.createdAt), asc(rules.id)),
    db
      .select({ ruleId: ruleGuests.ruleId, guestId: ruleGuests.guestId })
      .from(ruleGuests)
      .innerJoin(guests, eq(guests.id, ruleGuests.guestId))
      .where(and(eq(ruleGuests.weddingId, weddingId), liveGuest))
      .orderBy(asc(ruleGuests.ruleId), asc(ruleGuests.guestId)),
    db
      .select({
        id: layouts.id,
        name: layouts.name,
        kind: layouts.kind,
        venueTemplateId: layouts.venueTemplateId,
        editedBy: editorName(layouts),
        canvas: layouts.canvas,
      })
      .from(layouts)
      .where(and(eq(layouts.weddingId, weddingId), isNull(layouts.deletedAt)))
      .orderBy(asc(layouts.createdAt), asc(layouts.id)),
  ])

  // The templates the layouts use, deleted or not: a restore can bring a deleted one back as a copy.
  const templateIds = [...new Set(layoutRows.flatMap((l) => (l.venueTemplateId ? [l.venueTemplateId] : [])))]
  const templateRows =
    templateIds.length === 0
      ? []
      : await db
          .select({
            id: venueTemplates.id,
            name: venueTemplates.name,
            fixedItems: venueTemplates.fixedItems,
            reference: venueTemplates.reference,
            importedBy: venueTemplates.importedBy,
            imageId: venueTemplates.referenceImageId,
          })
          .from(venueTemplates)
          .where(inArray(venueTemplates.id, templateIds))
          .orderBy(asc(venueTemplates.createdAt), asc(venueTemplates.id))

  const templates: BackupTemplate[] = templateRows.map((t) => {
    const items = fixedItemsSchema.safeParse(t.fixedItems)
    return { ...t, fixedItems: items.success ? items.data : [], reference: t.reference ?? null }
  })
  const layoutList: BackupLayout[] = layoutRows
  const head: BackupHead = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    wedding,
    guests: guestRows,
    groups: groupRows,
    groupMembers: memberRows,
    rules: ruleRows,
    ruleGuests: ruleGuestRows,
    layouts: layoutList,
    templates,
  }
  const images = templates.flatMap((t) => (t.imageId ? [{ id: t.imageId, templateId: t.id }] : []))
  return { head, images }
}

/**
 * The backup file as a stream of UTF-8 JSON, with its file name. Null when the
 * wedding is missing or deleted. Images are read one at a time as the stream
 * is pulled.
 */
export async function backupStream(db: Db, weddingId: string): Promise<{ fileName: string; stream: ReadableStream<Uint8Array> } | null> {
  const found = await backupHead(db, weddingId)
  if (!found) return null
  const { head, images } = found
  const encoder = new TextEncoder()
  const opening = JSON.stringify(head)
  let next = 0
  let written = 0
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // The head is one JSON object; the images list goes in before its closing brace.
      controller.enqueue(encoder.encode(`${opening.slice(0, -1)},"images":[`))
    },
    async pull(controller) {
      while (next < images.length) {
        const ref = images[next++]!
        const [row] = await db
          .select({
            id: venueImages.id,
            templateId: venueImages.templateId,
            contentType: venueImages.contentType,
            width: venueImages.width,
            height: venueImages.height,
            sha256: venueImages.sha256,
            bytes: venueImages.bytes,
          })
          .from(venueImages)
          .where(and(eq(venueImages.id, ref.id), eq(venueImages.templateId, ref.templateId)))
        if (!row) continue
        const { bytes, ...meta } = row
        const entry = JSON.stringify({ ...meta, data: Buffer.from(bytes).toString('base64') })
        controller.enqueue(encoder.encode(`${written++ > 0 ? ',' : ''}${entry}`))
        return
      }
      controller.enqueue(encoder.encode(']}'))
      controller.close()
    },
  })
  return { fileName: backupFileName(head.wedding.name), stream }
}

// ---------------------------------------------------------------- restore: the wedding's rows

export type StartRestoreResult = ({ status: 'created' } & RestoreStarted & { existed: boolean }) | { status: 'id-taken' }

/**
 * Step 1: a new wedding named "<name> (restored)" with the backup's guests,
 * groups, members, rules and rule guests under new ids, all in one
 * transaction. Sent again with the same job id, it gives back the wedding the
 * first try made.
 */
export async function startRestore(db: Db, body: RestoreStart, jobId: string): Promise<StartRestoreResult> {
  const weddingId = restoredWeddingId(jobId)
  const weddingName = restoredName(body.wedding.name)
  const rows = remapWeddingRows(body, (old) => restoredId(jobId, old))

  return db.transaction(async (tx): Promise<StartRestoreResult> => {
    const inserted = await tx
      .insert(weddings)
      .values({ id: weddingId, name: weddingName, date: body.wedding.date, unit: body.wedding.unit, minGapCm: body.wedding.minGapCm })
      .onConflictDoNothing({ target: weddings.id })
      .returning({ id: weddings.id, name: weddings.name })
    if (inserted.length === 0) {
      // The rows went in with the wedding, in one transaction, so a live wedding has them all.
      const [existing] = await tx
        .select({ name: weddings.name, deletedAt: weddings.deletedAt })
        .from(weddings)
        .where(eq(weddings.id, weddingId))
      if (!existing || existing.deletedAt !== null) return { status: 'id-taken' }
      return { status: 'created', existed: true, jobId, weddingId, weddingName: existing.name }
    }

    // Guests first without partners: a partner may sit in a later chunk.
    for (const part of chunks(rows.guests)) {
      await tx.insert(guests).values(
        part.map((g) => ({
          id: g.id,
          weddingId,
          firstName: g.firstName,
          lastName: g.lastName,
          nameKey: nameKey(g.firstName, g.lastName),
          nickname: g.nickname,
          coupleRuleEnabled: g.coupleRuleEnabled,
          household: g.household,
          side: g.side,
          rsvp: g.rsvp,
          meal: g.meal,
          isChild: g.isChild,
          notes: g.notes,
        })),
      )
    }
    for (const part of chunks(partnerPairs(rows.guests))) {
      const values = sql.join(
        part.flatMap(([a, b]) => [sql`(${a}::uuid, ${b}::uuid)`, sql`(${b}::uuid, ${a}::uuid)`]),
        sql`, `,
      )
      await tx.execute(sql`
        update "guests" as g set "partner_id" = v.partner
        from (values ${values}) as v(id, partner)
        where g."id" = v.id and g."wedding_id" = ${weddingId}::uuid
      `)
    }
    if (rows.groups.length > 0) {
      await tx.insert(groups).values(rows.groups.map((g) => ({ id: g.id, weddingId, name: g.name, color: g.color })))
    }
    for (const part of chunks(rows.groupMembers)) {
      await tx.insert(groupMembers).values(part.map((m) => ({ weddingId, groupId: m.groupId, guestId: m.guestId })))
    }
    if (rows.rules.length > 0) {
      await tx.insert(rules).values(
        rows.rules.map((r) => ({
          id: r.id,
          weddingId,
          kind: r.kind,
          nextToEachOther: r.nextToEachOther,
          appliesTo: r.appliesTo,
          enabled: r.enabled,
          note: r.note,
        })),
      )
    }
    for (const part of chunks(rows.ruleGuests)) {
      await tx.insert(ruleGuests).values(part.map((r) => ({ weddingId, ruleId: r.ruleId, guestId: r.guestId })))
    }
    return { status: 'created', existed: false, jobId, weddingId, weddingName }
  })
}

async function liveRestoredWedding(db: Db | Tx, jobId: string): Promise<string | null> {
  const weddingId = restoredWeddingId(jobId)
  const [row] = await db
    .select({ id: weddings.id })
    .from(weddings)
    .where(and(eq(weddings.id, weddingId), isNull(weddings.deletedAt)))
  return row?.id ?? null
}

// ---------------------------------------------------------------- restore: templates and images

export type RestoreTemplateResult = ({ status: 'ok' } & RestoredTemplate) | { status: 'not-found' }

function storedItems(value: unknown): FixedItem[] {
  const parsed = fixedItemsSchema.safeParse(value)
  return parsed.success ? parsed.data : []
}

/**
 * Step 2, once per template (PLAN change 5): the template still here with the
 * same walls is used as it is; otherwise a copy named "<name> (restored)" is
 * made from the backup. The copy needs its floor plan image next (step 3).
 */
export async function restoreTemplate(db: Db, jobId: string, body: BackupTemplate): Promise<RestoreTemplateResult> {
  if (!(await liveRestoredWedding(db, jobId))) return { status: 'not-found' }
  const copyId = restoredId(jobId, body.id)

  return db.transaction(async (tx): Promise<RestoreTemplateResult> => {
    // Made by an earlier try of this step.
    const [copy] = await tx
      .select({ referenceImageId: venueTemplates.referenceImageId })
      .from(venueTemplates)
      .where(and(eq(venueTemplates.id, copyId), isNull(venueTemplates.deletedAt)))
    if (copy) return { status: 'ok', templateId: copyId, reused: false, needsImage: body.imageId !== null && copy.referenceImageId === null }

    const [old] = await tx
      .select({ fixedItems: venueTemplates.fixedItems })
      .from(venueTemplates)
      .where(and(eq(venueTemplates.id, body.id), isNull(venueTemplates.deletedAt)))
    if (old && sameWalls(storedItems(old.fixedItems), body.fixedItems)) {
      return { status: 'ok', templateId: body.id, reused: true, needsImage: false }
    }

    const inserted = await tx
      .insert(venueTemplates)
      .values({
        id: copyId,
        name: restoredName(body.name),
        fixedItems: body.fixedItems,
        reference: body.reference,
        importedBy: body.importedBy,
        editedBy: null,
      })
      .onConflictDoNothing({ target: venueTemplates.id })
      .returning({ id: venueTemplates.id })
    if (inserted.length === 0) return { status: 'not-found' }
    // Its first revision, as for any new template; step 3 fills in the image.
    await tx.insert(venueTemplateRevisions).values({
      templateId: copyId,
      fixedItems: body.fixedItems,
      referenceImageId: null,
      reference: body.reference,
      reason: 'save',
      createdAt: sql`clock_timestamp()`,
    })
    return { status: 'ok', templateId: copyId, reused: false, needsImage: body.imageId !== null }
  })
}

/**
 * Step 3: the floor plan image of a template step 2 made, as raw bytes. It
 * becomes the template's reference image. 'not-found' when this job made no
 * copy of that template (a reused template keeps its own image).
 */
export async function restoreTemplateImage(db: Db, jobId: string, oldTemplateId: string, bytes: Uint8Array): Promise<AddImageResult> {
  const templateId = restoredId(jobId, oldTemplateId)
  const result = await addTemplateImage(db, templateId, bytes)
  if (result.status !== 'created' && result.status !== 'existed') return result
  const imageId = result.image.id
  await db.transaction(async (tx) => {
    await tx
      .update(venueTemplates)
      .set({ referenceImageId: imageId, updatedAt: sql`${venueTemplates.updatedAt}` })
      .where(and(eq(venueTemplates.id, templateId), isNull(venueTemplates.referenceImageId)))
    await tx
      .update(venueTemplateRevisions)
      .set({ referenceImageId: imageId })
      .where(and(eq(venueTemplateRevisions.templateId, templateId), isNull(venueTemplateRevisions.referenceImageId)))
  })
  return result
}

// ---------------------------------------------------------------- restore: layouts

export type RestoreLayoutResult =
  | ({ status: 'created'; existed: boolean } & RestoredLayout)
  | { status: 'not-found' }
  | { status: 'id-taken' }
  | { status: 'invalid'; issues: string[] }

/**
 * Step 4, once per layout: the layout under its new id, every seated guest id
 * rewritten through the job's id map, written through writeCanvas() like any
 * other canvas. It uses the template step 2 settled on: this job's copy, or
 * the old template when it was reused, or a blank canvas when neither exists.
 */
export async function restoreLayout(db: Db, jobId: string, body: BackupLayout): Promise<RestoreLayoutResult> {
  const weddingId = restoredWeddingId(jobId)
  const layoutId = restoredId(jobId, body.id)
  const canvas = remapCanvas(body.canvas, (old) => restoredId(jobId, old))

  const result = await db.transaction(async (tx) => {
    let venueTemplateId: string | null = null
    if (body.venueTemplateId) {
      // A share lock, as for any layout write: a template delete waits for this layout and then sees it.
      for (const candidate of [restoredId(jobId, body.venueTemplateId), body.venueTemplateId]) {
        const [row] = await tx
          .select({ id: venueTemplates.id })
          .from(venueTemplates)
          .where(and(eq(venueTemplates.id, candidate), isNull(venueTemplates.deletedAt)))
          .for('share')
        if (row) {
          venueTemplateId = row.id
          break
        }
      }
    }
    return writeCanvas(tx, {
      mode: 'insert',
      weddingId,
      layoutId,
      canvas,
      name: body.name,
      kind: body.kind,
      venueTemplateId,
      editedBy: body.editedBy,
    })
  })

  switch (result.status) {
    case 'created':
      return { status: 'created', existed: result.existed, layoutId, droppedSeats: result.dropped.length }
    case 'invalid':
      return { status: 'invalid', issues: result.issues }
    case 'id-taken':
      return { status: 'id-taken' }
    default:
      return { status: 'not-found' }
  }
}
