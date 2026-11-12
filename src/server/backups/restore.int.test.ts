/**
 * Restoring a stored backup on the server (restoreStoredBackup): the same
 * wedding as restoring its downloaded file through the browser's steps; a
 * corrupt backup makes nothing; a job id makes one wedding however often it
 * is sent; and who owns the result.
 */
import { randomUUID } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { and, eq, isNull } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { TEST_DATABASE_URL } from '../../../test/db'
import { makeMember, makeUser, sessionCookie, type TestUser } from '../../../test/auth'
import { backupFileSchema, type BackupFile } from '@/domain/backup/schema'
import type { Canvas } from '@/domain/canvas-schema'
import type { RestoredTemplate, RestoreStarted } from '@/shared/api'
import { templateAccess } from '../auth/venue-access'
import { restoredWeddingId } from '../backup'
import {
  backups as backupsTable,
  groupMembers,
  groups,
  guests,
  layouts,
  layoutSeats,
  ruleGuests,
  rules,
  venueImages,
  venueTemplates,
  weddingMembers,
  weddings,
} from '../db/schema'
import type { Db } from '../locks'
import { backupFileStream } from './assemble'
import { openStoredBackup, storeImageReader } from './read'
import { restoreStoredBackup } from './restore'
import { backupOneWedding, type BackupRow } from './runner'
import { imagePathname } from './store'
import { createMemoryStore, type MemoryStore } from './store-memory'
import { sha256Hex } from './hash'
import { makeBackupWedding, type BackupWedding } from './test-wedding'

let db: Db
let owner: TestUser
let ownerCookie = ''
let admin: TestUser
let store: MemoryStore

beforeAll(async () => {
  vi.stubEnv('AUTH_SECRET', 'stored-restore-int-test-secret-32-chars')
  vi.stubEnv('DATABASE_URL', TEST_DATABASE_URL)
  db = (await import('../db/client')).getDb()
  owner = await makeUser(db, { displayName: 'Olive' })
  ownerCookie = await sessionCookie(db, owner.id)
  admin = await makeUser(db, { displayName: 'Root', isAdmin: true })
  store = createMemoryStore()
})
afterAll(() => {
  vi.unstubAllEnvs()
})

async function storedBackupOf(w: BackupWedding): Promise<BackupRow> {
  const result = await backupOneWedding(db, store, w.weddingId, { kind: 'manual', userId: owner.id })
  if (result.status !== 'created') throw new Error(result.status)
  return result.backup
}

/** The stored backup as the download gives it: a normal file. */
async function downloadedFile(backup: BackupRow): Promise<BackupFile> {
  const opened = await openStoredBackup(store, backup)
  if (!opened.ok) throw new Error(opened.problem)
  return backupFileSchema.parse(JSON.parse(await new Response(backupFileStream(opened.head, storeImageReader(store))).text()))
}

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>
async function call(mod: Record<string, unknown>, method: string, params: Record<string, string>, body?: unknown, raw?: Uint8Array) {
  const headers: Record<string, string> = { cookie: ownerCookie }
  let init: BodyInit | undefined = raw ? new Uint8Array(raw) : undefined
  if (body !== undefined) {
    headers['content-type'] = 'application/json'
    init = JSON.stringify(body)
  }
  const res = await (mod[method] as Handler)(new NextRequest('https://seat.example/api/x', { method, headers, body: init }), { params: Promise.resolve(params) })
  const text = await res.text()
  return { status: res.status, body: text ? (JSON.parse(text) as unknown) : null }
}

/** The browser's "Restore from file" steps (src/client/backup/restore.ts), through the route handlers, as the owner. */
async function restoreFromFile(file: BackupFile): Promise<string> {
  const start = await import('@/app/api/weddings/restore/route')
  const templateStep = await import('@/app/api/weddings/restore/[jobId]/templates/route')
  const imageStep = await import('@/app/api/weddings/restore/[jobId]/templates/[templateId]/image/route')
  const layoutStep = await import('@/app/api/weddings/restore/[jobId]/layouts/route')
  const jobId = randomUUID()
  const { format, version, wedding, guests: g, groups: gr, groupMembers: gm, rules: r, ruleGuests: rg } = file
  const started = await call(start, 'POST', {}, { format, version, jobId, wedding, guests: g, groups: gr, groupMembers: gm, rules: r, ruleGuests: rg })
  expect(started.status).toBe(201)
  for (const template of file.templates) {
    const step = await call(templateStep, 'POST', { jobId }, template)
    expect(step.status).toBe(200)
    const image = file.images.find((i) => i.id === template.imageId)
    if ((step.body as RestoredTemplate).needsImage && image) {
      expect((await call(imageStep, 'PUT', { jobId, templateId: template.id }, undefined, Buffer.from(image.data, 'base64'))).status).toBe(200)
    }
  }
  for (const layout of file.layouts) expect((await call(layoutStep, 'POST', { jobId }, layout)).status).toBe(201)
  return (started.body as RestoreStarted).weddingId
}

/** Everything a restore brings back, by names instead of ids. */
async function snapshot(weddingId: string) {
  const guestRows = await db.select().from(guests).where(and(eq(guests.weddingId, weddingId), isNull(guests.deletedAt)))
  const nameOf = new Map(guestRows.map((g) => [g.id, `${g.firstName} ${g.lastName}`]))
  const named = (id: string | null) => (id ? (nameOf.get(id) ?? `unknown ${id}`) : null)
  const groupRows = await db.select().from(groups).where(eq(groups.weddingId, weddingId))
  const memberRows = await db.select().from(groupMembers).where(eq(groupMembers.weddingId, weddingId))
  const ruleRows = await db.select().from(rules).where(eq(rules.weddingId, weddingId))
  const ruleGuestRows = await db.select().from(ruleGuests).where(eq(ruleGuests.weddingId, weddingId))
  const layoutRows = await db.select().from(layouts).where(and(eq(layouts.weddingId, weddingId), isNull(layouts.deletedAt)))
  const seatRows = await db.select().from(layoutSeats).where(eq(layoutSeats.weddingId, weddingId))
  const templateNames = new Map(
    (await db.select({ id: venueTemplates.id, name: venueTemplates.name, imageId: venueTemplates.referenceImageId }).from(venueTemplates)).map((t) => [t.id, t]),
  )
  const imageSha = async (imageId: string | null | undefined) =>
    imageId ? ((await db.select({ sha256: venueImages.sha256 }).from(venueImages).where(eq(venueImages.id, imageId)))[0]?.sha256 ?? null) : null
  const canvasByName = (canvas: Canvas) =>
    JSON.parse(JSON.stringify(canvas, (key, value: unknown) => (key === 'guestId' && typeof value === 'string' ? named(value) : value))) as unknown
  const [wedding] = await db.select().from(weddings).where(eq(weddings.id, weddingId))
  return {
    wedding: { name: wedding!.name, date: wedding!.date, unit: wedding!.unit, minGapCm: wedding!.minGapCm, partner1Name: wedding!.partner1Name, partner2Name: wedding!.partner2Name },
    guests: guestRows
      .map((g) => ({ name: named(g.id), partner: named(g.partnerId), side: g.side, rsvp: g.rsvp, meal: g.meal, isChild: g.isChild, notes: g.notes, couple: g.coupleRuleEnabled }))
      .sort((a, b) => a.name!.localeCompare(b.name!)),
    groups: groupRows
      .map((g) => ({ name: g.name, color: g.color, members: memberRows.filter((m) => m.groupId === g.id && nameOf.has(m.guestId)).map((m) => named(m.guestId)).sort() }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    rules: ruleRows
      .map((r) => ({ kind: r.kind, next: r.nextToEachOther, appliesTo: r.appliesTo, enabled: r.enabled, note: r.note, guests: ruleGuestRows.filter((x) => x.ruleId === r.id && nameOf.has(x.guestId)).map((x) => named(x.guestId)).sort() }))
      .sort((a, b) => a.kind.localeCompare(b.kind)),
    layouts: await Promise.all(
      layoutRows
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(async (l) => {
          const template = l.venueTemplateId ? templateNames.get(l.venueTemplateId) : undefined
          // Who saved it last, all three columns: the old edited_by, and the name and user that writes since accounts record.
          const editor = { old: l.editedBy, name: l.editedByName, userId: l.editedByUserId }
          return { name: l.name, kind: l.kind, editor, canvas: canvasByName(l.canvas), venue: template?.name ?? null, venueImage: await imageSha(template?.imageId) }
        }),
    ),
    seats: seatRows.map((s) => `${layoutRows.find((l) => l.id === s.layoutId)!.name} ${s.itemLabel} ${s.seatIndex}: ${named(s.guestId)}`).sort(),
  }
}

async function members(weddingId: string) {
  return (await db.select({ userId: weddingMembers.userId, role: weddingMembers.role }).from(weddingMembers).where(eq(weddingMembers.weddingId, weddingId))).sort((a, b) =>
    a.userId.localeCompare(b.userId),
  )
}

describe('restoreStoredBackup', () => {
  it('makes the same wedding as restoring the downloaded file through the browser’s steps', async () => {
    const w = await makeBackupWedding(db, owner.id)
    // The dinner layout last saved by a signed-in user, as every save since accounts is.
    await db.update(layouts).set({ editedBy: null, editedByName: 'Olive', editedByUserId: owner.id }).where(eq(layouts.id, w.dinnerId))
    const backup = await storedBackupOf(w)
    // The walls change after the backup, so both restores copy the venue with its floor plan image.
    await db.update(venueTemplates).set({ fixedItems: [] }).where(eq(venueTemplates.id, w.templateId))

    const fromFile = await restoreFromFile(await downloadedFile(backup))
    const jobId = randomUUID()
    const stored = await restoreStoredBackup(db, store, backup.id, { jobId, actor: { userId: owner.id, isAdmin: false } })
    expect(stored).toMatchObject({ status: 'restored', existed: false, droppedSeats: 0, sourceWeddingId: w.weddingId, ownersAdded: [] })
    if (stored.status !== 'restored') return
    expect(stored.weddingName).toMatch(/ \(restored\)$/)

    const a = await snapshot(fromFile)
    const b = await snapshot(stored.weddingId)
    expect(b).toEqual(a)
    // And both match the source as it was backed up (apart from the name and the venue copy).
    const source = await snapshot(w.weddingId)
    expect(b.guests).toEqual(source.guests)
    expect(b.groups).toEqual(source.groups)
    expect(b.rules).toEqual(source.rules)
    expect(b.seats).toEqual(source.seats)
    expect(b.layouts.map((l) => l.canvas)).toEqual(source.layouts.map((l) => l.canvas))
    expect(b.layouts.find((l) => l.name === 'Dinner')!.venueImage).toBe(sha256Hex(w.png))
    // A restored layout keeps the name the file gives, with no user, and never writes the old edited_by column.
    expect(b.layouts.map((l) => [l.name, l.editor])).toEqual([
      ['Ceremony', { old: null, name: 'Noa', userId: null }],
      ['Dinner', { old: null, name: 'Olive', userId: null }],
    ])
    expect(await members(stored.weddingId)).toEqual([{ userId: owner.id, role: 'owner' }])
  })

  it('makes one wedding per job id, however often it is sent; someone else’s job id is taken', async () => {
    const w = await makeBackupWedding(db, owner.id)
    const backup = await storedBackupOf(w)
    const jobId = randomUUID()
    const actor = { userId: owner.id, isAdmin: false }
    const first = await restoreStoredBackup(db, store, backup.id, { jobId, actor })
    const second = await restoreStoredBackup(db, store, backup.id, { jobId, actor })
    expect(first).toMatchObject({ status: 'restored', existed: false })
    expect(second).toMatchObject({ status: 'restored', existed: true })
    if (first.status !== 'restored' || second.status !== 'restored') return
    expect(second.weddingId).toBe(first.weddingId)
    expect(await db.select().from(layouts).where(eq(layouts.weddingId, first.weddingId))).toHaveLength(2)
    expect(await db.select().from(guests).where(eq(guests.weddingId, first.weddingId))).toHaveLength(4)

    const other = await makeUser(db)
    expect(await restoreStoredBackup(db, store, backup.id, { jobId, actor: { userId: other.id, isAdmin: false } })).toEqual({ status: 'id-taken' })
    expect(await members(first.weddingId)).toEqual([{ userId: owner.id, role: 'owner' }])
    expect(await restoreStoredBackup(db, store, randomUUID(), { jobId: randomUUID(), actor })).toEqual({ status: 'not-found' })
    // A backup in another store (one replaced since) is not found in this one.
    expect(await restoreStoredBackup(db, createMemoryStore(), backup.id, { jobId: randomUUID(), actor })).toEqual({ status: 'not-found' })
  })

  it('answers corrupt and makes nothing for a missing, changed, unreadable or misshapen file, or a missing or changed image', async () => {
    const w = await makeBackupWedding(db, owner.id)
    const actor = { userId: owner.id, isAdmin: false }
    const cases: [string, (b: BackupRow) => Promise<void>, RegExp][] = [
      ['missing file', async (b) => store.delete([b.pathname]), /missing from the backup store/],
      ['bytes changed', async (b) => store.tamper(b.pathname, new Uint8Array([...(await store.get(b.pathname))!, 0])), /does not match its checksum/],
      [
        'not gzip (checksum updated to match)',
        async (b) => {
          const bytes = new TextEncoder().encode('{"not":"gzipped"}')
          store.tamper(b.pathname, bytes)
          await db.update(backupsTable).set({ blobSha256: sha256Hex(bytes) }).where(eq(backupsTable.id, b.id))
        },
        /could not be unzipped/,
      ],
      [
        'not JSON',
        async (b) => {
          const bytes = gzipSync(Buffer.from('{not json'))
          store.tamper(b.pathname, bytes)
          await db.update(backupsTable).set({ blobSha256: sha256Hex(bytes) }).where(eq(backupsTable.id, b.id))
        },
        /not valid JSON/,
      ],
      [
        'not the format',
        async (b) => {
          const bytes = gzipSync(Buffer.from(JSON.stringify({ format: 'seat-plan-backup', version: 2, guests: 'x' })))
          store.tamper(b.pathname, bytes)
          await db.update(backupsTable).set({ blobSha256: sha256Hex(bytes) }).where(eq(backupsTable.id, b.id))
        },
        /does not fit the backup format/,
      ],
      ['missing image', async (b) => store.delete([imagePathname(b.imageSha256s[0]!, 'image/png')]), /image .* is missing from the backup store/],
      ['image changed', async (b) => store.tamper(imagePathname(b.imageSha256s[0]!, 'image/png'), new Uint8Array([1, 2, 3])), /image .* does not match its checksum/],
    ]
    for (const [what, spoil, message] of cases) {
      // Each case on its own store, so a spoiled shared image does not spoil the next.
      store = createMemoryStore()
      const backup = await storedBackupOf(w)
      await spoil(backup)
      const jobId = randomUUID()
      const result = await restoreStoredBackup(db, store, backup.id, { jobId, actor })
      expect(result, what).toEqual({ status: 'corrupt', message: expect.stringMatching(message) })
      // Nothing was made.
      expect(await db.select().from(weddings).where(eq(weddings.id, restoredWeddingId(jobId))), what).toEqual([])
      if (result.status === 'corrupt') expect(result.message, what).not.toMatch(/Ann|Lee|Backup wedding/)
    }
    store = createMemoryStore()
  })

  it('makes the actor the owner; an admin restoring someone else’s wedding also brings back its owners, if it still exists', async () => {
    const coOwner = await makeUser(db, { displayName: 'Cora' })
    const editor = await makeUser(db, { displayName: 'Eddie' })
    const w = await makeBackupWedding(db, owner.id)
    await makeMember(db, w.weddingId, coOwner.id, 'owner')
    await makeMember(db, w.weddingId, editor.id, 'editor')
    const backup = await storedBackupOf(w)

    // The owner: theirs alone, as a restore from a file is.
    const byOwner = await restoreStoredBackup(db, store, backup.id, { jobId: randomUUID(), actor: { userId: owner.id, isAdmin: false } })
    if (byOwner.status !== 'restored') throw new Error(byOwner.status)
    expect(await members(byOwner.weddingId)).toEqual([{ userId: owner.id, role: 'owner' }])

    // An admin who is not an owner: the admin and both current owners; never the editor.
    const byAdmin = await restoreStoredBackup(db, store, backup.id, { jobId: randomUUID(), actor: { userId: admin.id, isAdmin: true } })
    if (byAdmin.status !== 'restored') throw new Error(byAdmin.status)
    expect(byAdmin.ownersAdded.sort()).toEqual([owner.id, coOwner.id].sort())
    expect(await members(byAdmin.weddingId)).toEqual(
      [
        { userId: admin.id, role: 'owner' },
        { userId: owner.id, role: 'owner' },
        { userId: coOwner.id, role: 'owner' },
      ].sort((a, b) => a.userId.localeCompare(b.userId)),
    )

    // An admin who is an owner of the source: their own wedding, theirs alone.
    const adminOwned = await makeBackupWedding(db, admin.id)
    await makeMember(db, adminOwned.weddingId, coOwner.id, 'owner')
    const adminBackup = await storedBackupOf(adminOwned)
    const own = await restoreStoredBackup(db, store, adminBackup.id, { jobId: randomUUID(), actor: { userId: admin.id, isAdmin: true } })
    if (own.status !== 'restored') throw new Error(own.status)
    expect(await members(own.weddingId)).toEqual([{ userId: admin.id, role: 'owner' }])

    // The source deleted: nobody is added (its owners can be invited back by hand).
    await db.update(weddings).set({ deletedAt: new Date() }).where(eq(weddings.id, w.weddingId))
    const afterDelete = await restoreStoredBackup(db, store, backup.id, { jobId: randomUUID(), actor: { userId: admin.id, isAdmin: true } })
    if (afterDelete.status !== 'restored') throw new Error(afterDelete.status)
    expect(await members(afterDelete.weddingId)).toEqual([{ userId: admin.id, role: 'owner' }])
  })

  it('gives the venues of an admin’s restore to the planners it brings back: their own venue when the walls match, else a copy they own and can change', async () => {
    const coOwner = await makeUser(db, { displayName: 'Cora' })
    const w = await makeBackupWedding(db, owner.id)
    await makeMember(db, w.weddingId, coOwner.id, 'owner')
    const backup = await storedBackupOf(w)
    const dinnerVenue = async (weddingId: string) => {
      const [row] = await db.select({ templateId: layouts.venueTemplateId }).from(layouts).where(and(eq(layouts.weddingId, weddingId), eq(layouts.name, 'Dinner')))
      const [template] = await db.select().from(venueTemplates).where(eq(venueTemplates.id, row!.templateId!))
      return template!
    }
    const asAdmin = (jobId: string) => restoreStoredBackup(db, store, backup.id, { jobId, actor: { userId: admin.id, isAdmin: true } })

    // The walls are as they were: the planner's own venue, used as it is.
    const reused = await asAdmin(randomUUID())
    if (reused.status !== 'restored') throw new Error(reused.status)
    expect((await dinnerVenue(reused.weddingId)).id).toBe(w.templateId)

    // The walls changed since: a copy with the floor plan image, owned by the first owner of the source wedding.
    await db.update(venueTemplates).set({ fixedItems: [] }).where(eq(venueTemplates.id, w.templateId))
    const jobId = randomUUID()
    const copied = await asAdmin(jobId)
    if (copied.status !== 'restored') throw new Error(copied.status)
    const copy = await dinnerVenue(copied.weddingId)
    expect(copy.id).not.toBe(w.templateId)
    expect(copy.ownerUserId).toBe(owner.id)
    expect(copy.referenceImageId).not.toBeNull()
    expect(copy.name).toMatch(/ \(restored\)$/)
    // The planner can change it; the admin's own list does not hold it.
    expect(await templateAccess(db, { userId: owner.id, isAdmin: false }, copy.id)).toMatchObject({ read: true, edit: true })
    expect(await db.select().from(venueTemplates).where(and(eq(venueTemplates.ownerUserId, admin.id), eq(venueTemplates.id, copy.id)))).toEqual([])
    // A retry of the same job finds the same copy.
    const again = await asAdmin(jobId)
    if (again.status !== 'restored') throw new Error(again.status)
    expect(again.existed).toBe(true)
    expect((await dinnerVenue(again.weddingId)).id).toBe(copy.id)

    // No planner brought back (the source is deleted): the admin owns the copy, as before.
    await db.update(weddings).set({ deletedAt: new Date() }).where(eq(weddings.id, w.weddingId))
    const alone = await asAdmin(randomUUID())
    if (alone.status !== 'restored') throw new Error(alone.status)
    expect((await dinnerVenue(alone.weddingId)).ownerUserId).toBe(admin.id)
  })
})

