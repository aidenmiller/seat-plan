/**
 * Test-only: a wedding worth backing up, for the backup integration tests.
 * Nothing in the app imports this file.
 *
 * Partners, a group with members, two rules, a removed guest, a venue
 * template owned by the owner with a floor plan image, a reception layout
 * on it with seats and a ceremony layout with a seated chair row.
 */
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { makeGridPng } from '@/domain/floorplan/__fixtures__/plans'
import { groupMembers, groups, guests, ruleGuests, rules, venueTemplates, weddingMembers, weddings } from '../db/schema'
import type { Db } from '../locks'
import { removeGuests } from '../repo/guests'
import { canvasOf, chairRow, makeGuest, makeLayout, makeTemplate, makeWedding, roundTable } from '../repo/test-fixtures'
import { addTemplateImage } from '../repo/venues'

export type BackupWedding = {
  weddingId: string
  templateId: string
  imageId: string
  png: Uint8Array
  guestIds: { ann: string; ben: string; cat: string; dan: string; eve: string }
  groupId: string
  ruleId: string
  dinnerId: string
  ceremonyId: string
}

export async function makeBackupWedding(
  db: Db,
  ownerId: string | null,
  opts: { name?: string; png?: Uint8Array; templateId?: string } = {},
): Promise<BackupWedding> {
  const weddingId = await makeWedding(db, opts.name ?? `Backup wedding ${randomUUID().slice(0, 8)}`)
  if (ownerId) await db.insert(weddingMembers).values({ weddingId, userId: ownerId, role: 'owner' })
  await db.update(weddings).set({ unit: 'm', minGapCm: 120, date: '2027-06-12', partner1Name: 'Noa', partner2Name: 'Aiden' }).where(eq(weddings.id, weddingId))
  const ann = await makeGuest(db, weddingId, 'Ann', 'Lee')
  const ben = await makeGuest(db, weddingId, 'Ben', 'Lee')
  const cat = await makeGuest(db, weddingId, 'Cat', 'Ray')
  const dan = await makeGuest(db, weddingId, 'Dan', 'Ray')
  const eve = await makeGuest(db, weddingId, 'Eve', 'Gone')
  await db.update(guests).set({ partnerId: ben }).where(eq(guests.id, ann))
  await db.update(guests).set({ partnerId: ann }).where(eq(guests.id, ben))
  await db.update(guests).set({ isChild: true, meal: 'Kids pasta', notes: 'Needs a high chair', side: 'partner2', rsvp: 'yes' }).where(eq(guests.id, dan))

  const [group] = await db.insert(groups).values({ weddingId, name: 'Friends', color: '#2563EB' }).returning({ id: groups.id })
  await db.insert(groupMembers).values([
    { weddingId, groupId: group!.id, guestId: ann },
    { weddingId, groupId: group!.id, guestId: cat },
    { weddingId, groupId: group!.id, guestId: eve },
  ])
  const [rule] = await db.insert(rules).values({ weddingId, kind: 'apart', note: 'Old feud' }).returning({ id: rules.id })
  const [together] = await db.insert(rules).values({ weddingId, kind: 'together', nextToEachOther: true }).returning({ id: rules.id })
  await db.insert(ruleGuests).values([
    { weddingId, ruleId: rule!.id, guestId: ann },
    { weddingId, ruleId: rule!.id, guestId: dan },
    { weddingId, ruleId: together!.id, guestId: cat },
    { weddingId, ruleId: together!.id, guestId: dan },
  ])

  let templateId = opts.templateId
  let imageId = ''
  const png = opts.png ?? makeGridPng(60, 40)
  if (!templateId) {
    templateId = await makeTemplate(db, `Hall ${randomUUID().slice(0, 8)}`)
    if (ownerId) await db.update(venueTemplates).set({ ownerUserId: ownerId }).where(eq(venueTemplates.id, templateId))
    const image = await addTemplateImage(db, templateId, png)
    if (image.status !== 'created' && image.status !== 'existed') throw new Error(image.status)
    imageId = image.image.id
    await db.update(venueTemplates).set({ referenceImageId: imageId }).where(eq(venueTemplates.id, templateId))
  } else {
    const [row] = await db.select({ imageId: venueTemplates.referenceImageId }).from(venueTemplates).where(eq(venueTemplates.id, templateId))
    imageId = row?.imageId ?? ''
  }

  const dinnerId = await makeLayout(db, weddingId, canvasOf(roundTable('t1', 1, [ann, ben, eve, null]), roundTable('t2', 2, [cat, dan], 'Family')), {
    name: 'Dinner',
    venueTemplateId: templateId,
  })
  const ceremonyId = await makeLayout(db, weddingId, canvasOf(chairRow('r1', 1, [dan, null], 'Left')), { name: 'Ceremony', kind: 'ceremony' })
  // Removed after it was seated: backups leave Eve out.
  await removeGuests(db, weddingId, [eve])
  return { weddingId, templateId, imageId, png, guestIds: { ann, ben, cat, dan, eve }, groupId: group!.id, ruleId: rule!.id, dinnerId, ceremonyId }
}
