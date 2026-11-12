/**
 * GET and POST /api/cron/backups: only "Authorization: Bearer <CRON_SECRET>"
 * gets in, with a CRON_SECRET of at least 32 characters; a session cookie,
 * even an admin's, never does. Past that, the nightly run.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { desc, eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { TEST_DATABASE_URL, makeTestDb, truncateAll } from '../../../../../test/db'
import { makeUser, sessionCookie } from '../../../../../test/auth'
import { backupRuns, backups, guests } from '@/server/db/schema'
import { makeBackupWedding } from '@/server/backups/test-wedding'
import { cronSecretMatches } from '@/server/auth/guards'
import { GET, POST } from './route'

/** The cron waits up to 2 minutes for a run holding the lease; here, a second. */
const WAIT_MS = 1000
vi.mock('@/server/backups/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/backups/http')>()),
  CRON_LEASE_WAIT_MS: 1000,
  CRON_LEASE_POLL_MS: 50,
}))

const SECRET = 'Cr0nSecretForTheIntegrationTest0123456789'
const { pool, db } = makeTestDb()
const dir = mkdtempSync(path.join(os.tmpdir(), 'cron-backups-'))

beforeAll(async () => {
  vi.stubEnv('AUTH_SECRET', 'cron-int-test-secret-of-at-least-32-chars')
  vi.stubEnv('DATABASE_URL', TEST_DATABASE_URL)
  vi.stubEnv('CRON_SECRET', SECRET)
  vi.stubEnv('BACKUP_STORE_DIR', dir)
  // A run backs up every wedding in the database: start from none.
  await truncateAll(pool)
}, 120_000)
afterAll(async () => {
  vi.unstubAllEnvs()
  await pool.end()
  rmSync(dir, { recursive: true, force: true })
})

async function call(method: 'GET' | 'POST', headers: Record<string, string> = {}) {
  const handler = method === 'GET' ? GET : POST
  const res = await handler(new NextRequest('https://seat.example/api/cron/backups', { method, headers }), { params: Promise.resolve({}) })
  const text = await res.text()
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null }
}

const bearer = (secret: string) => ({ authorization: `Bearer ${secret}` })

describe('cronSecretMatches', () => {
  it('takes exactly "Bearer <secret>", and nothing when the secret is unset or short', () => {
    expect(cronSecretMatches(`Bearer ${SECRET}`, SECRET)).toBe(true)
    for (const header of [null, '', SECRET, `bearer ${SECRET}`, `Bearer  ${SECRET}`, `Bearer ${SECRET} `, `Bearer ${SECRET.toLowerCase()}`, `Bearer ${SECRET.slice(0, -1)}`, `Bearer ${SECRET}x`, 'Bearer ', 'Bearer undefined']) {
      expect(cronSecretMatches(header, SECRET), String(header)).toBe(false)
    }
    expect(cronSecretMatches('Bearer ', '')).toBe(false)
    expect(cronSecretMatches('Bearer undefined', undefined)).toBe(false)
    const short = 'a'.repeat(31)
    expect(cronSecretMatches(`Bearer ${short}`, short)).toBe(false)
    expect(cronSecretMatches(`Bearer ${'a'.repeat(32)}`, 'a'.repeat(32))).toBe(true)
  })
})

describe('/api/cron/backups', () => {
  it('answers 401 without the bearer secret, a session cookie included, and runs nothing', async () => {
    await makeBackupWedding(db, null)
    const admin = await makeUser(db, { isAdmin: true })
    const cookie = await sessionCookie(db, admin.id)
    for (const method of ['GET', 'POST'] as const) {
      for (const headers of [
        {},
        { cookie },
        bearer('wrong-secret-of-a-good-length-0123456789'),
        { ...bearer('wrong-secret-of-a-good-length-0123456789'), cookie },
        { authorization: SECRET },
        { authorization: `Basic ${Buffer.from(`user:${SECRET}`).toString('base64')}` },
      ] as Record<string, string>[]) {
        expect(await call(method, headers), `${method} ${Object.keys(headers).join('+')}`).toEqual({ status: 401, body: { error: 'unauthorized' } })
      }
    }
    expect(await db.select().from(backupRuns)).toEqual([])
    expect(await db.select().from(backups)).toEqual([])
  })

  it('answers 401 to everything while CRON_SECRET is unset or shorter than 32 characters', async () => {
    try {
      vi.stubEnv('CRON_SECRET', '')
      expect((await call('GET', { authorization: 'Bearer ' })).status).toBe(401)
      expect((await call('GET', { authorization: 'Bearer undefined' })).status).toBe(401)
      vi.stubEnv('CRON_SECRET', 'short-secret-31-characters-long')
      expect('short-secret-31-characters-long').toHaveLength(31)
      expect((await call('POST', bearer('short-secret-31-characters-long'))).status).toBe(401)
    } finally {
      vi.stubEnv('CRON_SECRET', SECRET)
    }
    expect(await db.select().from(backupRuns)).toEqual([])
  })

  it('runs the nightly backup with the secret, by GET or POST, replying with counts only', async () => {
    const first = await call('GET', bearer(SECRET))
    expect(first).toEqual({ status: 200, body: { status: 'ok', backedUp: 1, unchanged: 0, failed: 0, skipped: 0, remaining: 0, pruned: 0 } })
    const second = await call('POST', bearer(SECRET))
    expect(second).toEqual({ status: 200, body: { status: 'ok', backedUp: 0, unchanged: 1, failed: 0, skipped: 0, remaining: 0, pruned: 0 } })
    const runs = await db.select({ trigger: backupRuns.trigger, status: backupRuns.status }).from(backupRuns)
    expect(runs).toEqual([
      { trigger: 'cron', status: 'ok' },
      { trigger: 'cron', status: 'ok' },
    ])
  })

  it('waits for a run that holds the lease and then runs; or, if it is still going, answers 409 and records the night as failed', async () => {
    // An admin's Run now that finishes while the nightly call waits: the nightly run goes ahead.
    const [admin] = await db.insert(backupRuns).values({ trigger: 'admin' }).returning({ id: backupRuns.id })
    setTimeout(() => void db.update(backupRuns).set({ status: 'ok', finishedAt: new Date() }).where(eq(backupRuns.id, admin!.id)).execute(), 300)
    const waited = await call('GET', bearer(SECRET))
    expect(waited).toEqual({ status: 200, body: { status: 'ok', backedUp: 0, unchanged: 1, failed: 0, skipped: 0, remaining: 0, pruned: 0 } })

    // A nightly run (a second delivery of the call, or one stuck) still going when the wait is over: 409, nothing
    // backed up, and a failed nightly run on record, so the admin page's warning shows.
    const [alive] = await db.insert(backupRuns).values({ trigger: 'cron' }).returning({ id: backupRuns.id })
    const started = Date.now()
    expect(await call('GET', bearer(SECRET))).toMatchObject({ status: 409, body: { status: 'busy', backedUp: 0 } })
    expect(Date.now() - started).toBeGreaterThanOrEqual(WAIT_MS - 100)
    await db.update(backupRuns).set({ status: 'ok', finishedAt: new Date() }).where(eq(backupRuns.id, alive!.id))
    const [recorded] = await db.select().from(backupRuns).where(eq(backupRuns.status, 'failed')).orderBy(desc(backupRuns.startedAt)).limit(1)
    expect(recorded).toMatchObject({ trigger: 'cron', error: expect.stringMatching(/^Did not run: another nightly run, started .* UTC, was still going/) })
  })

  it('answers 500 when a wedding fails', async () => {
    // A wedding whose backup cannot be written: the store folder is a file.
    const w = await makeBackupWedding(db, null)
    await db.update(guests).set({ notes: 'x' }).where(eq(guests.id, w.guestIds.ann))
    const file = path.join(dir, 'not-a-folder')
    writeFileSync(file, 'x')
    try {
      vi.stubEnv('BACKUP_STORE_DIR', file)
      const res = await call('GET', bearer(SECRET))
      expect(res.status).toBe(500)
      expect(res.body).toMatchObject({ failed: 2 })
      expect(JSON.stringify(res.body)).not.toContain(w.weddingId)
    } finally {
      vi.stubEnv('BACKUP_STORE_DIR', dir)
    }
  })

  it('answers 503 when this deployment has no backup store', async () => {
    try {
      vi.stubEnv('BACKUP_STORE_DIR', '')
      expect(await call('GET', bearer(SECRET))).toMatchObject({ status: 503, body: { error: 'not_configured' } })
      // A preview deployment never uses a store, even one given a folder.
      vi.stubEnv('BACKUP_STORE_DIR', dir)
      vi.stubEnv('VERCEL_ENV', 'preview')
      expect((await call('POST', bearer(SECRET))).status).toBe(503)
    } finally {
      vi.stubEnv('BACKUP_STORE_DIR', dir)
      vi.stubEnv('VERCEL_ENV', '')
    }
  })
})
