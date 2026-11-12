/**
 * buildBackup and its contentSha256, the hash the nightly job compares to
 * decide "unchanged since the last backup". It must change for anything a
 * restore would bring back differently, and for nothing else.
 */
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeTestDb } from '../../../test/db'
import { makeMember, makeUser, type TestUser } from '../../../test/auth'
import { backupFileSchema } from '@/domain/backup/schema'
import { makeGridPng } from '@/domain/floorplan/__fixtures__/plans'
import { databaseImageReader } from '../backup'
import { groupMembers, guests, layouts, rules, shareLinks, users, venueTemplates, weddings } from '../db/schema'
import { editorOf } from '../editor-name'
import { saveLayout } from '../repo/layouts'
import { canvasOf, makeTemplate, roundTable } from '../repo/test-fixtures'
import { addTemplateImage } from '../repo/venues'
import { backupFileStream } from './assemble'
import { buildBackup, contentSha256Of } from './build'
import { makeBackupWedding, type BackupWedding } from './test-wedding'

const { pool, db } = makeTestDb()
let owner: TestUser

beforeAll(async () => {
  owner = await makeUser(db, { displayName: 'Olive' })
})
afterAll(async () => {
  await pool.end()
})

async function hashOf(weddingId: string, includeDeleted = false): Promise<string> {
  const built = await buildBackup(db, weddingId, { includeDeleted })
  if (!built) throw new Error('no backup')
  return built.contentSha256
}

/** Runs `change` and says whether the wedding's hash moved. */
async function changes(w: BackupWedding, change: () => Promise<unknown>): Promise<boolean> {
  const before = await hashOf(w.weddingId)
  await change()
  return (await hashOf(w.weddingId)) !== before
}

describe('buildBackup', () => {
  it('holds the live wedding as a version 2 head, with image references and no image bytes', async () => {
    const w = await makeBackupWedding(db, owner.id)
    const built = (await buildBackup(db, w.weddingId))!
    expect(built.weddingName).toMatch(/^Backup wedding/)
    expect(built.deletedAt).toBeNull()
    expect(built.guestCount).toBe(4)
    expect(built.layoutCount).toBe(2)
    expect(built.head.guests.map((g) => g.firstName).sort()).toEqual(['Ann', 'Ben', 'Cat', 'Dan'])
    expect(built.head.templates.map((t) => t.id)).toEqual([w.templateId])
    expect(built.images).toEqual([{ id: w.imageId, templateId: w.templateId, contentType: 'image/png', width: 60, height: 40, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }])
    expect(JSON.stringify(built.head)).not.toContain('"data"')
    // Put together with its image bytes, it is a normal backup file.
    const text = await new Response(backupFileStream(built.head, databaseImageReader(db))).text()
    const file = backupFileSchema.parse(JSON.parse(text))
    expect(Buffer.from(file.images[0]!.data, 'base64').equals(Buffer.from(w.png))).toBe(true)
  })

  it('finds a deleted wedding only for its final backup, with the guests and layouts it had when deleted', async () => {
    const w = await makeBackupWedding(db, owner.id)
    const live = (await buildBackup(db, w.weddingId))!
    await db.update(weddings).set({ deletedAt: new Date() }).where(eq(weddings.id, w.weddingId))
    expect(await buildBackup(db, w.weddingId)).toBeNull()
    const final = (await buildBackup(db, w.weddingId, { includeDeleted: true }))!
    expect(final.deletedAt).toBeInstanceOf(Date)
    expect(final.guestCount).toBe(4)
    expect(final.layoutCount).toBe(2)
    // Exactly what it held while live.
    expect(final.contentSha256).toBe(live.contentSha256)
    expect(await buildBackup(db, randomUUID(), { includeDeleted: true })).toBeNull()
  })
})

describe('contentSha256', () => {
  it('is the same for two builds with no change, whatever time it is', async () => {
    const w = await makeBackupWedding(db, owner.id)
    const first = (await buildBackup(db, w.weddingId))!
    await new Promise((resolve) => setTimeout(resolve, 15))
    const second = (await buildBackup(db, w.weddingId))!
    expect(second.head.exportedAt).not.toBe(first.head.exportedAt)
    expect(second.contentSha256).toBe(first.contentSha256)
    expect(contentSha256Of({ ...first.head, exportedAt: '2030-01-01T00:00:00.000Z' })).toBe(first.contentSha256)
  })

  it('does not depend on the order keys come in', async () => {
    const w = await makeBackupWedding(db, owner.id)
    const head = (await buildBackup(db, w.weddingId))!.head
    const reversed = Object.fromEntries(Object.entries(head).reverse()) as typeof head
    reversed.wedding = Object.fromEntries(Object.entries(head.wedding).reverse()) as typeof head.wedding
    expect(contentSha256Of(reversed)).toBe(contentSha256Of(head))
  })

  it('changes when a guest is edited, added or removed', async () => {
    const w = await makeBackupWedding(db, owner.id)
    expect(await changes(w, () => db.update(guests).set({ notes: 'Allergic to nuts' }).where(eq(guests.id, w.guestIds.ann)))).toBe(true)
    expect(await changes(w, () => db.update(guests).set({ rsvp: 'no' }).where(eq(guests.id, w.guestIds.cat)))).toBe(true)
    expect(await changes(w, () => db.update(guests).set({ side: 'partner1' }).where(eq(guests.id, w.guestIds.cat)))).toBe(true)
    expect(
      await changes(w, () =>
        db.insert(guests).values({ weddingId: w.weddingId, firstName: 'New', lastName: 'Person', nameKey: 'new|person' }),
      ),
    ).toBe(true)
    expect(await changes(w, () => db.update(guests).set({ deletedAt: new Date() }).where(eq(guests.id, w.guestIds.ben)))).toBe(true)
  })

  it('changes when a seat, a table or anything else on a canvas changes', async () => {
    const w = await makeBackupWedding(db, owner.id)
    const { ann, ben, cat, dan } = w.guestIds
    // Ann and Ben swap seats.
    expect(
      await changes(w, () =>
        db
          .update(layouts)
          .set({ canvas: canvasOf(roundTable('t1', 1, [ben, ann, null, null]), roundTable('t2', 2, [cat, dan], 'Family')) })
          .where(eq(layouts.id, w.dinnerId)),
      ),
    ).toBe(true)
    // The same seats, one table moved.
    const moved = roundTable('t2', 2, [cat, dan], 'Family')
    expect(
      await changes(w, () =>
        db
          .update(layouts)
          .set({ canvas: canvasOf(roundTable('t1', 1, [ben, ann, null, null]), { ...moved, x: moved.x + 10 }) })
          .where(eq(layouts.id, w.dinnerId)),
      ),
    ).toBe(true)
    expect(await changes(w, () => db.update(layouts).set({ name: 'Dinner party' }).where(eq(layouts.id, w.dinnerId)))).toBe(true)
    expect(await changes(w, () => db.update(layouts).set({ deletedAt: new Date() }).where(eq(layouts.id, w.ceremonyId)))).toBe(true)
  })

  it('names the signed-in user who last saved a layout, as the editor readers do, and changes when someone else saves it', async () => {
    const w = await makeBackupWedding(db, owner.id)
    const editor = await makeUser(db, { displayName: 'Edie' })
    await makeMember(db, w.weddingId, editor.id, 'editor')
    const dinner = async () => (await buildBackup(db, w.weddingId))!.head.layouts.find((l) => l.id === w.dinnerId)!
    // makeLayout wrote a name with no user (as a restored layout has).
    expect((await dinner()).editedBy).toBe('Noa')
    const save = (who: TestUser, version: number) =>
      saveLayout(db, w.weddingId, w.dinnerId, { baseVersion: version, saveId: randomUUID(), tabId: 'tab', canvas: canvasOf() }, editorOf(who))
    expect(await changes(w, async () => expect((await save(editor, 1)).status).toBe('saved'))).toBe(true)
    // The save wrote edited_by_user_id and edited_by_name, never the old edited_by column.
    const [row] = await db
      .select({ editedBy: layouts.editedBy, editedByName: layouts.editedByName, editedByUserId: layouts.editedByUserId })
      .from(layouts)
      .where(eq(layouts.id, w.dinnerId))
    expect(row).toEqual({ editedBy: null, editedByName: 'Edie', editedByUserId: editor.id })
    expect((await dinner()).editedBy).toBe('Edie')
    // Saved again by the owner: the backup now names them.
    expect(await changes(w, async () => expect((await save(owner, 2)).status).toBe('saved'))).toBe(true)
    expect((await dinner()).editedBy).toBe('Olive')
  })

  it('changes when a rule, a group or a group member changes', async () => {
    const w = await makeBackupWedding(db, owner.id)
    expect(await changes(w, () => db.update(rules).set({ note: 'Made up' }).where(eq(rules.id, w.ruleId)))).toBe(true)
    expect(await changes(w, () => db.update(rules).set({ enabled: false }).where(eq(rules.id, w.ruleId)))).toBe(true)
    expect(
      await changes(w, () =>
        db.delete(groupMembers).where(and(eq(groupMembers.groupId, w.groupId), eq(groupMembers.guestId, w.guestIds.cat))),
      ),
    ).toBe(true)
  })

  it('changes when the wedding, its partner names or its membership change', async () => {
    const w = await makeBackupWedding(db, owner.id)
    expect(await changes(w, () => db.update(weddings).set({ partner1Name: 'Noah' }).where(eq(weddings.id, w.weddingId)))).toBe(true)
    expect(await changes(w, () => db.update(weddings).set({ partner2Name: null }).where(eq(weddings.id, w.weddingId)))).toBe(true)
    expect(await changes(w, () => db.update(weddings).set({ name: 'Renamed wedding' }).where(eq(weddings.id, w.weddingId)))).toBe(true)
    expect(await changes(w, () => db.update(weddings).set({ minGapCm: 99 }).where(eq(weddings.id, w.weddingId)))).toBe(true)
    const editor = await makeUser(db, { displayName: 'Eddie' })
    expect(await changes(w, () => makeMember(db, w.weddingId, editor.id, 'editor'))).toBe(true)
    // A member's new display name is in the file's member list.
    expect(await changes(w, () => db.update(users).set({ displayName: 'Edward' }).where(eq(users.id, editor.id)))).toBe(true)
  })

  it('changes when the venue template a layout uses changes: its walls, name or floor plan image', async () => {
    const w = await makeBackupWedding(db, owner.id)
    expect(
      await changes(w, () =>
        db
          .update(venueTemplates)
          .set({ fixedItems: [{ id: 'w9', type: 'wall', unsure: false, unsureNote: '', thickness: 20, points: [{ x: 0, y: 0 }, { x: 500, y: 0 }] }] })
          .where(eq(venueTemplates.id, w.templateId)),
      ),
    ).toBe(true)
    expect(await changes(w, () => db.update(venueTemplates).set({ name: 'Renamed hall' }).where(eq(venueTemplates.id, w.templateId)))).toBe(true)
    expect(
      await changes(w, async () => {
        const image = await addTemplateImage(db, w.templateId, makeGridPng(70, 50))
        if (image.status !== 'created') throw new Error(image.status)
        await db.update(venueTemplates).set({ referenceImageId: image.image.id }).where(eq(venueTemplates.id, w.templateId))
      }),
    ).toBe(true)
    // A layout switching to another template.
    const other = await makeTemplate(db, 'Other hall')
    expect(await changes(w, () => db.update(layouts).set({ venueTemplateId: other }).where(eq(layouts.id, w.ceremonyId)))).toBe(true)
  })

  it('does not change for another wedding, an unused template, a share link, or saves that change nothing', async () => {
    const w = await makeBackupWedding(db, owner.id)
    const other = await makeBackupWedding(db, owner.id)
    const unused = await makeTemplate(db, 'Unused hall')
    expect(await changes(w, () => db.update(guests).set({ notes: 'Changed' }).where(eq(guests.id, other.guestIds.ann)))).toBe(false)
    expect(await changes(w, () => db.update(weddings).set({ name: 'Other renamed' }).where(eq(weddings.id, other.weddingId)))).toBe(false)
    expect(await changes(w, () => db.update(venueTemplates).set({ name: 'Unused renamed' }).where(eq(venueTemplates.id, unused)))).toBe(false)
    // The other wedding's own template (not used by w).
    expect(await changes(w, () => db.update(venueTemplates).set({ name: 'Theirs renamed' }).where(eq(venueTemplates.id, other.templateId)))).toBe(false)
    expect(
      await changes(w, () =>
        db.insert(shareLinks).values({ weddingId: w.weddingId, layoutId: w.dinnerId, token: randomUUID().repeat(2), passwordHash: 'x' }),
      ),
    ).toBe(false)
    // Saves that write the same values: updated_at, versions and save ids move, nothing a restore reads does.
    expect(await changes(w, () => db.update(guests).set({ notes: 'Needs a high chair' }).where(eq(guests.id, w.guestIds.dan)))).toBe(false)
    expect(await changes(w, () => db.update(layouts).set({ version: 7, lastSaveId: randomUUID(), thumbSvg: '<svg/>' }).where(eq(layouts.id, w.dinnerId)))).toBe(false)
    expect(await changes(w, () => db.update(venueTemplates).set({ version: 9 }).where(eq(venueTemplates.id, w.templateId)))).toBe(false)
    expect(await changes(w, () => db.update(weddings).set({ updatedAt: new Date(Date.now() + 60_000) }).where(eq(weddings.id, w.weddingId)))).toBe(false)
    // Someone outside the wedding renaming themselves.
    const stranger = await makeUser(db)
    expect(await changes(w, () => db.update(users).set({ displayName: 'Someone else' }).where(eq(users.id, stranger.id)))).toBe(false)
  })
})
