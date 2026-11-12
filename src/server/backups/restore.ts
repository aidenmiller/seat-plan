import 'server-only'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { BACKUP_FORMAT, BACKUP_VERSION } from '@/domain/backup/schema'
import type { Viewer } from '../auth/venue-access'
import { restoreLayout, restoreTemplate, restoreTemplateImage, startRestore } from '../backup'
import { backups, weddingMembers, weddings } from '../db/schema'
import type { Db } from '../locks'
import { recordEvent } from '../repo/activity'
import { BackupIntegrityError } from './assemble'
import { markUnreadable, openStoredBackup, readVerifiedImage, unreadableMessage } from './read'
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
 * the store and matches its sha256. Any failure there answers 'corrupt' with
 * a short message that says the backup is unreadable and to use Back up now,
 * and makes nothing. A backup whose file fails is marked unreadable, so the
 * next run makes a fresh one; an image that fails is forgotten, so the next
 * backup that needs it uploads it again (read.ts).
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
 * the file. The venues are then restored for those owners, not the admin: a
 * venue of theirs with the same walls is used as it is, and a copy is owned
 * by the first of them, so they can change it and the admin's own venue list
 * stays as it was. With no owners brought back, the venues are the actor's.
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
  if (!opened.ok) {
    await markUnreadable(db, backup.id)
    return { status: 'corrupt', message: unreadableMessage(opened.problem) }
  }
  const head = opened.head
  for (const image of head.images) {
    try {
      await readVerifiedImage(store, image, db)
    } catch (err) {
      if (err instanceof BackupIntegrityError) return { status: 'corrupt', message: unreadableMessage(err.message) }
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
  const sourceOwners = await sourceOwnersToAdd(db, backup.weddingId, actor)
  const ownersAdded = await addSourceOwners(db, started.weddingId, sourceOwners, actor)
  // Whose venues these are: the planners brought back, when there are any.
  const venueOwners = sourceOwners.length > 0 ? sourceOwners : [actor.userId]
  const viewers: Viewer[] = [{ userId: actor.userId, isAdmin: actor.isAdmin }, ...sourceOwners.map((userId) => ({ userId, isAdmin: false }))]

  const images = new Map(head.images.map((image) => [image.id, image]))
  for (const template of head.templates) {
    const result = await restoreTemplate(db, jobId, template, actor.userId, { owners: venueOwners })
    if (result.status !== 'ok') throw new BackupError(`Restoring the venue ${template.id} failed (${result.status}).`)
    const image = template.imageId ? images.get(template.imageId) : undefined
    if (result.needsImage && image) {
      const added = await restoreTemplateImage(db, jobId, template.id, await readVerifiedImage(store, image, db), venueOwners[0]!)
      if (added.status !== 'created' && added.status !== 'existed') {
        throw new BackupError(`Restoring the floor plan image of venue ${template.id} failed (${added.status}).`)
      }
    }
  }

  let droppedSeats = 0
  for (const layout of head.layouts) {
    const result = await restoreLayout(db, jobId, layout, viewers)
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
 * wedding, restoring it while it still exists, brings back its owners, the
 * longest-standing first. None otherwise. The same on every try of a job, so
 * a retry restores the venues for the same people.
 */
async function sourceOwnersToAdd(db: Db, sourceWeddingId: string, actor: RestoreActor): Promise<string[]> {
  if (!actor.isAdmin) return []
  const owners = await db
    .select({ userId: weddingMembers.userId })
    .from(weddingMembers)
    .innerJoin(weddings, and(eq(weddings.id, weddingMembers.weddingId), isNull(weddings.deletedAt)))
    .where(and(eq(weddingMembers.weddingId, sourceWeddingId), eq(weddingMembers.role, 'owner')))
    .orderBy(asc(weddingMembers.createdAt), asc(weddingMembers.userId))
  if (owners.length === 0 || owners.some((o) => o.userId === actor.userId)) return []
  return owners.map((o) => o.userId)
}

/** Adds those owners to the restored wedding. Answers who was added just now. */
async function addSourceOwners(db: Db, restoredWeddingId: string, owners: readonly string[], actor: RestoreActor): Promise<string[]> {
  if (owners.length === 0) return []
  const added = await db
    .insert(weddingMembers)
    .values(owners.map((userId) => ({ weddingId: restoredWeddingId, userId, role: 'owner' as const, addedByUserId: actor.userId })))
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
