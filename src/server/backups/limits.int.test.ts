/**
 * A wedding at the largest sizes the API takes backs up and restores, both
 * ways: the download of the wedding as it is now restores through Restore
 * from file's steps, and a stored backup downloads and restores on the
 * server. Every text field at its longest (names in letters that NFC turns
 * into two code units, where the API does not normalise), notes and rule
 * notes of 10,000 characters, and more members, layouts and groups than the
 * backup format used to allow (100, 200 and 500). limits.test.ts compares
 * the limits field by field; this proves the whole path.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { TEST_DATABASE_URL } from '../../../test/db'
import { makeUser, sessionCookie, type TestUser } from '../../../test/auth'
import { backupFileSchema, type BackupFile } from '@/domain/backup/schema'
import { restoredName } from '@/domain/backup/remap'
import { makeGridPng } from '@/domain/floorplan/__fixtures__/plans'
import { nameKey } from '@/domain/names'
import { createGroupBody, createGuestBody, createLayoutBody, createRuleBody, createVenueBody, createWeddingBody, type RestoredTemplate, type RestoreStarted } from '@/shared/api'
import { groups, guests, layouts, ruleGuests, rules, users, venueTemplates, weddingMembers, weddings } from '../db/schema'
import type { Db } from '../locks'
import { canvasOf, makeLayout, makeTemplate, roundTable } from '../repo/test-fixtures'
import { addTemplateImage } from '../repo/venues'
import { openStoredBackup } from './read'
import { restoreStoredBackup } from './restore'
import { backupOneWedding } from './runner'
import { getBackupStore } from './store'

const dir = mkdtempSync(path.join(os.tmpdir(), 'backup-limits-'))
let db: Db
let owner: TestUser
let cookie = ''

beforeAll(async () => {
  vi.stubEnv('AUTH_SECRET', 'backup-limits-int-test-secret-32-chars')
  vi.stubEnv('DATABASE_URL', TEST_DATABASE_URL)
  vi.stubEnv('BACKUP_STORE_DIR', dir)
  db = (await import('../db/client')).getDb()
  owner = await makeUser(db, { displayName: 'Olive' })
  cookie = await sessionCookie(db, owner.id)
})
afterAll(() => {
  vi.unstubAllEnvs()
  rmSync(dir, { recursive: true, force: true })
})

/** U+0958: one code unit, two once in NFC. */
const GROWS = 'क़'
const NOTES = `${'Allergic to everything with nuts in it.\n'.repeat(250)}`.slice(0, 9_990).concat('0123456789')
const COUNTS = { members: 101, layouts: 201, groups: 501 }

/** As the API would store it. */
const api = <T>(schema: { parse: (v: unknown) => T }, value: unknown) => schema.parse(value)

/** A wedding at the API's largest sizes, its fields written as the API would have stored them. */
async function biggestWedding() {
  const w = api(createWeddingBody, { name: GROWS.repeat(200), partner1Name: 'P'.repeat(60), partner2Name: 'Q'.repeat(60), unit: 'm' })
  const [wedding] = await db.insert(weddings).values({ name: w.name, unit: 'm', partner1Name: w.partner1Name, partner2Name: w.partner2Name }).returning({ id: weddings.id })
  const weddingId = wedding!.id
  await db.insert(weddingMembers).values({ weddingId, userId: owner.id, role: 'owner' })

  // More members than the format used to hold (they are listed, never restored).
  const people = await db
    .insert(users)
    .values(Array.from({ length: COUNTS.members - 1 }, (_, i) => ({ email: `member-${i}-${randomUUID()}@example.com`, displayName: 'M'.repeat(60), passwordHash: 'x' })))
    .returning({ id: users.id })
  await db.insert(weddingMembers).values(people.map((p) => ({ weddingId, userId: p.id, role: 'editor' as const })))

  const guestIds: string[] = []
  for (const first of ['A', 'B', 'C']) {
    const g = api(createGuestBody, {
      // 99 letters that NFC doubles, and two more: 200 once the API has normalised them.
      firstName: GROWS.repeat(99) + first + 'z',
      lastName: 'L'.repeat(200),
      nickname: 'n'.repeat(100),
      household: 'h'.repeat(200),
      meal: 'm'.repeat(200),
      notes: NOTES,
    })
    const [row] = await db
      .insert(guests)
      .values({ weddingId, firstName: g.firstName, lastName: g.lastName, nameKey: nameKey(g.firstName, g.lastName), nickname: g.nickname, household: g.household, meal: g.meal, notes: g.notes })
      .returning({ id: guests.id })
    guestIds.push(row!.id)
  }

  const groupRows = Array.from({ length: COUNTS.groups }, (_, i) => api(createGroupBody, { name: `${i} ${'g'.repeat(100)}`.slice(0, 100) }))
  await db.insert(groups).values(groupRows.map((g, i) => ({ weddingId, name: g.name, color: `#${(i % 256).toString(16).padStart(2, '0')}2563`.toUpperCase() })))

  for (const kind of ['apart', 'together'] as const) {
    const r = api(createRuleBody, { kind, guestIds, note: NOTES })
    const [rule] = await db.insert(rules).values({ weddingId, kind, note: r.note }).returning({ id: rules.id })
    await db.insert(ruleGuests).values(guestIds.map((guestId) => ({ weddingId, ruleId: rule!.id, guestId })))
  }

  const templateName = api(createVenueBody, { name: GROWS.repeat(200) }).name
  const templateId = await makeTemplate(db, templateName)
  await db.update(venueTemplates).set({ ownerUserId: owner.id }).where(eq(venueTemplates.id, templateId))
  const image = await addTemplateImage(db, templateId, makeGridPng(40, 30))
  if (image.status !== 'created' && image.status !== 'existed') throw new Error(image.status)
  await db.update(venueTemplates).set({ referenceImageId: image.image.id }).where(eq(venueTemplates.id, templateId))

  const layoutName = (i: number) => api(createLayoutBody, { name: `${String(i).padStart(3, '0')}${GROWS.repeat(197)}`, kind: 'reception', venueTemplateId: null }).name
  await makeLayout(db, weddingId, canvasOf(roundTable('t1', 1, [guestIds[0]!, guestIds[1]!, null])), { name: layoutName(0), venueTemplateId: templateId })
  for (let i = 1; i < COUNTS.layouts; i++) await makeLayout(db, weddingId, canvasOf(), { name: layoutName(i) })
  return { weddingId, name: w.name, templateId }
}

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>
async function call(mod: Record<string, unknown>, method: string, params: Record<string, string>, body?: unknown, raw?: Uint8Array) {
  const headers: Record<string, string> = { cookie }
  let init: BodyInit | undefined = raw ? new Uint8Array(raw) : undefined
  if (body !== undefined) {
    headers['content-type'] = 'application/json'
    init = JSON.stringify(body)
  }
  const res = await (mod[method] as Handler)(new NextRequest('https://seat.example/api/x', { method, headers, body: init }), { params: Promise.resolve(params) })
  return { status: res.status, text: await res.text() }
}

/** Restore from file's steps (src/client/backup/restore.ts), through the route handlers. */
async function restoreFromFile(file: BackupFile): Promise<string> {
  const start = await import('@/app/api/weddings/restore/route')
  const templateStep = await import('@/app/api/weddings/restore/[jobId]/templates/route')
  const imageStep = await import('@/app/api/weddings/restore/[jobId]/templates/[templateId]/image/route')
  const layoutStep = await import('@/app/api/weddings/restore/[jobId]/layouts/route')
  const jobId = randomUUID()
  const { format, version, wedding, guests: g, groups: gr, groupMembers: gm, rules: r, ruleGuests: rg } = file
  const started = await call(start, 'POST', {}, { format, version, jobId, wedding, guests: g, groups: gr, groupMembers: gm, rules: r, ruleGuests: rg })
  expect(started.status, started.text.slice(0, 300)).toBe(201)
  for (const template of file.templates) {
    const step = await call(templateStep, 'POST', { jobId }, template)
    expect(step.status).toBe(200)
    const image = file.images.find((i) => i.id === template.imageId)
    if ((JSON.parse(step.text) as RestoredTemplate).needsImage && image) {
      expect((await call(imageStep, 'PUT', { jobId, templateId: template.id }, undefined, Buffer.from(image.data, 'base64'))).status).toBe(200)
    }
  }
  for (const layout of file.layouts) expect((await call(layoutStep, 'POST', { jobId }, layout)).status).toBe(201)
  return (JSON.parse(started.text) as RestoreStarted).weddingId
}

/** What came back, in a form to compare with the source. */
async function contents(weddingId: string) {
  const [w] = await db.select().from(weddings).where(eq(weddings.id, weddingId))
  const g = await db.select().from(guests).where(and(eq(guests.weddingId, weddingId), isNull(guests.deletedAt)))
  const gr = await db.select({ name: groups.name }).from(groups).where(eq(groups.weddingId, weddingId))
  const r = await db.select({ note: rules.note }).from(rules).where(eq(rules.weddingId, weddingId))
  const l = await db.select({ name: layouts.name, venueTemplateId: layouts.venueTemplateId }).from(layouts).where(and(eq(layouts.weddingId, weddingId), isNull(layouts.deletedAt)))
  return {
    name: w!.name,
    partners: [w!.partner1Name, w!.partner2Name],
    guests: g.map((x) => [x.firstName, x.lastName, x.nickname, x.household, x.meal, x.notes]).sort(),
    groups: gr.map((x) => x.name).sort(),
    ruleNotes: r.map((x) => x.note),
    layouts: l.map((x) => x.name).sort(),
    withVenue: l.filter((x) => x.venueTemplateId !== null).length,
  }
}

describe('a wedding at the largest sizes the API takes', () => {
  it('downloads as a file Restore from file restores, and stores as a backup that downloads and restores', { timeout: 120_000 }, async () => {
    const source = await biggestWedding()
    const before = await contents(source.weddingId)
    expect(before.name).toHaveLength(200)
    expect(before.guests[0]![0]).toHaveLength(200)
    expect(before.groups).toHaveLength(COUNTS.groups)
    expect(before.layouts).toHaveLength(COUNTS.layouts)
    const expected = { ...before, name: restoredName(before.name) }

    // The download of the wedding as it is now.
    const live = await import('@/app/api/weddings/[id]/backup/route')
    const download = await call(live, 'GET', { id: source.weddingId })
    expect(download.status, download.text.slice(0, 300)).toBe(200)
    const file = backupFileSchema.parse(JSON.parse(download.text))
    expect(file.members).toHaveLength(COUNTS.members)
    expect(await contents(await restoreFromFile(file))).toEqual(expected)

    // A stored backup: made, read back, downloaded as a file, and restored on the server.
    const store = getBackupStore()!
    const stored = await backupOneWedding(db, store, source.weddingId, { kind: 'manual', userId: owner.id })
    if (stored.status !== 'created') throw new Error(stored.status)
    const opened = await openStoredBackup(store, stored.backup)
    expect(opened.ok).toBe(true)
    const storedDownload = await call(await import('@/app/api/weddings/[id]/backups/[backupId]/route'), 'GET', { id: source.weddingId, backupId: stored.backup.id })
    expect(storedDownload.status).toBe(200)
    expect(await contents(await restoreFromFile(backupFileSchema.parse(JSON.parse(storedDownload.text))))).toEqual(expected)
    const restored = await restoreStoredBackup(db, store, stored.backup.id, { jobId: randomUUID(), actor: { userId: owner.id, isAdmin: false } })
    if (restored.status !== 'restored') throw new Error(restored.status)
    expect(await contents(restored.weddingId)).toEqual(expected)
  })
})
