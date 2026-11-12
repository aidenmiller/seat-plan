import 'server-only'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { BACKUP_FORMAT, BACKUP_VERSION, type BackupTemplate, type StoredBackupHead, type StoredBackupImage } from '@/domain/backup/schema'
import { legacySide } from '@/domain/partners'
import { fixedItemsSchema } from '@/domain/venue-schema'
import {
  groupMembers,
  groups,
  guests,
  layouts,
  ruleGuests,
  rules,
  users,
  venueImages,
  venueTemplates,
  weddingMembers,
  weddings,
} from '../db/schema'
import { editorName } from '../editor-name'
import type { Db } from '../locks'
import { canonicalJson, sha256Hex } from './hash'

/**
 * One wedding's backup, as the backup file holds it, without image bytes
 * (spec section 11, PLAN section 7, DECISIONS 100): the wedding, its live
 * guests, groups, members (for reading only), rules and rule guests, its live
 * layouts with their canvases, the venue templates those layouts use (deleted
 * or not), and each template's current floor plan image as a reference
 * (id, size, sha256). backups/assemble.ts turns this into the downloadable
 * file by reading each image's bytes.
 *
 * Every read runs in one REPEATABLE READ, READ ONLY transaction, so the
 * backup is one moment of the wedding: a save that lands while it is read
 * is either wholly in it or wholly out of it.
 *
 * A deleted wedding (deleted_at set) is found only with `includeDeleted`, for
 * its final backup. Deleting a wedding marks only the wedding row (DECISIONS
 * 32) and nothing can change a deleted wedding's rows afterwards (every route
 * answers 404), so "as it was when deleted" is simply this same backup: the
 * wedding row ignoring its deleted_at, with the guests and layouts that were
 * live then and still are.
 *
 * contentSha256 is what the nightly job compares to decide "unchanged since
 * the last backup": the sha256 of the head as canonical JSON (keys sorted,
 * rows in the order the queries give, which are all fixed by created_at and
 * id) without exportedAt, the one part that changes when nothing else does.
 * The images list, with each image's sha256, is part of the head, so a new
 * floor plan image changes it too. Not in it: share links, updated_at
 * timestamps, layout versions and save ids, thumbnails, template revisions:
 * nothing a restore reads.
 */

export type BuiltBackup = {
  head: StoredBackupHead
  images: StoredBackupImage[]
  contentSha256: string
  guestCount: number
  layoutCount: number
  weddingName: string
  /** Null for a live wedding. */
  deletedAt: Date | null
}

/** The hash of a head: canonical JSON without exportedAt. */
export function contentSha256Of(head: StoredBackupHead): string {
  return sha256Hex(canonicalJson({ ...head, exportedAt: undefined }))
}

/** The backup of one wedding, or null when it does not exist (or is deleted, without `includeDeleted`). */
export async function buildBackup(db: Db, weddingId: string, opts: { includeDeleted?: boolean } = {}): Promise<BuiltBackup | null> {
  return db.transaction(
    async (tx) => {
      const [found] = await tx
        .select({
          id: weddings.id,
          name: weddings.name,
          date: weddings.date,
          unit: weddings.unit,
          minGapCm: weddings.minGapCm,
          partner1Name: weddings.partner1Name,
          partner2Name: weddings.partner2Name,
          deletedAt: weddings.deletedAt,
        })
        .from(weddings)
        .where(opts.includeDeleted ? eq(weddings.id, weddingId) : and(eq(weddings.id, weddingId), isNull(weddings.deletedAt)))
      if (!found) return null
      const { deletedAt, ...wedding } = found

      const liveGuest = and(eq(guests.weddingId, weddingId), isNull(guests.deletedAt))
      const guestRows = await tx
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
        .orderBy(asc(guests.createdAt), asc(guests.id))
      const groupRows = await tx
        .select({ id: groups.id, name: groups.name, color: groups.color })
        .from(groups)
        .where(eq(groups.weddingId, weddingId))
        .orderBy(asc(groups.createdAt), asc(groups.id))
      const memberRows = await tx
        .select({ groupId: groupMembers.groupId, guestId: groupMembers.guestId })
        .from(groupMembers)
        .innerJoin(guests, eq(guests.id, groupMembers.guestId))
        .where(and(eq(groupMembers.weddingId, weddingId), liveGuest))
        .orderBy(asc(groupMembers.groupId), asc(groupMembers.createdAt), asc(groupMembers.guestId))
      const ruleRows = await tx
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
        .orderBy(asc(rules.createdAt), asc(rules.id))
      const ruleGuestRows = await tx
        .select({ ruleId: ruleGuests.ruleId, guestId: ruleGuests.guestId })
        .from(ruleGuests)
        .innerJoin(guests, eq(guests.id, ruleGuests.guestId))
        .where(and(eq(ruleGuests.weddingId, weddingId), liveGuest))
        .orderBy(asc(ruleGuests.ruleId), asc(ruleGuests.guestId))
      const layoutRows = await tx
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
        .orderBy(asc(layouts.createdAt), asc(layouts.id))
      // Who can open the wedding, for reading only (a restore never adds members). None for a wedding from before accounts.
      const weddingMemberRows = await tx
        .select({ userId: weddingMembers.userId, email: users.email, displayName: users.displayName, role: weddingMembers.role })
        .from(weddingMembers)
        .innerJoin(users, eq(users.id, weddingMembers.userId))
        .where(eq(weddingMembers.weddingId, weddingId))
        .orderBy(asc(weddingMembers.createdAt), asc(weddingMembers.userId))

      // The templates the layouts use, deleted or not: a restore can bring a deleted one back as a copy.
      const templateIds = [...new Set(layoutRows.flatMap((l) => (l.venueTemplateId ? [l.venueTemplateId] : [])))]
      const templateRows =
        templateIds.length === 0
          ? []
          : await tx
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

      // Each template's floor plan image, without its bytes. One whose row is gone is left out, as the download always did.
      const images: StoredBackupImage[] = []
      for (const template of templates) {
        if (!template.imageId) continue
        const [image] = await tx
          .select({
            id: venueImages.id,
            templateId: venueImages.templateId,
            contentType: venueImages.contentType,
            width: venueImages.width,
            height: venueImages.height,
            sha256: venueImages.sha256,
          })
          .from(venueImages)
          .where(and(eq(venueImages.id, template.imageId), eq(venueImages.templateId, template.id)))
        if (image) images.push(image)
      }

      const head: StoredBackupHead = {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        wedding,
        // Old words an older deployment wrote during a build go out as codes (migration 0007).
        guests: guestRows.map((g) => ({ ...g, side: legacySide(g.side) ?? 'both' })),
        members: weddingMemberRows,
        groups: groupRows,
        groupMembers: memberRows,
        rules: ruleRows,
        ruleGuests: ruleGuestRows,
        layouts: layoutRows,
        templates,
        images,
      }
      return {
        head,
        images,
        contentSha256: contentSha256Of(head),
        guestCount: head.guests.length,
        layoutCount: head.layouts.length,
        weddingName: wedding.name,
        deletedAt,
      }
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
}
