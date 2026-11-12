import 'server-only'
import { createHash } from 'node:crypto'
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { type BackupLayout, type BackupTemplate, type RestoreStart } from '@/domain/backup/schema'
import { partnerPairs, remapCanvas, remapWeddingRows, restoredName, sameWalls } from '@/domain/backup/remap'
import { nameKey } from '@/domain/names'
import { fixedItemsSchema, type FixedItem } from '@/domain/venue-schema'
import type { RestoredLayout, RestoredTemplate, RestoreStarted } from '@/shared/api'
import { canUseTemplateInWedding, type Viewer } from './auth/venue-access'
import { backupFileStream, type ImageReader } from './backups/assemble'
import { buildBackup } from './backups/build'
import { checkHeadJson } from './backups/format'
import { writeCanvas } from './canvas-write'
import {
  groupMembers,
  groups,
  guests,
  ruleGuests,
  rules,
  venueImages,
  venueTemplateRevisions,
  venueTemplates,
  weddingMembers,
  weddings,
} from './db/schema'
import type { Db, Tx } from './locks'
import { recordEvent } from './repo/activity'
import { chunks } from './repo/guests'
import { addTemplateImage, type AddImageResult } from './repo/venues'

/**
 * Backup and restore (spec section 11, PLAN section 7).
 *
 * Backup streams one JSON file: the wedding, its live guests, groups, members,
 * rules and rule guests, its live layouts with their canvases, and the venue
 * templates those layouts use, each with its current floor plan image as
 * base64 (images come last, one at a time, so a large file never sits in
 * memory whole). Share links are left out. The wedding's members are listed
 * for reading only: a restore never trusts them or adds anyone from them.
 *
 * Who may restore: the person who starts a restore becomes the only member
 * (the owner) of the wedding it makes, and every later step is theirs alone
 * (the routes check the job's wedding with byRestoreJob, owner only).
 * Templates follow venue-access.ts: a restore reuses a template only when it
 * is in the library or the restorer's own; anything else comes back as a
 * private copy owned by the restorer, so a file naming someone else's
 * template can never attach it.
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

/** The file's name: "<wedding> backup YYYY-MM-DD.json", dated `when` (today, or a stored backup's day). */
export function backupFileName(weddingName: string, when = new Date()): string {
  const safe = weddingName.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Wedding'
  return `${safe} backup ${when.toISOString().slice(0, 10)}.json`
}

/** An image's bytes from the database, for a download of the wedding as it is now. */
export function databaseImageReader(db: Db): ImageReader {
  return async (ref) => {
    const [row] = await db
      .select({ bytes: venueImages.bytes })
      .from(venueImages)
      .where(and(eq(venueImages.id, ref.id), eq(venueImages.templateId, ref.templateId)))
    return row ? new Uint8Array(row.bytes) : null
  }
}

export type BackupStreamResult = { ok: true; fileName: string; stream: ReadableStream<Uint8Array> } | { ok: false; problem: string }

/**
 * The backup file of the wedding as it is now, as a stream of UTF-8 JSON,
 * with its file name. Null when the wedding is missing or deleted. The rows
 * are read in one transaction (backups/build.ts); images are read one at a
 * time as the stream is pulled (backups/assemble.ts).
 *
 * Checked against the backup format first, with the same check the nightly
 * job makes before it stores a backup (backups/format.ts): a file "Restore
 * from file" would refuse is never handed over as a backup. The problem
 * names the field, never its value.
 */
export async function backupStream(db: Db, weddingId: string): Promise<BackupStreamResult | null> {
  const built = await buildBackup(db, weddingId)
  if (!built) return null
  const fits = checkHeadJson(JSON.stringify(built.head))
  if (!fits.ok) return { ok: false, problem: fits.problem }
  return { ok: true, fileName: backupFileName(built.weddingName), stream: backupFileStream(built.head, databaseImageReader(db)) }
}

// ---------------------------------------------------------------- restore: the wedding's rows

export type StartRestoreResult = ({ status: 'created' } & RestoreStarted & { existed: boolean }) | { status: 'id-taken' }

/**
 * Step 1: a new wedding named "<name> (restored)", with the backup's partner
 * names, and its guests, groups, members, rules and rule guests under new
 * ids, all in one transaction, with `userId` (the person restoring) as its
 * owner and only member; wedding_restored is logged. Sent again with the
 * same job id by someone who already belongs to that wedding, it gives back
 * the wedding the first try made. Anyone else gets 'id-taken' and is never
 * added to a wedding that already existed. The file's list of wedding
 * members is not part of this step: who can open the restored wedding is
 * never read from a file.
 */
export async function startRestore(db: Db, body: RestoreStart, jobId: string, userId: string): Promise<StartRestoreResult> {
  const weddingId = restoredWeddingId(jobId)
  const weddingName = restoredName(body.wedding.name)
  const rows = remapWeddingRows(body, (old) => restoredId(jobId, old))

  return db.transaction(async (tx): Promise<StartRestoreResult> => {
    const inserted = await tx
      .insert(weddings)
      .values({
        id: weddingId,
        name: weddingName,
        date: body.wedding.date,
        unit: body.wedding.unit,
        minGapCm: body.wedding.minGapCm,
        partner1Name: body.wedding.partner1Name,
        partner2Name: body.wedding.partner2Name,
      })
      .onConflictDoNothing({ target: weddings.id })
      .returning({ id: weddings.id, name: weddings.name })
    if (inserted.length === 0) {
      // The rows went in with the wedding, in one transaction, so a live wedding has them all.
      // Only someone already in it gets it back: a retry of their own restore.
      const [existing] = await tx
        .select({ name: weddings.name })
        .from(weddings)
        .innerJoin(weddingMembers, and(eq(weddingMembers.weddingId, weddings.id), eq(weddingMembers.userId, userId)))
        .where(and(eq(weddings.id, weddingId), isNull(weddings.deletedAt)))
      if (!existing) return { status: 'id-taken' }
      return { status: 'created', existed: true, jobId, weddingId, weddingName: existing.name }
    }
    await tx.insert(weddingMembers).values({ weddingId, userId, role: 'owner', addedByUserId: null })
    await recordEvent(tx, { kind: 'wedding_restored', userId, weddingId, detail: { jobId } })

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
 * same walls is used as it is, but only when it is in the library or belongs
 * to `userId` (the person restoring); otherwise a private copy named
 * "<name> (restored)", owned by them, is made from the backup. The copy needs
 * its floor plan image next (step 3). Someone else's template is never read
 * here beyond its owner and library flag, so the reply says nothing about it.
 *
 * `opts.owners` restores the venues for other people instead (an admin's
 * restore of a planner's wedding, backups/restore.ts): a template of any of
 * theirs may be used as it is, and the copy belongs to the first of them, so
 * the planners can change the venues of the wedding they got back.
 */
export async function restoreTemplate(
  db: Db,
  jobId: string,
  body: BackupTemplate,
  userId: string,
  opts: { owners?: readonly string[] } = {},
): Promise<RestoreTemplateResult> {
  if (!(await liveRestoredWedding(db, jobId))) return { status: 'not-found' }
  const copyId = restoredId(jobId, body.id)
  const owners = opts.owners && opts.owners.length > 0 ? [...opts.owners] : [userId]

  return db.transaction(async (tx): Promise<RestoreTemplateResult> => {
    // Made by an earlier try of this step.
    const [copy] = await tx
      .select({ referenceImageId: venueTemplates.referenceImageId })
      .from(venueTemplates)
      .where(and(eq(venueTemplates.id, copyId), inArray(venueTemplates.ownerUserId, owners), isNull(venueTemplates.deletedAt)))
    if (copy) return { status: 'ok', templateId: copyId, reused: false, needsImage: body.imageId !== null && copy.referenceImageId === null }

    // Only the library or the owners' own is a candidate, checked before the walls are compared.
    const [old] = await tx
      .select({ fixedItems: venueTemplates.fixedItems })
      .from(venueTemplates)
      .where(
        and(
          eq(venueTemplates.id, body.id),
          isNull(venueTemplates.deletedAt),
          or(eq(venueTemplates.isLibrary, true), inArray(venueTemplates.ownerUserId, owners)),
        ),
      )
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
        ownerUserId: owners[0]!,
        isLibrary: false,
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
 * copy of that template owned by `userId` (a reused template keeps its own
 * image). `userId` is whoever owns the copy: the person restoring, or the
 * first of step 2's `owners`.
 */
export async function restoreTemplateImage(
  db: Db,
  jobId: string,
  oldTemplateId: string,
  bytes: Uint8Array,
  userId: string,
): Promise<AddImageResult> {
  const templateId = restoredId(jobId, oldTemplateId)
  const [copy] = await db
    .select({ id: venueTemplates.id })
    .from(venueTemplates)
    .where(and(eq(venueTemplates.id, templateId), eq(venueTemplates.ownerUserId, userId), isNull(venueTemplates.deletedAt)))
  if (!copy) return { status: 'not-found' }
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

function isViewerList(viewer: Viewer | readonly Viewer[]): viewer is readonly Viewer[] {
  return Array.isArray(viewer)
}

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
 * Either one must be a template the restorer may use in the restored wedding
 * (canUseTemplateInWedding, as for any layout), so a file that names someone
 * else's private template gets a blank canvas, never that template. Given
 * several viewers (step 2's `owners`, each a member of the restored wedding),
 * a template any one of them may use there.
 */
export async function restoreLayout(db: Db, jobId: string, body: BackupLayout, viewer: Viewer | readonly Viewer[]): Promise<RestoreLayoutResult> {
  const weddingId = restoredWeddingId(jobId)
  const layoutId = restoredId(jobId, body.id)
  const canvas = remapCanvas(body.canvas, (old) => restoredId(jobId, old))
  const viewers: readonly Viewer[] = isViewerList(viewer) ? viewer : [viewer]

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
        if (!row) continue
        let usable = false
        for (const who of viewers) if (!usable && (await canUseTemplateInWedding(tx, who, row.id, weddingId))) usable = true
        if (usable) {
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
      // The name the file gives, with no user: it may name someone without an account here.
      editor: { userId: null, name: body.editedBy },
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
