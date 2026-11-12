/**
 * Venue templates repository against the test database: list, create,
 * rename, duplicate (with the image row), save with the version check, delete
 * refused while layouts use the template, images, Accept then "Undo import"
 * through a restored revision, revisions, wall check, and the layout
 * thumbnails a template write redraws. Also who sees what: templates belong
 * to their maker, and replies about who uses a template name only layouts in
 * the viewer's weddings and count the rest.
 */
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeTestDb, truncateAll } from '../../../test/db'
import { makeMember, makeUser } from '../../../test/auth'
import { makeGridPng } from '@/domain/floorplan/__fixtures__/plans'
import type { FixedItem, ReferenceMeta } from '@/domain/venue-schema'
import { MAX_VENUE_IMAGE_BYTES } from '@/shared/api'
import type { Viewer } from '../auth/venue-access'
import type { Editor } from '../editor-name'
import { layouts, users, venueImages, venueTemplateRevisions, venueTemplates } from '../db/schema'
import { weddingLock } from '../locks'
import { createLayout, softDeleteLayout, updateLayout } from './layouts'
import {
  acceptImport,
  addTemplateImage,
  copyName,
  createTemplate,
  duplicateTemplate,
  getTemplate,
  getTemplateImage,
  listRevisions,
  listVenues,
  renameTemplate,
  restoreRevision,
  saveTemplate,
  softDeleteTemplate,
  templateDeleteSummary,
  templateWallCheck,
} from './venues'
import { canvasOf, layoutRow, makeLayout, makeWedding as makeBareWedding, roundTable } from './test-fixtures'
import { softDeleteWedding } from './weddings'

const { pool, db } = makeTestDb()
/** The planner most tests act as, and someone else. */
let me: Viewer
let other: Viewer
/** Two signed-in people who save, as a route passes them (editorOf). */
let NOA: Editor
let AIDEN: Editor
// Start from what migrations leave, whichever file ran before (one fills the seeded template).
beforeAll(async () => {
  await truncateAll(pool)
  me = { userId: (await makeUser(db, { displayName: 'Me' })).id, isAdmin: false }
  other = { userId: (await makeUser(db, { displayName: 'Other' })).id, isAdmin: false }
  NOA = { userId: (await makeUser(db, { displayName: 'Noa' })).id, name: 'Noa' }
  AIDEN = { userId: (await makeUser(db, { displayName: 'Aiden' })).id, name: 'Aiden' }
})

/** A wedding `me` owns (or `owner`, when given). */
async function makeWedding(database: typeof db, name?: string, owner: Viewer = me): Promise<string> {
  const id = await makeBareWedding(database, name)
  await makeMember(database, id, owner.userId, 'owner')
  return id
}
afterAll(async () => {
  await pool.end()
})

const wall = (id: string, points: { x: number; y: number }[], thickness = 20): FixedItem => ({
  id,
  type: 'wall',
  unsure: false,
  unsureNote: '',
  points,
  thickness,
})

const room = (id: string, name: string): FixedItem => ({
  id,
  type: 'room',
  name,
  unsure: true,
  unsureNote: 'Faint line',
  points: [
    { x: 0, y: 0 },
    { x: 1000, y: 0 },
    { x: 1000, y: 800 },
  ],
})

const reference: ReferenceMeta = { scaleCmPerPx: 2.5, offsetX: 0, offsetY: 0, rotation: 0, opacity: 0.5 }

/** A JPEG header (enough for the type and size check; never decoded). */
function jpegHeader(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
    0xff, 0xd9,
  ])
}

async function newTemplate(name = `Venue ${randomUUID().slice(0, 8)}`, viewer: Viewer = me) {
  const result = await createTemplate(db, { name }, viewer, NOA)
  if (result.status !== 'created') throw new Error(result.status)
  return result.venue
}

function saveBody(baseVersion: number, fixedItems: FixedItem[], ref: ReferenceMeta | null = null, saveId = randomUUID()) {
  return { baseVersion, saveId, fixedItems, reference: ref }
}

async function revisionRows(templateId: string) {
  return db
    .select({ id: venueTemplateRevisions.id, reason: venueTemplateRevisions.reason })
    .from(venueTemplateRevisions)
    .where(eq(venueTemplateRevisions.templateId, templateId))
}

describe('create, read, list, rename', () => {
  it('creates an empty template with its first revision; a retry gives it back; a deleted id is taken', async () => {
    const id = randomUUID()
    const first = await createTemplate(db, { id, name: 'Lakeside Hall' }, me, AIDEN)
    expect(first).toMatchObject({
      status: 'created',
      existed: false,
      venue: {
        id,
        name: 'Lakeside Hall',
        version: 1,
        lastSaveId: null,
        editedBy: 'Aiden',
        importedBy: 'hand',
        fixedItems: [],
        reference: null,
        referenceImage: null,
        usedBy: 0,
        access: 'mine',
        ownerName: 'Me',
        canEdit: true,
      },
    })
    expect(await revisionRows(id)).toEqual([{ id: expect.any(String), reason: 'save' }])
    const [row] = await db.select().from(venueTemplates).where(eq(venueTemplates.id, id))
    expect(row).toMatchObject({ ownerUserId: me.userId, isLibrary: false })

    const retry = await createTemplate(db, { id, name: 'Other name' }, me, NOA)
    expect(retry).toMatchObject({ status: 'created', existed: true, venue: { id, name: 'Lakeside Hall' } })
    expect(await revisionRows(id)).toHaveLength(1)
    // The same id from someone else: taken, and nothing about the template comes back.
    expect(await createTemplate(db, { id, name: 'Mine now' }, other, NOA)).toEqual({ status: 'id-taken' })

    expect(await softDeleteTemplate(db, id, me)).toEqual({ status: 'deleted' })
    expect(await createTemplate(db, { id, name: 'Again' }, me, NOA)).toEqual({ status: 'id-taken' })
    expect(await getTemplate(db, id, me)).toBeNull()
    expect(await getTemplate(db, randomUUID(), me)).toBeNull()
  })

  it('lists live templates with live usage, item counts, version and image flag', async () => {
    const t = await newTemplate()
    const saved = await saveTemplate(db, t.id, saveBody(1, [wall('w1', [{ x: 0, y: 0 }, { x: 500, y: 0 }]), room('r1', 'Main Room')]), AIDEN)
    expect(saved.status).toBe('saved')
    const w = await makeWedding(db)
    const goneWedding = await makeWedding(db)
    await makeLayout(db, w, canvasOf(), { venueTemplateId: t.id })
    await makeLayout(db, w, canvasOf(), { venueTemplateId: t.id })
    await softDeleteLayout(db, w, await makeLayout(db, w, canvasOf(), { venueTemplateId: t.id }))
    await makeLayout(db, goneWedding, canvasOf(), { venueTemplateId: t.id })
    await softDeleteWedding(db, goneWedding)

    const listed = (await listVenues(db, me)).find((v) => v.id === t.id)
    expect(listed).toEqual({
      id: t.id,
      name: t.name,
      updatedAt: expect.any(String),
      usedBy: 2,
      version: 2,
      editedBy: 'Aiden',
      editedById: AIDEN.userId,
      importedBy: 'hand',
      fixedItemCount: 2,
      hasReferenceImage: false,
      access: 'mine',
      ownerName: 'Me',
      canEdit: true,
    })
    expect((await getTemplate(db, t.id, me))?.usedBy).toBe(2)
    // The template migration 0001 seeds is there, empty (truncateAll puts it back as 0001 made it), in the library.
    expect((await listVenues(db, me)).find((v) => v.name === 'Toronto Beach Club')).toMatchObject({
      fixedItemCount: 0,
      hasReferenceImage: false,
      access: 'library',
      ownerName: null,
      canEdit: false,
    })
  })

  it('renames without touching the version or the last edited time', async () => {
    const t = await newTemplate()
    const renamed = await renameTemplate(db, t.id, 'The Boathouse', me)
    expect(renamed).toMatchObject({ name: 'The Boathouse', version: 1, updatedAt: t.updatedAt })
    await softDeleteTemplate(db, t.id, me)
    expect(await renameTemplate(db, t.id, 'Nope', me)).toBeNull()
  })
})

describe('saveTemplate', () => {
  it('saves with the version check, answers a retry, refuses a stale base and a deleted template', async () => {
    const t = await newTemplate()
    const items = [wall('w1', [{ x: 0, y: 0 }, { x: 800, y: 0 }])]
    const saveId = randomUUID()
    const saved = await saveTemplate(db, t.id, saveBody(1, items, reference, saveId), AIDEN)
    expect(saved).toMatchObject({ status: 'saved', version: 2, editedBy: 'Aiden' })
    const detail = await getTemplate(db, t.id, me)
    expect(detail).toMatchObject({ version: 2, lastSaveId: saveId, fixedItems: items, reference, referenceImage: null })

    // The same save again (its reply was lost): already saved, nothing new.
    expect(await saveTemplate(db, t.id, saveBody(1, items, reference, saveId), AIDEN)).toMatchObject({ status: 'already-saved', version: 2 })
    // Another tab still on version 1.
    const stale = await saveTemplate(db, t.id, { ...saveBody(1, []) }, NOA)
    expect(stale).toMatchObject({ status: 'conflict', version: 2, editedBy: 'Aiden', lastSaveId: saveId })
    expect((await getTemplate(db, t.id, me))?.fixedItems).toEqual(items)

    // One revision per save that landed (the create, then this save).
    const revisions = await listRevisions(db, t.id)
    expect(revisions?.revisions.map((r) => [r.reason, r.fixedItemCount, r.hasReference])).toEqual([
      ['save', 1, true],
      ['save', 0, false],
    ])
    expect(revisions?.undoImportRevisionId).toBeNull()

    await softDeleteTemplate(db, t.id, me)
    expect(await saveTemplate(db, t.id, saveBody(2, []), AIDEN)).toEqual({ status: 'gone' })
    expect(await saveTemplate(db, randomUUID(), saveBody(1, []), AIDEN)).toEqual({ status: 'gone' })
    expect(await listRevisions(db, t.id)).toBeNull()
  })

  it('answers a retry whose reply was lost as already saved, even after another save landed', async () => {
    const t = await newTemplate()
    const mine = [wall('w1', [{ x: 0, y: 0 }, { x: 800, y: 0 }])]
    const s1 = randomUUID()
    // Noa's phone: S1 lands as version 2, but the reply never arrives.
    expect(await saveTemplate(db, t.id, { ...saveBody(1, mine, null, s1) }, NOA)).toMatchObject({ status: 'saved', version: 2 })
    // Aiden's laptop saves version 3 meanwhile.
    const theirs = [wall('w2', [{ x: 0, y: 0 }, { x: 0, y: 600 }])]
    expect(await saveTemplate(db, t.id, saveBody(2, theirs), AIDEN)).toMatchObject({ status: 'saved', version: 3 })
    // Noa's retry of S1: her change did land, at version 2. Nothing is written again.
    expect(await saveTemplate(db, t.id, { ...saveBody(1, mine, null, s1) }, NOA)).toMatchObject({ status: 'already-saved', version: 2, editedBy: 'Noa' })
    expect(await getTemplate(db, t.id, me)).toMatchObject({ version: 3, fixedItems: theirs })
    // Her next save, from version 2, then meets Aiden's as a conflict.
    expect(await saveTemplate(db, t.id, { ...saveBody(2, mine) }, NOA)).toMatchObject({ status: 'conflict', version: 3, editedBy: 'Aiden' })
    // Accepted imports and restores are remembered the same way.
    const [row] = await db.select({ recentSaves: venueTemplates.recentSaves }).from(venueTemplates).where(eq(venueTemplates.id, t.id))
    expect(row.recentSaves.map((r) => r.version)).toEqual([3, 2])
  })

  it('redraws the thumbnails of layouts using the template, leaving their versions and times alone', async () => {
    const t = await newTemplate()
    const w = await makeWedding(db)
    const layoutId = await makeLayout(db, w, canvasOf(roundTable('t1', 1, [null])), { venueTemplateId: t.id })
    const blank = await makeLayout(db, w, canvasOf(roundTable('t1', 1, [null])))
    const before = await layoutRow(db, layoutId)
    const blankBefore = await layoutRow(db, blank)
    await saveTemplate(db, t.id, saveBody(1, [wall('w1', [{ x: -2000, y: -1500 }, { x: 2000, y: -1500 }])]), AIDEN)
    const after = await layoutRow(db, layoutId)
    expect(after.thumbSvg).not.toBe(before.thumbSvg)
    expect(after.version).toBe(before.version)
    expect(after.updatedAt).toEqual(before.updatedAt)
    expect((await layoutRow(db, blank)).thumbSvg).toBe(blankBefore.thumbSvg)
  })
})

describe('who edited a template', () => {
  const rowOf = async (id: string) => (await db.select().from(venueTemplates).where(eq(venueTemplates.id, id)))[0]!

  it('create, duplicate and save record the signed-in user (id and name), never the old column', async () => {
    const t = await newTemplate()
    expect(await rowOf(t.id)).toMatchObject({ editedBy: null, editedByName: 'Noa', editedByUserId: NOA.userId })
    expect(t).toMatchObject({ editedBy: 'Noa', editedById: NOA.userId })

    // An old Noa / Aiden value, as written before accounts: the next save clears it.
    await db.update(venueTemplates).set({ editedBy: 'Noa' }).where(eq(venueTemplates.id, t.id))
    const saved = await saveTemplate(db, t.id, saveBody(1, []), AIDEN)
    expect(saved).toMatchObject({ status: 'saved', editedBy: 'Aiden', editedById: AIDEN.userId })
    expect(await rowOf(t.id)).toMatchObject({ editedBy: null, editedByName: 'Aiden', editedByUserId: AIDEN.userId })

    const copy = await duplicateTemplate(db, t.id, { id: randomUUID() }, me, AIDEN)
    expect(copy.status).toBe('created')
    if (copy.status === 'created') {
      expect(await rowOf(copy.venue.id)).toMatchObject({ editedBy: null, editedByName: 'Aiden', editedByUserId: AIDEN.userId })
    }
  })

  it('reads the name from edited_by_name when edited_by is null, in every reply', async () => {
    const t = await newTemplate()
    await db.update(venueTemplates).set({ editedBy: null, editedByName: 'Dayna K.', editedByUserId: null }).where(eq(venueTemplates.id, t.id))

    expect(await getTemplate(db, t.id, me)).toMatchObject({ editedBy: 'Dayna K.', editedById: null })
    expect((await listVenues(db, me)).find((v) => v.id === t.id)).toMatchObject({ editedBy: 'Dayna K.', editedById: null })
    expect(await saveTemplate(db, t.id, saveBody(0, []), AIDEN)).toMatchObject({ status: 'conflict', editedBy: 'Dayna K.', editedById: null })
  })

  it('reads edited_by_user_id back as the id, and the next save puts its own editor in its place', async () => {
    const t = await newTemplate()
    const [user] = await db
      .insert(users)
      .values({ email: `${randomUUID()}@example.com`, displayName: 'Dayna K.', passwordHash: 'x' })
      .returning({ id: users.id })
    await db
      .update(venueTemplates)
      .set({ editedBy: null, editedByName: 'Dayna K.', editedByUserId: user!.id })
      .where(eq(venueTemplates.id, t.id))

    expect(await getTemplate(db, t.id, me)).toMatchObject({ editedById: user!.id })
    expect((await listVenues(db, me)).find((v) => v.id === t.id)).toMatchObject({ editedById: user!.id })
    expect(await saveTemplate(db, t.id, saveBody(0, []), AIDEN)).toMatchObject({ status: 'conflict', editedById: user!.id })

    expect(await saveTemplate(db, t.id, saveBody(1, []), AIDEN)).toMatchObject({ status: 'saved', editedBy: 'Aiden', editedById: AIDEN.userId })
    expect(await rowOf(t.id)).toMatchObject({ editedByName: 'Aiden', editedByUserId: AIDEN.userId })
  })
})

describe('duplicate and delete', () => {
  it('duplicates fixed items, reference and a copy of the current image row', async () => {
    const t = await newTemplate('Old Mill')
    const png = makeGridPng(64, 48)
    const upload = await addTemplateImage(db, t.id, png)
    if (upload.status !== 'created') throw new Error(upload.status)
    const items = [wall('w1', [{ x: 0, y: 0 }, { x: 300, y: 0 }]), room('r1', 'Barn')]
    await acceptImport(db, t.id, {
      baseVersion: 1,
      saveId: randomUUID(),
      fixedItems: items,
      imageId: upload.image.id,
      reference,
      importedBy: 'ai',
    }, NOA)

    const copyId = randomUUID()
    const copy = await duplicateTemplate(db, t.id, { id: copyId }, me, AIDEN)
    if (copy.status !== 'created') throw new Error(copy.status)
    expect(copy.venue).toMatchObject({
      id: copyId,
      name: 'Old Mill copy',
      version: 1,
      importedBy: 'ai',
      fixedItems: items,
      reference,
      editedBy: 'Aiden',
      usedBy: 0,
    })
    const image = copy.venue.referenceImage!
    expect(image.id).not.toBe(upload.image.id)
    expect(image).toMatchObject({ templateId: copyId, width: 64, height: 48, sha256: upload.image.sha256, url: `/api/venues/${copyId}/images/${image.id}` })
    const bytes = await getTemplateImage(db, copyId, image.id)
    expect(Buffer.compare(bytes!.bytes, Buffer.from(png))).toBe(0)
    // Only the current image moves over, and the copy starts its own revisions.
    expect(await db.select({ id: venueImages.id }).from(venueImages).where(eq(venueImages.templateId, copyId))).toHaveLength(1)
    expect((await listRevisions(db, copyId))?.revisions).toEqual([
      expect.objectContaining({ reason: 'save', fixedItemCount: 2, referenceImageId: image.id, hasReference: true }),
    ])
    // A retry with the same id gives the same copy; someone else's retry of that id does not.
    expect(await duplicateTemplate(db, t.id, { id: copyId }, me, NOA)).toMatchObject({ status: 'created', existed: true })
    expect(await duplicateTemplate(db, t.id, { id: copyId }, other, NOA)).toEqual({ status: 'id-taken' })

    // Without an image, and with a given name.
    const plain = await newTemplate('Garden')
    const named = await duplicateTemplate(db, plain.id, { name: 'Garden West' }, me, NOA)
    expect(named).toMatchObject({ status: 'created', venue: { name: 'Garden West', referenceImage: null, fixedItems: [] } })

    await softDeleteTemplate(db, plain.id, me)
    expect(await duplicateTemplate(db, plain.id, {}, me, NOA)).toEqual({ status: 'not-found' })
    expect(copyName('x'.repeat(200))).toHaveLength(200)
  })

  it('refuses to delete while live layouts in live weddings use it, and lists them', async () => {
    const t = await newTemplate()
    const w1 = await makeWedding(db, 'Zoe & Sam')
    const w2 = await makeWedding(db, 'Ada & Lin')
    const a = await makeLayout(db, w1, canvasOf(), { name: 'Reception', venueTemplateId: t.id })
    const b = await makeLayout(db, w2, canvasOf(), { name: 'Dinner', venueTemplateId: t.id })
    const c = await makeLayout(db, w2, canvasOf(), { name: 'Afterparty', venueTemplateId: t.id })
    await softDeleteLayout(db, w1, await makeLayout(db, w1, canvasOf(), { name: 'Gone', venueTemplateId: t.id }))
    const goneWedding = await makeWedding(db, 'Deleted wedding')
    await makeLayout(db, goneWedding, canvasOf(), { venueTemplateId: t.id })
    await softDeleteWedding(db, goneWedding)

    const expected = [
      { weddingId: w2, weddingName: 'Ada & Lin', layoutId: c, layoutName: 'Afterparty' },
      { weddingId: w2, weddingName: 'Ada & Lin', layoutId: b, layoutName: 'Dinner' },
      { weddingId: w1, weddingName: 'Zoe & Sam', layoutId: a, layoutName: 'Reception' },
    ]
    expect(await softDeleteTemplate(db, t.id, me)).toEqual({ status: 'in-use', layouts: expected, hiddenLayouts: 0 })
    expect(await templateDeleteSummary(db, t.id, me)).toEqual({ kind: 'venue', name: t.name, layouts: expected, hiddenLayouts: 0, images: 0, revisions: 1 })
    expect(await getTemplate(db, t.id, me)).not.toBeNull()

    for (const [weddingId, id] of [[w1, a], [w2, b], [w2, c]] as const) await updateLayout(db, weddingId, id, { venueTemplateId: null }, me)
    expect(await softDeleteTemplate(db, t.id, me)).toEqual({ status: 'deleted' })
    expect(await softDeleteTemplate(db, t.id, me)).toEqual({ status: 'not-found' })
    expect(await templateDeleteSummary(db, t.id, me)).toBeNull()
    expect((await listVenues(db, me)).some((v) => v.id === t.id)).toBe(false)
  })
})

describe('deleting a template while a layout starts using it', () => {
  it('waits for the layout write, then refuses the delete; a create waiting behind a delete is refused', async () => {
    const t = await newTemplate()
    const w = await makeWedding(db, 'Race check')
    // Another request holds the wedding lock for a moment, as any guest removal does.
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    let locked!: () => void
    const isLocked = new Promise<void>((resolve) => (locked = resolve))
    const holder = db.transaction(async (tx) => {
      await weddingLock(tx, w, 'exclusive')
      locked()
      await held
    })
    await isLocked
    // Noa makes a layout on the venue: the template check passes, then it waits for the wedding lock.
    const creating = createLayout(db, w, { name: 'Reception', kind: 'reception', venueTemplateId: t.id }, me, NOA)
    await new Promise((resolve) => setTimeout(resolve, 200))
    // Aiden deletes the venue meanwhile: it waits for Noa's layout.
    const deleting = softDeleteTemplate(db, t.id, me)
    await new Promise((resolve) => setTimeout(resolve, 200))
    release()
    await holder
    const created = await creating
    expect(created.status).toBe('created')
    const deleted = await deleting
    expect(deleted.status).toBe('in-use')
    expect(await getTemplate(db, t.id, me)).not.toBeNull()

    // The other order: the delete holds the template first, the create waits and is refused.
    const t2 = await newTemplate()
    const layoutId = created.status === 'created' ? created.layout.id : ''
    let releaseDelete!: () => void
    const deleteHeld = new Promise<void>((resolve) => (releaseDelete = resolve))
    let deleteLocked!: () => void
    const isDeleteLocked = new Promise<void>((resolve) => (deleteLocked = resolve))
    const slowDelete = db.transaction(async (tx) => {
      await tx.update(venueTemplates).set({ deletedAt: new Date() }).where(eq(venueTemplates.id, t2.id))
      deleteLocked()
      await deleteHeld
    })
    await isDeleteLocked
    const late = createLayout(db, w, { name: 'Dinner', kind: 'reception', venueTemplateId: t2.id }, me, NOA)
    const moved = updateLayout(db, w, layoutId, { venueTemplateId: t2.id }, me)
    await new Promise((resolve) => setTimeout(resolve, 200))
    releaseDelete()
    await slowDelete
    expect(await late).toEqual({ status: 'bad-template' })
    expect(await moved).toEqual({ status: 'bad-template' })
  })
})

describe('images', () => {
  it('stores PNG and JPEG uploads by their bytes, once each, without pointing the template at them', async () => {
    const t = await newTemplate()
    const png = makeGridPng(120, 80)
    const first = await addTemplateImage(db, t.id, png)
    expect(first).toMatchObject({
      status: 'created',
      image: { templateId: t.id, contentType: 'image/png', width: 120, height: 80, byteSize: png.byteLength },
    })
    if (first.status !== 'created') throw new Error(first.status)
    expect(first.image.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(await addTemplateImage(db, t.id, png)).toEqual({ status: 'existed', image: first.image })

    const jpeg = await addTemplateImage(db, t.id, jpegHeader(2576, 1449))
    expect(jpeg).toMatchObject({ status: 'created', image: { contentType: 'image/jpeg', width: 2576, height: 1449 } })

    // The template is unchanged until Accept.
    expect(await getTemplate(db, t.id, me)).toMatchObject({ version: 1, referenceImage: null })

    expect(await addTemplateImage(db, t.id, new TextEncoder().encode('GIF89a not a plan'))).toEqual({ status: 'bad-type' })
    expect(await addTemplateImage(db, t.id, jpegHeader(9000, 100))).toEqual({ status: 'bad-size' })
    const big = new Uint8Array(MAX_VENUE_IMAGE_BYTES + 1)
    big.set(png.slice(0, 33))
    expect(await addTemplateImage(db, t.id, big)).toEqual({ status: 'too-large' })
    expect(await addTemplateImage(db, randomUUID(), png)).toEqual({ status: 'not-found' })

    const stored = await getTemplateImage(db, t.id, first.image.id)
    expect(stored).toMatchObject({ contentType: 'image/png', width: 120, height: 80, templateName: t.name })
    // Another template's image, or a deleted template, is not found.
    const other = await newTemplate()
    expect(await getTemplateImage(db, other.id, first.image.id)).toBeNull()
    await softDeleteTemplate(db, t.id, me)
    expect(await getTemplateImage(db, t.id, first.image.id)).toBeNull()
  })
})

describe('Accept and Undo import', () => {
  it('accepts a draft in one save, then undoes it by restoring the revision before it', async () => {
    // A template seeded like Toronto Beach Club: no revision rows yet.
    const [seeded] = await db
      .insert(venueTemplates)
      .values({ name: `Seeded ${randomUUID().slice(0, 6)}`, fixedItems: [wall('hand', [{ x: 0, y: 0 }, { x: 100, y: 0 }])] })
      .returning({ id: venueTemplates.id })
    const id = seeded!.id
    const upload = await addTemplateImage(db, id, makeGridPng(200, 100))
    if (upload.status !== 'created') throw new Error(upload.status)
    const w = await makeWedding(db)
    const layoutId = await makeLayout(db, w, canvasOf(roundTable('t1', 1, [null])), { venueTemplateId: id })
    const thumbBefore = (await layoutRow(db, layoutId)).thumbSvg

    // An image of another template is refused, and nothing changes.
    const other = await newTemplate()
    const otherUpload = await addTemplateImage(db, other.id, makeGridPng(10, 10))
    if (otherUpload.status !== 'created') throw new Error(otherUpload.status)
    const imported = [wall('w1', [{ x: -500, y: 0 }, { x: 500, y: 0 }], 25), room('r1', 'Main Room')]
    const body = {
      baseVersion: 1,
      saveId: randomUUID(),
      fixedItems: imported,
      imageId: otherUpload.image.id,
      reference,
      importedBy: 'pdf vectors' as const,
    }
    expect(await acceptImport(db, id, body, NOA)).toEqual({ status: 'bad-image' })
    expect(await revisionRows(id)).toEqual([])

    const accepted = await acceptImport(db, id, { ...body, imageId: upload.image.id }, NOA)
    expect(accepted).toMatchObject({ status: 'saved', version: 2, editedBy: 'Noa' })
    expect(await getTemplate(db, id, me)).toMatchObject({
      version: 2,
      importedBy: 'pdf vectors',
      fixedItems: imported,
      reference,
      referenceImage: { id: upload.image.id, width: 200, height: 100 },
    })
    expect((await layoutRow(db, layoutId)).thumbSvg).not.toBe(thumbBefore)
    // The retry of the same Accept, and a stale one.
    expect(await acceptImport(db, id, { ...body, imageId: upload.image.id }, NOA)).toMatchObject({ status: 'already-saved', version: 2 })
    expect(await acceptImport(db, id, { ...body, imageId: upload.image.id, saveId: randomUUID() }, NOA)).toMatchObject({
      status: 'conflict',
      version: 2,
    })

    // A hand edit after the import.
    await saveTemplate(db, id, saveBody(2, [...imported, wall('w2', [{ x: 0, y: 0 }, { x: 0, y: 300 }])], reference), AIDEN)

    const list = await listRevisions(db, id)
    expect(list!.revisions.map((r) => [r.reason, r.fixedItemCount, r.referenceImageId])).toEqual([
      ['save', 3, upload.image.id],
      ['import', 2, upload.image.id],
      ['save', 1, null],
    ])
    const baseline = list!.revisions[2]!.id
    expect(list!.undoImportRevisionId).toBe(baseline)

    // Undo import, at any later time: a new save putting the state before the import back.
    const restoreSaveId = randomUUID()
    const restored = await restoreRevision(db, id, baseline, { baseVersion: 3, saveId: restoreSaveId }, AIDEN)
    expect(restored).toMatchObject({ status: 'saved', version: 4, editedBy: 'Aiden' })
    expect(await getTemplate(db, id, me)).toMatchObject({
      version: 4,
      importedBy: 'hand',
      fixedItems: [wall('hand', [{ x: 0, y: 0 }, { x: 100, y: 0 }])],
      reference: null,
      referenceImage: null,
    })
    expect((await layoutRow(db, layoutId)).thumbSvg).toBe(thumbBefore)
    expect(await restoreRevision(db, id, baseline, { baseVersion: 3, saveId: restoreSaveId }, AIDEN)).toMatchObject({
      status: 'already-saved',
      version: 4,
    })
    const after = await listRevisions(db, id)
    expect(after!.revisions.map((r) => r.reason)).toEqual(['save', 'save', 'import', 'save'])
    // The image stays stored, so the import can be redone from the import revision.
    const redo = await restoreRevision(db, id, after!.revisions[2]!.id, { baseVersion: 4, saveId: randomUUID() }, NOA)
    expect(redo).toMatchObject({ status: 'saved', version: 5 })
    expect(await getTemplate(db, id, me)).toMatchObject({ fixedItems: imported, referenceImage: { id: upload.image.id }, importedBy: 'hand' })

    // A revision of another template is not found; a stale restore is a conflict.
    const foreign = (await listRevisions(db, other.id))!.revisions[0]!.id
    expect(await restoreRevision(db, id, foreign, { baseVersion: 5, saveId: randomUUID() }, NOA)).toEqual({
      status: 'revision-not-found',
    })
    expect(await restoreRevision(db, id, baseline, { baseVersion: 1, saveId: randomUUID() }, NOA)).toMatchObject({
      status: 'conflict',
      version: 5,
    })
  })
})

describe('templateWallCheck', () => {
  it('lists every live layout using the template with the tables a wall runs through', async () => {
    const t = await newTemplate()
    await saveTemplate(db, t.id, saveBody(1, [wall('w1', [{ x: -1000, y: -600 }, { x: 1000, y: -600 }], 20)]), AIDEN)
    const w = await makeWedding(db, 'Wall check')
    const crossed = { ...roundTable('t1', 4, [null], 'Family'), x: 0, y: -600 }
    const clear = { ...roundTable('t2', 2, [null]), x: 0, y: 400 }
    const hit = await makeLayout(db, w, canvasOf(crossed, clear), { name: 'A', venueTemplateId: t.id })
    const fine = await makeLayout(db, w, canvasOf(clear), { name: 'B', venueTemplateId: t.id })
    await softDeleteLayout(db, w, await makeLayout(db, w, canvasOf(crossed), { name: 'C', venueTemplateId: t.id }))

    expect(await templateWallCheck(db, t.id, me)).toEqual({
      templateVersion: 2,
      hiddenLayouts: 0,
      layouts: [
        { weddingId: w, weddingName: 'Wall check', layoutId: hit, layoutName: 'A', tables: [{ tableId: 't1', label: 'Family (table 4)', wallIds: ['w1'] }] },
        { weddingId: w, weddingName: 'Wall check', layoutId: fine, layoutName: 'B', tables: [] },
      ],
    })
    await db.update(layouts).set({ venueTemplateId: null }).where(eq(layouts.id, hit))
    expect((await templateWallCheck(db, t.id, me))!.layouts.map((l) => l.layoutId)).toEqual([fine])
    expect(await templateWallCheck(db, randomUUID(), me)).toBeNull()
  })
})

describe('who sees what', () => {
  it('names only layouts in weddings the viewer belongs to, counts the rest, and still refuses the delete', async () => {
    const t = await newTemplate()
    await saveTemplate(db, t.id, saveBody(1, [wall('w1', [{ x: -1000, y: 0 }, { x: 1000, y: 0 }])]), AIDEN)
    const mine = await makeWedding(db, 'Mine')
    const theirs = await makeWedding(db, 'Their secret wedding', other)
    const crossed = { ...roundTable('t1', 1, [null], 'Secret table'), x: 0, y: 0 }
    const myLayout = await makeLayout(db, mine, canvasOf(), { name: 'Mine A', venueTemplateId: t.id })
    const theirLayout = await makeLayout(db, theirs, canvasOf(crossed), { name: 'Their layout', venueTemplateId: t.id })
    const myUse = { weddingId: mine, weddingName: 'Mine', layoutId: myLayout, layoutName: 'Mine A' }

    expect(await templateDeleteSummary(db, t.id, me)).toMatchObject({ layouts: [myUse], hiddenLayouts: 1 })
    const check = await templateWallCheck(db, t.id, me)
    expect(check).toEqual({ templateVersion: 2, hiddenLayouts: 1, layouts: [{ ...myUse, tables: [] }] })
    expect((await listVenues(db, me)).find((v) => v.id === t.id)?.usedBy).toBe(1)
    expect((await getTemplate(db, t.id, me))?.usedBy).toBe(1)
    const refused = await softDeleteTemplate(db, t.id, me)
    expect(refused).toEqual({ status: 'in-use', layouts: [myUse], hiddenLayouts: 1 })
    for (const reply of [await templateDeleteSummary(db, t.id, me), check, refused]) {
      expect(JSON.stringify(reply)).not.toContain(theirs)
      expect(JSON.stringify(reply)).not.toContain('Their secret wedding')
      expect(JSON.stringify(reply)).not.toContain(theirLayout)
      expect(JSON.stringify(reply)).not.toContain('Secret table')
    }

    // Once mine moves off it, theirs alone still blocks the delete.
    await updateLayout(db, mine, myLayout, { venueTemplateId: null }, me)
    expect(await softDeleteTemplate(db, t.id, me)).toEqual({ status: 'in-use', layouts: [], hiddenLayouts: 1 })
    expect(await getTemplate(db, t.id, me)).not.toBeNull()

    // The other planner sees their own layout named, as shared (mine) and read-only.
    expect(await templateDeleteSummary(db, t.id, other)).toMatchObject({
      layouts: [{ weddingId: theirs, layoutId: theirLayout }],
      hiddenLayouts: 0,
    })
    expect(await getTemplate(db, t.id, other)).toMatchObject({ access: 'shared', ownerName: 'Me', canEdit: false, usedBy: 1 })

    // An admin sees every layout named.
    const admin = { userId: (await makeUser(db, { isAdmin: true })).id, isAdmin: true }
    expect(await templateDeleteSummary(db, t.id, admin)).toMatchObject({ layouts: [{ layoutId: theirLayout }], hiddenLayouts: 0 })
  })

  it('lists the library, the viewer own and what the wedding uses, and keeps other private templates out', async () => {
    const w = await makeWedding(db, 'Picker')
    const mineT = await newTemplate('Mine for picker')
    const theirsUsedHere = await newTemplate('Theirs used here', other)
    const theirsUnused = await newTemplate('Theirs unused', other)
    await makeMember(db, w, other.userId, 'editor')
    await makeLayout(db, w, canvasOf(), { venueTemplateId: theirsUsedHere.id })

    const names = (await listVenues(db, me, { weddingId: w })).map((v) => v.name)
    expect(names).toEqual(expect.arrayContaining(['Mine for picker', 'Theirs used here', 'Toronto Beach Club']))
    expect(names).not.toContain('Theirs unused')
    const shared = (await listVenues(db, me, { weddingId: w })).find((v) => v.id === theirsUsedHere.id)
    expect(shared).toMatchObject({ access: 'shared', ownerName: 'Other', canEdit: false })
    // Someone else's private template cannot be read, or copied, by name of its id.
    expect(await getTemplate(db, theirsUnused.id, me)).toBeNull()
    expect((await listVenues(db, me)).map((v) => v.id)).not.toContain(theirsUnused.id)
    // A copy of a library template is the copier's own, and private.
    const [tbc] = await db.select({ id: venueTemplates.id }).from(venueTemplates).where(eq(venueTemplates.name, 'Toronto Beach Club'))
    const copy = await duplicateTemplate(db, tbc!.id, { name: 'My beach club' }, me, NOA)
    expect(copy).toMatchObject({ status: 'created', venue: { access: 'mine', canEdit: true } })
    if (copy.status === 'created') {
      const [row] = await db.select().from(venueTemplates).where(eq(venueTemplates.id, copy.venue.id))
      expect(row).toMatchObject({ ownerUserId: me.userId, isLibrary: false })
    }
    expect(mineT.access).toBe('mine')
  })
})
