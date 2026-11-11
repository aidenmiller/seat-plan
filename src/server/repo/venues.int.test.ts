/**
 * Venue templates repository against the test database: list, create,
 * rename, duplicate (with the image row), save with the version check, delete
 * refused while layouts use the template, images, Accept then "Undo import"
 * through a restored revision, revisions, wall check, and the layout
 * thumbnails a template write redraws.
 */
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeTestDb, truncateAll } from '../../../test/db'
import { makeGridPng } from '@/domain/floorplan/__fixtures__/plans'
import type { FixedItem, ReferenceMeta } from '@/domain/venue-schema'
import { MAX_VENUE_IMAGE_BYTES } from '@/shared/api'
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
import { canvasOf, layoutRow, makeLayout, makeWedding, roundTable } from './test-fixtures'
import { softDeleteWedding } from './weddings'

const { pool, db } = makeTestDb()
// Start from what migrations leave, whichever file ran before (one fills the seeded template).
beforeAll(async () => {
  await truncateAll(pool)
})
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

async function newTemplate(name = `Venue ${randomUUID().slice(0, 8)}`) {
  const result = await createTemplate(db, { name, editedBy: 'Noa' })
  if (result.status !== 'created') throw new Error(result.status)
  return result.venue
}

function saveBody(baseVersion: number, fixedItems: FixedItem[], ref: ReferenceMeta | null = null, saveId = randomUUID()) {
  return { baseVersion, saveId, editedBy: 'Aiden' as const, fixedItems, reference: ref }
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
    const first = await createTemplate(db, { id, name: 'Lakeside Hall', editedBy: 'Aiden' })
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
      },
    })
    expect(await revisionRows(id)).toEqual([{ id: expect.any(String), reason: 'save' }])

    const retry = await createTemplate(db, { id, name: 'Other name' })
    expect(retry).toMatchObject({ status: 'created', existed: true, venue: { id, name: 'Lakeside Hall' } })
    expect(await revisionRows(id)).toHaveLength(1)

    expect(await softDeleteTemplate(db, id)).toEqual({ status: 'deleted' })
    expect(await createTemplate(db, { id, name: 'Again' })).toEqual({ status: 'id-taken' })
    expect(await getTemplate(db, id)).toBeNull()
    expect(await getTemplate(db, randomUUID())).toBeNull()
  })

  it('lists live templates with live usage, item counts, version and image flag', async () => {
    const t = await newTemplate()
    const saved = await saveTemplate(db, t.id, saveBody(1, [wall('w1', [{ x: 0, y: 0 }, { x: 500, y: 0 }]), room('r1', 'Main Room')]))
    expect(saved.status).toBe('saved')
    const w = await makeWedding(db)
    const goneWedding = await makeWedding(db)
    await makeLayout(db, w, canvasOf(), { venueTemplateId: t.id })
    await makeLayout(db, w, canvasOf(), { venueTemplateId: t.id })
    await softDeleteLayout(db, await makeLayout(db, w, canvasOf(), { venueTemplateId: t.id }))
    await makeLayout(db, goneWedding, canvasOf(), { venueTemplateId: t.id })
    await softDeleteWedding(db, goneWedding)

    const listed = (await listVenues(db)).find((v) => v.id === t.id)
    expect(listed).toEqual({
      id: t.id,
      name: t.name,
      updatedAt: expect.any(String),
      usedBy: 2,
      version: 2,
      editedBy: 'Aiden',
      editedById: null,
      importedBy: 'hand',
      fixedItemCount: 2,
      hasReferenceImage: false,
    })
    expect((await getTemplate(db, t.id))?.usedBy).toBe(2)
    // The template migration 0001 seeds is there, empty (truncateAll puts it back as 0001 made it).
    expect((await listVenues(db)).find((v) => v.name === 'Toronto Beach Club')).toMatchObject({ fixedItemCount: 0, hasReferenceImage: false })
  })

  it('renames without touching the version or the last edited time', async () => {
    const t = await newTemplate()
    const renamed = await renameTemplate(db, t.id, 'The Boathouse')
    expect(renamed).toMatchObject({ name: 'The Boathouse', version: 1, updatedAt: t.updatedAt })
    await softDeleteTemplate(db, t.id)
    expect(await renameTemplate(db, t.id, 'Nope')).toBeNull()
  })
})

describe('saveTemplate', () => {
  it('saves with the version check, answers a retry, refuses a stale base and a deleted template', async () => {
    const t = await newTemplate()
    const items = [wall('w1', [{ x: 0, y: 0 }, { x: 800, y: 0 }])]
    const saveId = randomUUID()
    const saved = await saveTemplate(db, t.id, saveBody(1, items, reference, saveId))
    expect(saved).toMatchObject({ status: 'saved', version: 2, editedBy: 'Aiden' })
    const detail = await getTemplate(db, t.id)
    expect(detail).toMatchObject({ version: 2, lastSaveId: saveId, fixedItems: items, reference, referenceImage: null })

    // The same save again (its reply was lost): already saved, nothing new.
    expect(await saveTemplate(db, t.id, saveBody(1, items, reference, saveId))).toMatchObject({ status: 'already-saved', version: 2 })
    // Another tab still on version 1.
    const stale = await saveTemplate(db, t.id, { ...saveBody(1, []), editedBy: 'Noa' })
    expect(stale).toMatchObject({ status: 'conflict', version: 2, editedBy: 'Aiden', lastSaveId: saveId })
    expect((await getTemplate(db, t.id))?.fixedItems).toEqual(items)

    // One revision per save that landed (the create, then this save).
    const revisions = await listRevisions(db, t.id)
    expect(revisions?.revisions.map((r) => [r.reason, r.fixedItemCount, r.hasReference])).toEqual([
      ['save', 1, true],
      ['save', 0, false],
    ])
    expect(revisions?.undoImportRevisionId).toBeNull()

    await softDeleteTemplate(db, t.id)
    expect(await saveTemplate(db, t.id, saveBody(2, []))).toEqual({ status: 'gone' })
    expect(await saveTemplate(db, randomUUID(), saveBody(1, []))).toEqual({ status: 'gone' })
    expect(await listRevisions(db, t.id)).toBeNull()
  })

  it('answers a retry whose reply was lost as already saved, even after another save landed', async () => {
    const t = await newTemplate()
    const mine = [wall('w1', [{ x: 0, y: 0 }, { x: 800, y: 0 }])]
    const s1 = randomUUID()
    // Noa's phone: S1 lands as version 2, but the reply never arrives.
    expect(await saveTemplate(db, t.id, { ...saveBody(1, mine, null, s1), editedBy: 'Noa' })).toMatchObject({ status: 'saved', version: 2 })
    // Aiden's laptop saves version 3 meanwhile.
    const theirs = [wall('w2', [{ x: 0, y: 0 }, { x: 0, y: 600 }])]
    expect(await saveTemplate(db, t.id, saveBody(2, theirs))).toMatchObject({ status: 'saved', version: 3 })
    // Noa's retry of S1: her change did land, at version 2. Nothing is written again.
    expect(await saveTemplate(db, t.id, { ...saveBody(1, mine, null, s1), editedBy: 'Noa' })).toMatchObject({ status: 'already-saved', version: 2, editedBy: 'Noa' })
    expect(await getTemplate(db, t.id)).toMatchObject({ version: 3, fixedItems: theirs })
    // Her next save, from version 2, then meets Aiden's as a conflict.
    expect(await saveTemplate(db, t.id, { ...saveBody(2, mine), editedBy: 'Noa' })).toMatchObject({ status: 'conflict', version: 3, editedBy: 'Aiden' })
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
    await saveTemplate(db, t.id, saveBody(1, [wall('w1', [{ x: -2000, y: -1500 }, { x: 2000, y: -1500 }])]))
    const after = await layoutRow(db, layoutId)
    expect(after.thumbSvg).not.toBe(before.thumbSvg)
    expect(after.version).toBe(before.version)
    expect(after.updatedAt).toEqual(before.updatedAt)
    expect((await layoutRow(db, blank)).thumbSvg).toBe(blankBefore.thumbSvg)
  })
})

describe('who edited a template', () => {
  const rowOf = async (id: string) => (await db.select().from(venueTemplates).where(eq(venueTemplates.id, id)))[0]!

  it('create, duplicate and save write both edited_by and edited_by_name', async () => {
    const t = await newTemplate()
    expect(await rowOf(t.id)).toMatchObject({ editedBy: 'Noa', editedByName: 'Noa', editedByUserId: null })
    expect(t).toMatchObject({ editedBy: 'Noa', editedById: null })

    const saved = await saveTemplate(db, t.id, saveBody(1, []))
    expect(saved).toMatchObject({ status: 'saved', editedBy: 'Aiden', editedById: null })
    expect(await rowOf(t.id)).toMatchObject({ editedBy: 'Aiden', editedByName: 'Aiden', editedByUserId: null })

    const copy = await duplicateTemplate(db, t.id, { id: randomUUID(), editedBy: 'Aiden' })
    expect(copy.status).toBe('created')
    if (copy.status === 'created') expect(await rowOf(copy.venue.id)).toMatchObject({ editedBy: 'Aiden', editedByName: 'Aiden' })
  })

  it('reads the name from edited_by_name when edited_by is null, in every reply', async () => {
    const t = await newTemplate()
    await db.update(venueTemplates).set({ editedBy: null, editedByName: 'Dayna K.' }).where(eq(venueTemplates.id, t.id))

    expect(await getTemplate(db, t.id)).toMatchObject({ editedBy: 'Dayna K.', editedById: null })
    expect((await listVenues(db)).find((v) => v.id === t.id)).toMatchObject({ editedBy: 'Dayna K.', editedById: null })
    expect(await saveTemplate(db, t.id, saveBody(0, []))).toMatchObject({ status: 'conflict', editedBy: 'Dayna K.', editedById: null })
  })

  it('reads edited_by_user_id back as the id, and a save by name clears it', async () => {
    const t = await newTemplate()
    const [user] = await db
      .insert(users)
      .values({ email: `${randomUUID()}@example.com`, displayName: 'Dayna K.', passwordHash: 'x' })
      .returning({ id: users.id })
    await db
      .update(venueTemplates)
      .set({ editedBy: null, editedByName: 'Dayna K.', editedByUserId: user!.id })
      .where(eq(venueTemplates.id, t.id))

    expect(await getTemplate(db, t.id)).toMatchObject({ editedById: user!.id })
    expect((await listVenues(db)).find((v) => v.id === t.id)).toMatchObject({ editedById: user!.id })
    expect(await saveTemplate(db, t.id, saveBody(0, []))).toMatchObject({ status: 'conflict', editedById: user!.id })

    expect(await saveTemplate(db, t.id, saveBody(1, []))).toMatchObject({ status: 'saved', editedBy: 'Aiden', editedById: null })
    expect(await rowOf(t.id)).toMatchObject({ editedByName: 'Aiden', editedByUserId: null })
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
      editedBy: 'Noa',
      fixedItems: items,
      imageId: upload.image.id,
      reference,
      importedBy: 'ai',
    })

    const copyId = randomUUID()
    const copy = await duplicateTemplate(db, t.id, { id: copyId, editedBy: 'Aiden' })
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
    // A retry with the same id gives the same copy.
    expect(await duplicateTemplate(db, t.id, { id: copyId })).toMatchObject({ status: 'created', existed: true })

    // Without an image, and with a given name.
    const plain = await newTemplate('Garden')
    const named = await duplicateTemplate(db, plain.id, { name: 'Garden West' })
    expect(named).toMatchObject({ status: 'created', venue: { name: 'Garden West', referenceImage: null, fixedItems: [] } })

    await softDeleteTemplate(db, plain.id)
    expect(await duplicateTemplate(db, plain.id, {})).toEqual({ status: 'not-found' })
    expect(copyName('x'.repeat(200))).toHaveLength(200)
  })

  it('refuses to delete while live layouts in live weddings use it, and lists them', async () => {
    const t = await newTemplate()
    const w1 = await makeWedding(db, 'Zoe & Sam')
    const w2 = await makeWedding(db, 'Ada & Lin')
    const a = await makeLayout(db, w1, canvasOf(), { name: 'Reception', venueTemplateId: t.id })
    const b = await makeLayout(db, w2, canvasOf(), { name: 'Dinner', venueTemplateId: t.id })
    const c = await makeLayout(db, w2, canvasOf(), { name: 'Afterparty', venueTemplateId: t.id })
    await softDeleteLayout(db, await makeLayout(db, w1, canvasOf(), { name: 'Gone', venueTemplateId: t.id }))
    const goneWedding = await makeWedding(db, 'Deleted wedding')
    await makeLayout(db, goneWedding, canvasOf(), { venueTemplateId: t.id })
    await softDeleteWedding(db, goneWedding)

    const expected = [
      { weddingId: w2, weddingName: 'Ada & Lin', layoutId: c, layoutName: 'Afterparty' },
      { weddingId: w2, weddingName: 'Ada & Lin', layoutId: b, layoutName: 'Dinner' },
      { weddingId: w1, weddingName: 'Zoe & Sam', layoutId: a, layoutName: 'Reception' },
    ]
    expect(await softDeleteTemplate(db, t.id)).toEqual({ status: 'in-use', layouts: expected })
    expect(await templateDeleteSummary(db, t.id)).toEqual({ kind: 'venue', name: t.name, layouts: expected, images: 0, revisions: 1 })
    expect(await getTemplate(db, t.id)).not.toBeNull()

    for (const id of [a, b, c]) await updateLayout(db, id, { venueTemplateId: null })
    expect(await softDeleteTemplate(db, t.id)).toEqual({ status: 'deleted' })
    expect(await softDeleteTemplate(db, t.id)).toEqual({ status: 'not-found' })
    expect(await templateDeleteSummary(db, t.id)).toBeNull()
    expect((await listVenues(db)).some((v) => v.id === t.id)).toBe(false)
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
    const creating = createLayout(db, w, { name: 'Reception', kind: 'reception', venueTemplateId: t.id, editedBy: 'Noa' })
    await new Promise((resolve) => setTimeout(resolve, 200))
    // Aiden deletes the venue meanwhile: it waits for Noa's layout.
    const deleting = softDeleteTemplate(db, t.id)
    await new Promise((resolve) => setTimeout(resolve, 200))
    release()
    await holder
    const created = await creating
    expect(created.status).toBe('created')
    const deleted = await deleting
    expect(deleted.status).toBe('in-use')
    expect(await getTemplate(db, t.id)).not.toBeNull()

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
    const late = createLayout(db, w, { name: 'Dinner', kind: 'reception', venueTemplateId: t2.id, editedBy: 'Noa' })
    const moved = updateLayout(db, layoutId, { venueTemplateId: t2.id })
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
    expect(await getTemplate(db, t.id)).toMatchObject({ version: 1, referenceImage: null })

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
    await softDeleteTemplate(db, t.id)
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
      editedBy: 'Noa' as const,
      fixedItems: imported,
      imageId: otherUpload.image.id,
      reference,
      importedBy: 'pdf vectors' as const,
    }
    expect(await acceptImport(db, id, body)).toEqual({ status: 'bad-image' })
    expect(await revisionRows(id)).toEqual([])

    const accepted = await acceptImport(db, id, { ...body, imageId: upload.image.id })
    expect(accepted).toMatchObject({ status: 'saved', version: 2, editedBy: 'Noa' })
    expect(await getTemplate(db, id)).toMatchObject({
      version: 2,
      importedBy: 'pdf vectors',
      fixedItems: imported,
      reference,
      referenceImage: { id: upload.image.id, width: 200, height: 100 },
    })
    expect((await layoutRow(db, layoutId)).thumbSvg).not.toBe(thumbBefore)
    // The retry of the same Accept, and a stale one.
    expect(await acceptImport(db, id, { ...body, imageId: upload.image.id })).toMatchObject({ status: 'already-saved', version: 2 })
    expect(await acceptImport(db, id, { ...body, imageId: upload.image.id, saveId: randomUUID() })).toMatchObject({
      status: 'conflict',
      version: 2,
    })

    // A hand edit after the import.
    await saveTemplate(db, id, saveBody(2, [...imported, wall('w2', [{ x: 0, y: 0 }, { x: 0, y: 300 }])], reference))

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
    const restored = await restoreRevision(db, id, baseline, { baseVersion: 3, saveId: restoreSaveId, editedBy: 'Aiden' })
    expect(restored).toMatchObject({ status: 'saved', version: 4, editedBy: 'Aiden' })
    expect(await getTemplate(db, id)).toMatchObject({
      version: 4,
      importedBy: 'hand',
      fixedItems: [wall('hand', [{ x: 0, y: 0 }, { x: 100, y: 0 }])],
      reference: null,
      referenceImage: null,
    })
    expect((await layoutRow(db, layoutId)).thumbSvg).toBe(thumbBefore)
    expect(await restoreRevision(db, id, baseline, { baseVersion: 3, saveId: restoreSaveId, editedBy: 'Aiden' })).toMatchObject({
      status: 'already-saved',
      version: 4,
    })
    const after = await listRevisions(db, id)
    expect(after!.revisions.map((r) => r.reason)).toEqual(['save', 'save', 'import', 'save'])
    // The image stays stored, so the import can be redone from the import revision.
    const redo = await restoreRevision(db, id, after!.revisions[2]!.id, { baseVersion: 4, saveId: randomUUID(), editedBy: 'Noa' })
    expect(redo).toMatchObject({ status: 'saved', version: 5 })
    expect(await getTemplate(db, id)).toMatchObject({ fixedItems: imported, referenceImage: { id: upload.image.id }, importedBy: 'hand' })

    // A revision of another template is not found; a stale restore is a conflict.
    const foreign = (await listRevisions(db, other.id))!.revisions[0]!.id
    expect(await restoreRevision(db, id, foreign, { baseVersion: 5, saveId: randomUUID(), editedBy: 'Noa' })).toEqual({
      status: 'revision-not-found',
    })
    expect(await restoreRevision(db, id, baseline, { baseVersion: 1, saveId: randomUUID(), editedBy: 'Noa' })).toMatchObject({
      status: 'conflict',
      version: 5,
    })
  })
})

describe('templateWallCheck', () => {
  it('lists every live layout using the template with the tables a wall runs through', async () => {
    const t = await newTemplate()
    await saveTemplate(db, t.id, saveBody(1, [wall('w1', [{ x: -1000, y: -600 }, { x: 1000, y: -600 }], 20)]))
    const w = await makeWedding(db, 'Wall check')
    const crossed = { ...roundTable('t1', 4, [null], 'Family'), x: 0, y: -600 }
    const clear = { ...roundTable('t2', 2, [null]), x: 0, y: 400 }
    const hit = await makeLayout(db, w, canvasOf(crossed, clear), { name: 'A', venueTemplateId: t.id })
    const fine = await makeLayout(db, w, canvasOf(clear), { name: 'B', venueTemplateId: t.id })
    await softDeleteLayout(db, await makeLayout(db, w, canvasOf(crossed), { name: 'C', venueTemplateId: t.id }))

    expect(await templateWallCheck(db, t.id)).toEqual({
      templateVersion: 2,
      layouts: [
        { weddingId: w, weddingName: 'Wall check', layoutId: hit, layoutName: 'A', tables: [{ tableId: 't1', label: 'Family (table 4)', wallIds: ['w1'] }] },
        { weddingId: w, weddingName: 'Wall check', layoutId: fine, layoutName: 'B', tables: [] },
      ],
    })
    await db.update(layouts).set({ venueTemplateId: null }).where(eq(layouts.id, hit))
    expect((await templateWallCheck(db, t.id))!.layouts.map((l) => l.layoutId)).toEqual([fine])
    expect(await templateWallCheck(db, randomUUID())).toBeNull()
  })
})
