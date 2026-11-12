/**
 * The admin's backup routes: the overview (every backup, deleted weddings'
 * too, runs with their failures, storage, the last good nightly run), Run
 * now, and downloading or restoring any backup. Admins only: 404 to anyone
 * else, as a route that does not exist.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { TEST_DATABASE_URL, makeTestDb, truncateAll } from '../../../../../test/db'
import { makeUser, sessionCookie, type TestUser } from '../../../../../test/auth'
import { backupFileSchema } from '@/domain/backup/schema'
import type { AdminBackupsReply, RestoredBackupReply, RunBackupsReply } from '@/shared/backups-api'
import { activityEvents, backupRuns, weddingMembers, weddings } from '@/server/db/schema'
import { makeBackupWedding } from '@/server/backups/test-wedding'

const { pool, db } = makeTestDb()
const dir = mkdtempSync(path.join(os.tmpdir(), 'admin-backups-'))
let owner: TestUser
let admin: TestUser
const cookies = { owner: '', admin: '' }

beforeAll(async () => {
  vi.stubEnv('AUTH_SECRET', 'admin-backups-int-test-secret-32-chars-x')
  vi.stubEnv('DATABASE_URL', TEST_DATABASE_URL)
  vi.stubEnv('BACKUP_STORE_DIR', dir)
  // Run now backs up every wedding in the database: start from none.
  await truncateAll(pool)
  owner = await makeUser(db, { displayName: 'Olive' })
  admin = await makeUser(db, { displayName: 'Root', isAdmin: true })
  cookies.owner = await sessionCookie(db, owner.id)
  cookies.admin = await sessionCookie(db, admin.id)
}, 120_000)
afterAll(async () => {
  vi.unstubAllEnvs()
  await pool.end()
  rmSync(dir, { recursive: true, force: true })
})

const routes = async () => ({
  overview: await import('./route'),
  run: await import('./run/route'),
  one: await import('./[backupId]/route'),
  restore: await import('./[backupId]/restore/route'),
})

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>
async function call(mod: Record<string, unknown>, method: string, params: Record<string, string>, cookie: string, body?: unknown) {
  const headers: Record<string, string> = { cookie }
  if (body !== undefined) headers['content-type'] = 'application/json'
  const res = await (mod[method] as Handler)(
    new NextRequest('https://seat.example/api/admin/backups', { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    { params: Promise.resolve(params) },
  )
  const text = await res.text()
  let parsed: unknown = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = null
  }
  return { status: res.status, text, body: parsed }
}

describe('the admin’s backup routes', () => {
  it('answer 404 to anyone but an admin, an owner included', async () => {
    const r = await routes()
    const backupId = randomUUID()
    for (const [mod, method, params, body] of [
      [r.overview, 'GET', {}, undefined],
      [r.run, 'POST', {}, undefined],
      [r.one, 'GET', { backupId }, undefined],
      [r.restore, 'POST', { backupId }, { jobId: randomUUID() }],
    ] as const) {
      expect(await call(mod, method, params, cookies.owner, body)).toMatchObject({ status: 404, body: { error: 'not_found' } })
    }
    expect(await db.select().from(backupRuns)).toEqual([])
  })

  it('run every wedding now, and show every backup, a deleted wedding’s too, with runs, failures and storage', async () => {
    const r = await routes()
    const live = await makeBackupWedding(db, owner.id)
    const gone = await makeBackupWedding(db, owner.id)
    await db.update(weddings).set({ deletedAt: new Date() }).where(eq(weddings.id, gone.weddingId))

    const ran = await call(r.run, 'POST', {}, cookies.admin)
    expect(ran.status).toBe(200)
    const summary = ran.body as RunBackupsReply
    expect(summary).toMatchObject({ status: 'ok', backedUp: 2, failed: 0, failures: [], error: null, runId: expect.any(String) })
    const [event] = await db.select().from(activityEvents).where(and(eq(activityEvents.kind, 'backup_run'), eq(activityEvents.userId, admin.id)))
    expect(event).toMatchObject({ subjectId: summary.runId, detail: { status: 'ok', backedUp: 2 } })

    const overview = (await call(r.overview, 'GET', {}, cookies.admin)).body as AdminBackupsReply
    expect(overview).toMatchObject({ configured: true, storeKind: 'filesystem', totalBackups: 2, uploadsLast30Days: 3, uploadLimit30Days: 1500 })
    const byWedding = Object.fromEntries(overview.backups.map((b) => [b.weddingId, b]))
    expect(byWedding[live.weddingId]).toMatchObject({ kind: 'nightly', weddingState: 'live', inThisStore: true })
    expect(byWedding[gone.weddingId]).toMatchObject({ kind: 'final', weddingState: 'deleted', inThisStore: true })
    expect(overview.runs[0]).toMatchObject({ id: summary.runId, trigger: 'admin', startedByName: 'Root', status: 'ok', backedUp: 2 })
    expect(overview.storage.backupCount).toBe(2)
    expect(overview.storage.imageCount).toBe(1)
    expect(overview.storage.totalBytes).toBe(overview.storage.backupBytes + overview.storage.imageBytes)
    // No cron run yet.
    expect(overview.lastSuccessfulCronRunAt).toBeNull()
    expect(overview.lastCronRun).toBeNull()

    // A failed cron run and a good one, with the failure named by wedding.
    const failedAt = new Date(Date.now() - 2 * 86_400_000)
    const okAt = new Date(Date.now() - 86_400_000)
    await db.insert(backupRuns).values([
      { trigger: 'cron', status: 'ok', startedAt: okAt, heartbeatAt: okAt, finishedAt: okAt },
      { trigger: 'cron', status: 'partial', startedAt: new Date(), finishedAt: new Date(), failed: 1, failures: [{ weddingId: live.weddingId, message: 'Vercel Blob upload failed' }] },
      { trigger: 'cron', status: 'failed', startedAt: failedAt, heartbeatAt: failedAt, finishedAt: failedAt, error: 'Timed out' },
    ])
    const later = (await call(r.overview, 'GET', {}, cookies.admin)).body as AdminBackupsReply
    expect(later.lastSuccessfulCronRunAt).toBe(okAt.toISOString())
    expect(later.lastCronRun).toMatchObject({ status: 'partial' })
    expect(later.runs[0]!.failures).toEqual([{ weddingId: live.weddingId, weddingName: expect.stringMatching(/^Backup wedding/), message: 'Vercel Blob upload failed' }])

    // While a run is going, Run now answers 409.
    const [alive] = await db.insert(backupRuns).values({ trigger: 'cron' }).returning({ id: backupRuns.id })
    expect(await call(r.run, 'POST', {}, cookies.admin)).toMatchObject({ status: 409, body: { error: 'busy' } })
    await db.update(backupRuns).set({ status: 'ok', finishedAt: new Date() }).where(eq(backupRuns.id, alive!.id))
  })

  it('download and restore any backup, a deleted wedding’s final one included', async () => {
    const r = await routes()
    const w = await makeBackupWedding(db, owner.id)
    await call(r.run, 'POST', {}, cookies.admin)
    await db.update(weddings).set({ deletedAt: new Date() }).where(eq(weddings.id, w.weddingId))
    await call(r.run, 'POST', {}, cookies.admin)
    const overview = (await call(r.overview, 'GET', {}, cookies.admin)).body as AdminBackupsReply
    const final = overview.backups.find((b) => b.weddingId === w.weddingId && b.kind === 'final')!
    expect(final).toMatchObject({ weddingState: 'deleted' })

    const download = await call(r.one, 'GET', { backupId: final.id }, cookies.admin)
    expect(download.status).toBe(200)
    expect(backupFileSchema.parse(JSON.parse(download.text)).guests).toHaveLength(4)
    expect((await call(r.one, 'GET', { backupId: randomUUID() }, cookies.admin)).status).toBe(404)

    const jobId = randomUUID()
    const restored = await call(r.restore, 'POST', { backupId: final.id }, cookies.admin, { jobId })
    expect(restored.status).toBe(201)
    const reply = restored.body as RestoredBackupReply
    // The source wedding is deleted, so only the admin owns the copy.
    expect(reply.ownersAdded).toBe(0)
    expect(await db.select({ userId: weddingMembers.userId }).from(weddingMembers).where(eq(weddingMembers.weddingId, reply.weddingId))).toEqual([{ userId: admin.id }])
    expect((await call(r.restore, 'POST', { backupId: final.id }, cookies.admin, { jobId })).status).toBe(200)
    expect((await call(r.restore, 'POST', { backupId: final.id }, cookies.admin, { jobId: 'x' })).status).toBe(422)
  })

  it('say when backups are not set up', async () => {
    const r = await routes()
    try {
      vi.stubEnv('BACKUP_STORE_DIR', '')
      expect(await call(r.overview, 'GET', {}, cookies.admin)).toMatchObject({ status: 200, body: { configured: false, storeKind: null, storage: { totalBytes: 0 } } })
      expect((await call(r.run, 'POST', {}, cookies.admin)).status).toBe(503)
      expect((await call(r.one, 'GET', { backupId: randomUUID() }, cookies.admin)).status).toBe(503)
    } finally {
      vi.stubEnv('BACKUP_STORE_DIR', dir)
    }
  })
})
