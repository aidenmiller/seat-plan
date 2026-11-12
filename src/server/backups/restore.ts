import 'server-only'
import { and, eq, isNull } from 'drizzle-orm'
import { BACKUP_FORMAT, BACKUP_VERSION } from '@/domain/backup/schema'
import { restoreLayout, restoreTemplate, restoreTemplateImage, startRestore } from '../backup'
import { backups, weddingMembers, weddings } from '../db/schema'
import type { Db } from '../locks'
import { recordEvent } from '../repo/activity'
import { BackupIntegrityError } from './assemble'
import { openStoredBackup, readVerifiedImage } from './read'
import { BackupError } from './runner'
import type { BackupStore } from './store'

export type RestoreActor = { userId: string; isAdmin: boolean }

export type RestoreStoredResult =
  | {
      status: 'restored'
      weddingId: string
      weddingName: string
      droppedSeats: number
      existed: boolean
      sourceWeddingId: string
      /** The source wedding's owners added as owners (an admin's restore of someone else's wedding). */
      ownersAdded: string[]
    }
  | { status: 'not-found' }
  | { status: 'id-taken' }
  | { status: 'corrupt'; message: string }

/**
 * Restores a stored backup as a new wedding, "<name> (restored)", on the
 * server, through the same steps the browser's "Restore from file" sends
 * (backup.ts: startRestore, then restoreTemplate and restoreTemplateImage for
 * each venue, then restoreLayout for each layout), so the two give the same
 * wedding. Nothing passes through a browser, so the 4.5 MB request limit
 * never applies.
 *
 * Before anything is made, the whole backup is checked: the file is there and
 * matches its sha256, unzips, fits the format, and every image it names is in
 * the store and matches its sha256. Any failure there answers 'corrupt' and
 * makes nothing.
 *
 * `jobId` works as it does for a restore from a file: the same job id again
 * (a retry after a lost reply) finishes the same wedding instead of making a
 * second; someone else's job id answers 'id-taken'.
 *
 * Who owns the restored wedding: the actor, its only member, as for a
 * restore from a file. One addition: when the actor is an admin restoring a
 * wedding they are not an owner of, the source wedding's current owners are
 * made owners too, if that wedding still exists (is not deleted), so the
 * planners get their wedding back without the admin having to invite them.
 * Editors are not added, and nobody is ever added from the members listed in
 * the file.
 */
export async function restoreStoredBackup(
  db: Db,
  store: BackupStore,
  backupId: string,
  opts: { jobId: string; actor: RestoreActor },
): Promise<RestoreStoredResult> {
  const { jobId, actor } = opts
  const [backup] = await db
    .select({ id: backups.id, weddingId: backups.weddingId, pathname: backups.pathname, blobSha256: backups.blobSha256 })
    .from(backups)
    .where(and(eq(backups.id, backupId), eq(backups.storeId, store.id)))
  if (!backup) return { status: 'not-found' }

  const opened = await openStoredBackup(store, backup)
  if (!opened.ok) return { status: 'corrupt', message: opened.message }
  const head = opened.head
  for (const image of head.images) {
    try {
      await readVerifiedImage(store, image)
    } catch (err) {
      if (err instanceof BackupIntegrityError) return { status: 'corrupt', message: err.message }
      throw err
    }
  }

  const started = await startRestore(
    db,
    {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      jobId,
      wedding: head.wedding,
      guests: head.guests,
      groups: head.groups,
      groupMembers: head.groupMembers,
      rules: head.rules,
      ruleGuests: head.ruleGuests,
    },
    jobId,
    actor.userId,
  )
  if (started.status === 'id-taken') return { status: 'id-taken' }
  const ownersAdded = await addSourceOwners(db, started.weddingId, backup.weddingId, actor)

  const images = new Map(head.images.map((image) => [image.id, image]))
  for (const template of head.templates) {
    const result = await restoreTemplate(db, jobId, template, actor.userId)
    if (result.status !== 'ok') throw new BackupError(`Restoring the venue ${template.id} failed (${result.status}).`)
    const image = template.imageId ? images.get(template.imageId) : undefined
    if (result.needsImage && image) {
      const added = await restoreTemplateImage(db, jobId, template.id, await readVerifiedImage(store, image), actor.userId)
      if (added.status !== 'created' && added.status !== 'existed') {
        throw new BackupError(`Restoring the floor plan image of venue ${template.id} failed (${added.status}).`)
      }
    }
  }

  let droppedSeats = 0
  for (const layout of head.layouts) {
    const result = await restoreLayout(db, jobId, layout, { userId: actor.userId, isAdmin: actor.isAdmin })
    if (result.status !== 'created') throw new BackupError(`Restoring the layout ${layout.id} failed (${result.status}).`)
    droppedSeats += result.droppedSeats
  }

  // Logged once per job, whichever try finishes it.
  await recordEvent(db, {
    kind: 'backup_restored',
    userId: actor.userId,
    weddingId: started.weddingId,
    subjectId: backup.id,
    detail: { sourceWeddingId: backup.weddingId, jobId },
    dedupeKey: `backup_restored:${jobId}`,
  })
  return {
    status: 'restored',
    weddingId: started.weddingId,
    weddingName: started.weddingName,
    droppedSeats,
    existed: started.existed,
    sourceWeddingId: backup.weddingId,
    ownersAdded,
  }
}

/**
 * The ownership rule above: an admin who is not an owner of the source
 * wedding, restoring it while it still exists, adds its owners as owners of
 * the restored wedding. Answers who was added just now.
 */
async function addSourceOwners(db: Db, restoredWeddingId: string, sourceWeddingId: string, actor: RestoreActor): Promise<string[]> {
  if (!actor.isAdmin) return []
  const owners = await db
    .select({ userId: weddingMembers.userId })
    .from(weddingMembers)
    .innerJoin(weddings, and(eq(weddings.id, weddingMembers.weddingId), isNull(weddings.deletedAt)))
    .where(and(eq(weddingMembers.weddingId, sourceWeddingId), eq(weddingMembers.role, 'owner')))
  if (owners.length === 0 || owners.some((o) => o.userId === actor.userId)) return []
  const added = await db
    .insert(weddingMembers)
    .values(owners.map((o) => ({ weddingId: restoredWeddingId, userId: o.userId, role: 'owner' as const, addedByUserId: actor.userId })))
    .onConflictDoNothing()
    .returning({ userId: weddingMembers.userId })
  for (const { userId } of added) {
    await recordEvent(db, {
      kind: 'member_added',
      userId: actor.userId,
      weddingId: restoredWeddingId,
      subjectId: userId,
      detail: { role: 'owner', via: 'backup_restore' },
    })
  }
  return added.map((a) => a.userId)
}
