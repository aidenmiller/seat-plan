/**
 * A wedding's stored backups, through its routes: listing, Back up now (with
 * its 5-minute rule), downloading one as a normal backup file (which the
 * existing Restore from file restores), and restoring one on the server.
 * Owners only; another wedding's backup id reads as missing.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { TEST_DATABASE_URL } from '../../../../../../test/db'
import { makeMember, makeUser, sessionCookie, type TestUser } from '../../../../../../test/auth'
import { backupFileSchema } from '@/domain/backup/schema'
import type { RestoredLayout, RestoredTemplate, RestoreStarted } from '@/shared/api'
import type { BackupNowReply, RestoredBackupReply, WeddingBackupsReply } from '@/shared/backups-api'
import { activityEvents, backupRuns, backups, guests, layouts, rules, weddingMembers } from '@/server/db/schema'
import type { Db } from '@/server/locks'
import { getBackupStore } from '@/server/backups/store'
import { makeBackupWedding, type BackupWedding } from '@/server/backups/test-wedding'

const dir = mkdtempSync(path.join(os.tmpdir(), 'wedding-backups-'))
let db: Db
let owner: TestUser
let editor: TestUser
let outsider: TestUser
let admin: TestUser
const cookies = { owner: '', editor: '', outsider: '', admin: '' }

beforeAll(async () => {
  vi.stubEnv('AUTH_SECRET', 'wedding-backups-int-test-secret-32-chars')
  vi.stubEnv('DATABASE_URL', TEST_DATABASE_URL)
  vi.stubEnv('BACKUP_STORE_DIR', dir)
  db = (await import('@/server/db/client')).getDb()
  owner = await makeUser(db, { displayName: 'Olive' })
  editor = await makeUser(db, { displayName: 'Eddie' })
  outsider = await makeUser(db, { displayName: 'Otto' })
  admin = await makeUser(db, { displayName: 'Root', isAdmin: true })
  for (const [who, user] of Object.entries({ owner, editor, outsider, admin })) cookies[who as keyof typeof cookies] = await sessionCookie(db, user.id)
})
afterAll(() => {
  vi.unstubAllEnvs()
  rmSync(dir, { recursive: true, force: true })
})

const routes = async () => ({
  list: await import('./route'),
  one: await import('./[backupId]/route'),
  restore: await import('./[backupId]/restore/route'),
})

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>
async function call(mod: Record<string, unknown>, method: string, params: Record<string, string>, opts: { cookie: string; body?: unknown; raw?: Uint8Array }) {
  const headers: Record<string, string> = { cookie: opts.cookie }
  let init: BodyInit | undefined = opts.raw ? new Uint8Array(opts.raw) : undefined
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json'
    init = JSON.stringify(opts.body)
  }
  const res = await (mod[method] as Handler)(new NextRequest('https://seat.example/api/weddings/x/backups', { method, headers, body: init }), {
    params: Promise.resolve(params),
  })
  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }
  return { status: res.status, headers: res.headers, text, body }
}

/** A wedding owned by `owner`, with `editor` as its editor. */
async function wedding(): Promise<BackupWedding> {
  const w = await makeBackupWedding(db, owner.id)
  await makeMember(db, w.weddingId, editor.id, 'editor')
  return w
}

/** A planner of their own with a wedding, so their backups by hand do not count against `owner`'s 10 a day. */
async function ownWedding(): Promise<{ w: BackupWedding; cookie: string }> {
  const planner = await makeUser(db, { displayName: 'Rowan' })
  return { w: await makeBackupWedding(db, planner.id), cookie: await sessionCookie(db, planner.id) }
}

/** A backup row of another store, for counting: nothing reads its file. */
function fakeBackup(opts: { createdBy: string | null; createdAt: Date }): typeof backups.$inferInsert {
  const id = randomUUID()
  return {
    id,
    storeId: 'memory:counted-only',
    weddingId: randomUUID(),
    weddingName: 'Elsewhere',
    kind: 'manual',
    pathname: `backups/w/${randomUUID()}/2026/01/20260101T000000Z-manual-${id}.json.gz`,
    byteSize: 1,
    blobSha256: 'a'.repeat(64),
    contentSha256: 'b'.repeat(64),
    formatVersion: 2,
    guestCount: 0,
    layoutCount: 0,
    createdBy: opts.createdBy,
    createdAt: opts.createdAt,
  }
}

/** Lets the next Back up now of this wedding through the 5-minute rule. */
/** Moves the wedding's backups 6 minutes into the past, each by the same amount, so their order (which is newest) stays. */
async function age(weddingId: string) {
  await db
    .update(backups)
    .set({ createdAt: sql`${backups.createdAt} - interval '6 minutes'` })
    .where(eq(backups.weddingId, weddingId))
}

describe('the wedding’s backup routes', () => {
  it('lists the backups and backs up now for the owner (and an admin), 403 for an editor, 404 for anyone else', async () => {
    const w = await wedding()
    const r = await routes()
    const empty = await call(r.list, 'GET', { id: w.weddingId }, { cookie: cookies.owner })
    expect(empty).toMatchObject({ status: 200, body: { configured: true, backups: [] } })

    const made = await call(r.list, 'POST', { id: w.weddingId }, { cookie: cookies.owner })
    expect(made.status).toBe(201)
    const reply = made.body as BackupNowReply
    expect(reply).toMatchObject({ status: 'created', backup: { weddingId: w.weddingId, kind: 'manual', guestCount: 4, layoutCount: 2, createdByName: 'Olive' } })
    const listed = (await call(r.list, 'GET', { id: w.weddingId }, { cookie: cookies.owner })).body as WeddingBackupsReply
    expect(listed.backups.map((b) => b.id)).toEqual([reply.backup.id])
    const [event] = await db.select().from(activityEvents).where(and(eq(activityEvents.kind, 'backup_created'), eq(activityEvents.subjectId, reply.backup.id)))
    expect(event).toMatchObject({ userId: owner.id, weddingId: w.weddingId })

    for (const method of ['GET', 'POST']) {
      expect((await call(r.list, method, { id: w.weddingId }, { cookie: cookies.editor })).status, `${method} as editor`).toBe(403)
      expect(await call(r.list, method, { id: w.weddingId }, { cookie: cookies.outsider }), `${method} as outsider`).toMatchObject({ status: 404 })
    }
    expect((await call(r.list, 'GET', { id: w.weddingId }, { cookie: cookies.admin })).status).toBe(200)
    // The only Back up now so far is the owner's.
    expect(await db.select().from(backups).where(eq(backups.weddingId, w.weddingId))).toHaveLength(1)
  })

  it('holds Back up now to once per 5 minutes per wedding, then answers unchanged when nothing changed', async () => {
    const w = await wedding()
    const r = await routes()
    expect((await call(r.list, 'POST', { id: w.weddingId }, { cookie: cookies.owner })).status).toBe(201)
    await db.update(guests).set({ notes: 'Changed' }).where(eq(guests.id, w.guestIds.ann))
    const soon = await call(r.list, 'POST', { id: w.weddingId }, { cookie: cookies.owner })
    expect(soon).toMatchObject({ status: 429, body: { error: 'too_soon' } })
    expect(Number(soon.headers.get('retry-after'))).toBeGreaterThan(200)
    expect(Number(soon.headers.get('retry-after'))).toBeLessThanOrEqual(300)
    // An admin is held to it too.
    expect((await call(r.list, 'POST', { id: w.weddingId }, { cookie: cookies.admin })).status).toBe(429)
    // Another wedding is not.
    const other = await wedding()
    expect((await call(r.list, 'POST', { id: other.weddingId }, { cookie: cookies.owner })).status).toBe(201)

    await age(w.weddingId)
    const changed = await call(r.list, 'POST', { id: w.weddingId }, { cookie: cookies.owner })
    expect(changed).toMatchObject({ status: 201, body: { status: 'created' } })
    await age(w.weddingId)
    const same = await call(r.list, 'POST', { id: w.weddingId }, { cookie: cookies.owner })
    expect(same).toMatchObject({ status: 200, body: { status: 'unchanged', backup: { id: (changed.body as BackupNowReply).backup.id } } })
  })

  it('goes ahead while the nightly run is going (it never takes the run’s lease), and answers 409 only while this wedding is being backed up', async () => {
    const w = await wedding()
    const r = await routes()
    const [alive] = await db.insert(backupRuns).values({ trigger: 'cron' }).returning({ id: backupRuns.id })
    try {
      expect(await call(r.list, 'POST', { id: w.weddingId }, { cookie: cookies.owner })).toMatchObject({ status: 201, body: { status: 'created' } })
      // The nightly run is still the only running run.
      expect((await db.select().from(backupRuns).where(eq(backupRuns.status, 'running'))).map((x) => x.id)).toEqual([alive!.id])
    } finally {
      await db.update(backupRuns).set({ status: 'ok', finishedAt: new Date() }).where(eq(backupRuns.id, alive!.id))
    }
    // While the wedding's backup lock is held (as the nightly run holds it while it backs this wedding up): 409.
    const other = await wedding()
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`backup:wedding:${other.weddingId}`}, 0))`)
      expect(await call(r.list, 'POST', { id: other.weddingId }, { cookie: cookies.owner })).toMatchObject({
        status: 409,
        body: { error: 'busy', message: 'This wedding is being backed up right now. Try again in a minute.' },
      })
    })
    expect(await db.select().from(backups).where(eq(backups.weddingId, other.weddingId))).toEqual([])
  })

  it('holds one person to 10 backups by hand in 24 hours, across all their weddings, with a plain 429', async () => {
    const planner = await makeUser(db, { displayName: 'Paula' })
    const cookie = await sessionCookie(db, planner.id)
    const w = await makeBackupWedding(db, planner.id)
    const r = await routes()
    // Ten backups by hand of other weddings in the last day, the oldest 20 hours ago.
    const ids: string[] = []
    for (let i = 0; i < 10; i++) {
      const [row] = await db.insert(backups).values(fakeBackup({ createdBy: planner.id, createdAt: new Date(Date.now() - (20 - i) * 3600_000) })).returning({ id: backups.id })
      ids.push(row!.id)
    }
    const refused = await call(r.list, 'POST', { id: w.weddingId }, { cookie })
    expect(refused).toMatchObject({ status: 429, body: { error: 'daily_limit', message: expect.stringMatching(/^You have made 10 backups by hand in the last 24 hours/) } })
    // Retry-After: when the oldest of the ten is a day old, about 4 hours on.
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(3.9 * 3600)
    expect(Number(refused.headers.get('retry-after'))).toBeLessThanOrEqual(4 * 3600)
    // Someone else is not held back by it.
    expect((await call(r.list, 'POST', { id: (await wedding()).weddingId }, { cookie: cookies.owner })).status).toBe(201)
    // A day on, the planner may again.
    await db.update(backups).set({ createdAt: new Date(Date.now() - 25 * 3600_000) }).where(inArray(backups.id, ids))
    expect((await call(r.list, 'POST', { id: w.weddingId }, { cookie })).status).toBe(201)
    await db.delete(backups).where(inArray(backups.id, ids))
  })

  it('answers 429 when backups by hand have used their share of the upload limit, which is kept apart from the nightly run’s', async () => {
    const planner = await makeUser(db, { displayName: 'Quinn' })
    const cookie = await sessionCookie(db, planner.id)
    const w = await makeBackupWedding(db, planner.id)
    const r = await routes()
    // 500 manual backups in the last 30 days (another store's, by nobody here): the whole share, with this file's own on top.
    const rows = Array.from({ length: 500 }, () => fakeBackup({ createdBy: null, createdAt: new Date(Date.now() - 10 * 86_400_000) }))
    const ids = (await db.insert(backups).values(rows).returning({ id: backups.id })).map((x) => x.id)
    try {
      expect(await call(r.list, 'POST', { id: w.weddingId }, { cookie })).toMatchObject({
        status: 429,
        body: { error: 'upload_limit', message: expect.stringMatching(/^Back up now is paused: backups made by hand used 5\d\d of the 500 uploads they may make in 30 days/) },
      })
      expect(await db.select().from(backups).where(eq(backups.weddingId, w.weddingId))).toEqual([])
    } finally {
      await db.delete(backups).where(inArray(backups.id, ids))
    }
  })

  it('downloads a stored backup as a normal backup file, which Restore from file restores', async () => {
    const w = await wedding()
    const r = await routes()
    const made = (await call(r.list, 'POST', { id: w.weddingId }, { cookie: cookies.owner })).body as BackupNowReply
    // The wedding changes afterwards: the download is the backup, not the wedding now.
    await db.update(guests).set({ deletedAt: new Date() }).where(eq(guests.id, w.guestIds.cat))

    const res = await call(r.one, 'GET', { id: w.weddingId, backupId: made.backup.id }, { cookie: cookies.owner })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8')
    const day = made.backup.createdAt.slice(0, 10)
    expect(res.headers.get('content-disposition')).toMatch(new RegExp(`^attachment; filename="Backup wedding [0-9a-f]{8} backup ${day}\\.json"`))
    const file = backupFileSchema.parse(JSON.parse(res.text))
    expect(file.guests.map((g) => g.firstName).sort()).toEqual(['Ann', 'Ben', 'Cat', 'Dan'])
    expect(Buffer.from(file.images[0]!.data, 'base64').equals(Buffer.from(w.png))).toBe(true)

    // Restore from file, the browser's steps through the existing routes.
    const start = await import('../../restore/route')
    const templateStep = await import('../../restore/[jobId]/templates/route')
    const imageStep = await import('../../restore/[jobId]/templates/[templateId]/image/route')
    const layoutStep = await import('../../restore/[jobId]/layouts/route')
    const jobId = randomUUID()
    const cookie = cookies.owner
    const { format, version, wedding: wed, guests: g, groups, groupMembers, rules, ruleGuests } = file
    const started = await call(start, 'POST', {}, { cookie, body: { format, version, jobId, wedding: wed, guests: g, groups, groupMembers, rules, ruleGuests } })
    expect(started.status).toBe(201)
    for (const template of file.templates) {
      const step = (await call(templateStep, 'POST', { jobId }, { cookie, body: template })).body as RestoredTemplate
      const image = file.images.find((i) => i.id === template.imageId)
      if (step.needsImage && image) expect((await call(imageStep, 'PUT', { jobId, templateId: template.id }, { cookie, raw: Buffer.from(image.data, 'base64') })).status).toBe(200)
    }
    for (const layout of file.layouts) expect(((await call(layoutStep, 'POST', { jobId }, { cookie, body: layout })).body as RestoredLayout).droppedSeats).toBe(0)
    const restoredId = (started.body as RestoreStarted).weddingId
    const restoredGuests = await db.select({ firstName: guests.firstName }).from(guests).where(and(eq(guests.weddingId, restoredId), isNull(guests.deletedAt)))
    expect(restoredGuests.map((x) => x.firstName).sort()).toEqual(['Ann', 'Ben', 'Cat', 'Dan'])

    // Editors and outsiders cannot download it.
    expect((await call(r.one, 'GET', { id: w.weddingId, backupId: made.backup.id }, { cookie: cookies.editor })).status).toBe(403)
    expect((await call(r.one, 'GET', { id: w.weddingId, backupId: made.backup.id }, { cookie: cookies.outsider })).status).toBe(404)
  })

  it('never reaches another wedding’s backup by its id, even for an owner of both', async () => {
    const a = await wedding()
    const b = await wedding()
    const r = await routes()
    const backupA = ((await call(r.list, 'POST', { id: a.weddingId }, { cookie: cookies.owner })).body as BackupNowReply).backup.id
    const jobId = randomUUID()
    expect((await call(r.one, 'GET', { id: b.weddingId, backupId: backupA }, { cookie: cookies.owner })).status).toBe(404)
    expect((await call(r.restore, 'POST', { id: b.weddingId, backupId: backupA }, { cookie: cookies.owner, body: { jobId } })).status).toBe(404)
    expect((await call(r.one, 'GET', { id: a.weddingId, backupId: randomUUID() }, { cookie: cookies.owner })).status).toBe(404)
    expect((await call(r.one, 'GET', { id: a.weddingId, backupId: 'not-a-uuid' }, { cookie: cookies.owner })).status).toBe(404)
    const listB = (await call(r.list, 'GET', { id: b.weddingId }, { cookie: cookies.owner })).body as WeddingBackupsReply
    expect(listB.backups).toEqual([])
  })

  it('restores a stored backup on the server: 201, 200 for the same job id, the owner its only member', async () => {
    const w = await wedding()
    const r = await routes()
    const backupId = ((await call(r.list, 'POST', { id: w.weddingId }, { cookie: cookies.owner })).body as BackupNowReply).backup.id
    const jobId = randomUUID()
    const first = await call(r.restore, 'POST', { id: w.weddingId, backupId }, { cookie: cookies.owner, body: { jobId } })
    expect(first.status).toBe(201)
    const reply = first.body as RestoredBackupReply
    expect(reply).toMatchObject({ jobId, droppedSeats: 0, ownersAdded: 0, weddingName: expect.stringMatching(/ \(restored\)$/) })
    expect((await call(r.restore, 'POST', { id: w.weddingId, backupId }, { cookie: cookies.owner, body: { jobId } })).status).toBe(200)
    expect(await db.select({ userId: weddingMembers.userId, role: weddingMembers.role }).from(weddingMembers).where(eq(weddingMembers.weddingId, reply.weddingId))).toEqual([
      { userId: owner.id, role: 'owner' },
    ])
    expect(await db.select().from(layouts).where(eq(layouts.weddingId, reply.weddingId))).toHaveLength(2)
    const [event] = await db.select().from(activityEvents).where(and(eq(activityEvents.kind, 'backup_restored'), eq(activityEvents.weddingId, reply.weddingId)))
    expect(event).toMatchObject({ userId: owner.id, subjectId: backupId, detail: { sourceWeddingId: w.weddingId, jobId } })

    // Bad bodies, an editor, and an admin through admin power (who also brings the owner along).
    expect((await call(r.restore, 'POST', { id: w.weddingId, backupId }, { cookie: cookies.owner, body: { jobId: 'nope' } })).status).toBe(422)
    expect((await call(r.restore, 'POST', { id: w.weddingId, backupId }, { cookie: cookies.owner, raw: new Uint8Array([1]) })).status).toBe(415)
    expect((await call(r.restore, 'POST', { id: w.weddingId, backupId }, { cookie: cookies.editor, body: { jobId: randomUUID() } })).status).toBe(403)
    const byAdmin = await call(r.restore, 'POST', { id: w.weddingId, backupId }, { cookie: cookies.admin, body: { jobId: randomUUID() } })
    expect(byAdmin).toMatchObject({ status: 201, body: { ownersAdded: 1 } })
  })

  it('answers 500 corrupt for a backup that fails its checks, and makes nothing', async () => {
    const { w, cookie } = await ownWedding()
    const r = await routes()
    const made = ((await call(r.list, 'POST', { id: w.weddingId }, { cookie })).body as BackupNowReply).backup
    const [row] = await db.select({ pathname: backups.pathname }).from(backups).where(eq(backups.id, made.id))
    const store = getBackupStore()!
    await store.put(row!.pathname, new Uint8Array([1, 2, 3]), 'application/gzip', { overwrite: true })
    // Short: what is wrong, and to make a fresh one.
    const message = 'This backup is unreadable: its file does not match its checksum. Use Back up now to make a fresh one.'
    expect(await call(r.one, 'GET', { id: w.weddingId, backupId: made.id }, { cookie })).toMatchObject({ status: 500, body: { error: 'corrupt', message } })
    const jobId = randomUUID()
    expect((await call(r.restore, 'POST', { id: w.weddingId, backupId: made.id }, { cookie, body: { jobId } })).body).toEqual({ error: 'corrupt', message })
    const { restoredWeddingId } = await import('@/server/backup')
    expect(await db.select().from(weddingMembers).where(eq(weddingMembers.weddingId, restoredWeddingId(jobId)))).toEqual([])
    // Marked unreadable, so the next backup is made afresh instead of finding the wedding unchanged since it.
    const [marked] = await db.select({ unreadableAt: backups.unreadableAt }).from(backups).where(eq(backups.id, made.id))
    expect(marked!.unreadableAt).not.toBeNull()
    await age(w.weddingId)
    expect(await call(r.list, 'POST', { id: w.weddingId }, { cookie })).toMatchObject({ status: 201, body: { status: 'created' } })
  })

  it('downloads, stores and restores a wedding with a rule note of 10,000 characters, as long as the API takes', async () => {
    const { w, cookie } = await ownWedding()
    const r = await routes()
    const note = `${'Keep apart.\n'.repeat(833)}1234`
    expect(note).toHaveLength(10_000)
    await db.update(rules).set({ note }).where(eq(rules.id, w.ruleId))

    // The download of the wedding as it is now reads as a backup file.
    const live = await import('../backup/route')
    const res = await call(live, 'GET', { id: w.weddingId }, { cookie })
    expect(res.status).toBe(200)
    expect(backupFileSchema.parse(JSON.parse(res.text)).rules.find((x) => x.kind === 'apart')!.note).toBe(note)

    // Stored, then downloaded and restored.
    const made = await call(r.list, 'POST', { id: w.weddingId }, { cookie })
    expect(made).toMatchObject({ status: 201, body: { status: 'created' } })
    const backupId = (made.body as BackupNowReply).backup.id
    const stored = await call(r.one, 'GET', { id: w.weddingId, backupId }, { cookie })
    expect(stored.status).toBe(200)
    expect(backupFileSchema.parse(JSON.parse(stored.text)).rules.find((x) => x.kind === 'apart')!.note).toBe(note)
    const restored = await call(r.restore, 'POST', { id: w.weddingId, backupId }, { cookie, body: { jobId: randomUUID() } })
    expect(restored.status).toBe(201)
    const notes = await db.select({ note: rules.note }).from(rules).where(eq(rules.weddingId, (restored.body as RestoredBackupReply).weddingId))
    expect(notes.map((x) => x.note)).toContain(note)
  })

  it('refuses to download a wedding that does not fit the backup format, naming the field and never its value', async () => {
    const w = await wedding()
    // Longer than the API takes, written straight to the database.
    await db.update(rules).set({ note: 'n'.repeat(10_001) }).where(eq(rules.id, w.ruleId))
    const live = await import('../backup/route')
    const res = await call(live, 'GET', { id: w.weddingId }, { cookie: cookies.owner })
    expect(res).toMatchObject({
      status: 500,
      body: { error: 'unrestorable', message: 'This wedding cannot be saved as a backup file: rules.0.note is longer than 10000 characters.' },
    })
  })

  it('says plainly when backups are not set up', async () => {
    const w = await wedding()
    const r = await routes()
    try {
      vi.stubEnv('BACKUP_STORE_DIR', '')
      expect(await call(r.list, 'GET', { id: w.weddingId }, { cookie: cookies.owner })).toMatchObject({ status: 200, body: { configured: false, backups: [] } })
      expect(await call(r.list, 'POST', { id: w.weddingId }, { cookie: cookies.owner })).toMatchObject({ status: 503, body: { error: 'not_configured' } })
      expect((await call(r.one, 'GET', { id: w.weddingId, backupId: randomUUID() }, { cookie: cookies.owner })).status).toBe(503)
      expect((await call(r.restore, 'POST', { id: w.weddingId, backupId: randomUUID() }, { cookie: cookies.owner, body: { jobId: randomUUID() } })).status).toBe(503)
    } finally {
      vi.stubEnv('BACKUP_STORE_DIR', dir)
    }
  })
})
