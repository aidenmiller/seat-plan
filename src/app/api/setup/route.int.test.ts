/**
 * First-run setup against the test database: open only while SITE_PASSWORD
 * is set and no account exists, the site password and (on Vercel, previews
 * too) BOOTSTRAP_ADMIN_EMAIL checks, one winner when two people set up at once,
 * and the first admin taking over every wedding nobody owns. The wrong-guess
 * delay is switched off here.
 */
import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TEST_DATABASE_URL, makeTestDb, truncateAll } from '../../../../test/db'
import { makeUser } from '../../../../test/auth'
import { SESSION_COOKIE, SITE_COOKIE } from '@/server/auth/tokens'
import { activityEvents, users, venueTemplates, weddingMembers, weddings } from '@/server/db/schema'
import { lookupSession } from '@/server/repo/sessions'
import { makeTemplate, makeWedding } from '@/server/repo/test-fixtures'

vi.mock('@/server/auth/throttle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/auth/throttle')>()),
  wrongGuessDelay: async () => {},
}))

const SITE_PASSWORD = 'setup-int-made-up-site-password'
const { pool, db: testDb } = makeTestDb()

beforeEach(async () => {
  vi.stubEnv('AUTH_SECRET', 'setup-int-test-secret-of-32-chars-or-more')
  vi.stubEnv('SITE_PASSWORD', SITE_PASSWORD)
  vi.stubEnv('DATABASE_URL', TEST_DATABASE_URL)
  vi.stubEnv('VERCEL', '')
  vi.stubEnv('VERCEL_ENV', '')
  vi.stubEnv('BOOTSTRAP_ADMIN_EMAIL', '')
  await truncateAll(pool)
})
afterEach(() => {
  vi.unstubAllEnvs()
})
afterAll(async () => {
  await pool.end()
})

let n = 0
function ip(): string {
  n += 1
  return `203.0.113.${n}`
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    sitePassword: SITE_PASSWORD,
    email: `first-${randomUUID()}@example.com`,
    displayName: 'First Admin',
    password: 'a long first password',
    ...overrides,
  }
}

async function setup(payload: unknown, opts: { ip?: string; cookie?: string } = {}) {
  const { POST } = await import('./route')
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-real-ip': opts.ip ?? ip() }
  if (opts.cookie) headers.cookie = opts.cookie
  const res = await POST(new NextRequest('https://seat.example/api/setup', { method: 'POST', headers, body: JSON.stringify(payload) }), {
    params: Promise.resolve({}),
  })
  const text = await res.text()
  return { status: res.status, headers: res.headers, body: text ? (JSON.parse(text) as Record<string, unknown>) : null }
}

async function userCount(): Promise<number> {
  const [row] = await testDb.select({ n: sql<number>`count(*)::int` }).from(users)
  return Number(row!.n)
}

describe('POST /api/setup', () => {
  it('makes the first account an admin, signs them in, and gives them every wedding nobody owns, deleted ones too', async () => {
    const live = await makeWedding(testDb, 'Live wedding')
    const deleted = await makeWedding(testDb, 'Deleted wedding')
    await testDb.update(weddings).set({ deletedAt: new Date() }).where(eq(weddings.id, deleted))

    const input = body({ email: ' First.Admin@Example.com ', displayName: '  Ada  ' })
    // A browser still holding the old site-password cookie: it is cleared.
    const res = await setup(input, { cookie: `${SITE_COOKIE}=left-over-site-cookie` })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, redirect: '/' })
    expect(res.headers.get('cache-control')).toBe('no-store')

    const [admin] = await testDb.select().from(users)
    expect(admin).toMatchObject({ email: 'first.admin@example.com', displayName: 'Ada', isAdmin: true, disabledAt: null })
    expect(admin!.passwordHash).toMatch(/^\$argon2id\$/)
    expect(JSON.stringify(res.body)).not.toContain(admin!.passwordHash)

    const cookie = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`))!
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/Secure/i)
    expect(cookie).toMatch(/SameSite=lax/i)
    expect(await lookupSession(testDb, cookie.slice(SESSION_COOKIE.length + 1, cookie.indexOf(';')))).toMatchObject({ id: admin!.id, isAdmin: true })
    expect(res.headers.getSetCookie().find((c) => c.startsWith(`${SITE_COOKIE}=`))).toMatch(/Max-Age=0/)

    const owned = await testDb.select().from(weddingMembers)
    expect(owned.map((m) => [m.weddingId, m.userId, m.role]).sort()).toEqual(
      [
        [live, admin!.id, 'owner'],
        [deleted, admin!.id, 'owner'],
      ].sort(),
    )
    const [event] = await testDb.select().from(activityEvents).where(eq(activityEvents.kind, 'setup_completed'))
    expect(event).toMatchObject({ userId: admin!.id, detail: { weddingsClaimed: 2, venuesClaimed: 0 } })
    expect(JSON.stringify(event!.detail)).not.toContain(SITE_PASSWORD)

    // Setup is now closed for good.
    expect((await setup(body())).status).toBe(404)
    expect(await userCount()).toBe(1)
  })

  it('gives the first admin every live venue made before accounts, and leaves library and deleted venues alone', async () => {
    const mine = await makeTemplate(testDb, 'Old hall')
    const other = await makeTemplate(testDb, 'Old barn')
    const library = await makeTemplate(testDb, 'Library hall')
    await testDb.update(venueTemplates).set({ isLibrary: true }).where(eq(venueTemplates.id, library))
    const deleted = await makeTemplate(testDb, 'Deleted hall')
    await testDb.update(venueTemplates).set({ deletedAt: new Date() }).where(eq(venueTemplates.id, deleted))

    expect((await setup(body())).status).toBe(200)
    const [admin] = await testDb.select().from(users)
    const owners = Object.fromEntries((await testDb.select().from(venueTemplates)).map((t) => [t.id, t.ownerUserId]))
    expect(owners[mine]).toBe(admin!.id)
    expect(owners[other]).toBe(admin!.id)
    expect(owners[library]).toBeNull()
    expect(owners[deleted]).toBeNull()
    const [claimedEvent] = await testDb.select().from(activityEvents).where(eq(activityEvents.kind, 'setup_completed'))
    expect(claimedEvent!.detail).toMatchObject({ venuesClaimed: 2 })
  })

  it('answers 404 once any account exists, whatever it is sent', async () => {
    await makeUser(testDb)
    for (const payload of [body(), body({ sitePassword: 'wrong' }), {}]) {
      const res = await setup(payload)
      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: 'not_found' })
    }
    expect(await userCount()).toBe(1)
  })

  it('answers 404 when SITE_PASSWORD is not set', async () => {
    vi.stubEnv('SITE_PASSWORD', '')
    expect((await setup(body({ sitePassword: '' }))).status).toBe(404)
    expect(await userCount()).toBe(0)
  })

  it('refuses a wrong site password with 401, and slows a guesser down', async () => {
    const address = ip()
    const wrong = await setup(body({ sitePassword: 'not the site password' }), { ip: address })
    expect(wrong).toMatchObject({ status: 401, body: { error: 'wrong_password' } })
    expect(wrong.headers.getSetCookie()).toEqual([])
    for (let i = 0; i < 9; i++) expect((await setup(body({ sitePassword: `guess ${i}` }), { ip: address })).status).toBe(401)
    const blocked = await setup(body(), { ip: address })
    expect(blocked.status).toBe(429)
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(await userCount()).toBe(0)
    expect((await setup(body(), { ip: ip() })).status).toBe(200)
  })

  it('checks the new account’s details', async () => {
    expect((await setup(body({ password: 'short' }))).status).toBe(422)
    expect((await setup(body({ email: 'not an email' }))).status).toBe(422)
    expect((await setup(body({ displayName: '   ' }))).status).toBe(422)
    expect((await setup(body({ displayName: 'x'.repeat(61) }))).status).toBe(422)
    expect(await userCount()).toBe(0)
  })

  describe('on Vercel', () => {
    beforeEach(() => {
      vi.stubEnv('VERCEL', '1')
      vi.stubEnv('VERCEL_ENV', 'production')
    })

    it('asks for BOOTSTRAP_ADMIN_EMAIL on a preview deployment too, so one pointed at an empty database cannot be claimed', async () => {
      vi.stubEnv('VERCEL_ENV', 'preview')
      expect(await setup(body())).toMatchObject({ status: 403, body: { error: 'bootstrap_email_missing' } })
      vi.stubEnv('BOOTSTRAP_ADMIN_EMAIL', 'the-owner@example.com')
      expect(await setup(body({ email: 'someone-else@example.com' }))).toMatchObject({ status: 403, body: { error: 'bootstrap_email_mismatch' } })
      expect(await userCount()).toBe(0)
    })

    it('refuses without BOOTSTRAP_ADMIN_EMAIL, saying how to fix it', async () => {
      const res = await setup(body())
      expect(res.status).toBe(403)
      expect(res.body).toMatchObject({ error: 'bootstrap_email_missing', message: expect.stringContaining('BOOTSTRAP_ADMIN_EMAIL') })
      expect(await userCount()).toBe(0)
    })

    it('refuses any other email without naming the expected one', async () => {
      vi.stubEnv('BOOTSTRAP_ADMIN_EMAIL', 'the-owner@example.com')
      const res = await setup(body({ email: 'someone-else@example.com' }))
      expect(res.status).toBe(403)
      expect(res.body).toMatchObject({ error: 'bootstrap_email_mismatch' })
      expect(JSON.stringify(res.body)).not.toContain('the-owner')
      expect(await userCount()).toBe(0)
    })

    it('checks the site password before the email, so the email cannot be guessed without it', async () => {
      vi.stubEnv('BOOTSTRAP_ADMIN_EMAIL', 'the-owner@example.com')
      expect((await setup(body({ email: 'someone-else@example.com', sitePassword: 'wrong' }))).status).toBe(401)
      expect((await setup(body({ email: 'the-owner@example.com', sitePassword: 'wrong' }))).status).toBe(401)
    })

    it('accepts the expected email, however it is typed', async () => {
      vi.stubEnv('BOOTSTRAP_ADMIN_EMAIL', ' The-Owner@Example.com ')
      const res = await setup(body({ email: 'THE-OWNER@example.com' }))
      expect(res.status).toBe(200)
      const [admin] = await testDb.select().from(users)
      expect(admin).toMatchObject({ email: 'the-owner@example.com', isAdmin: true })
    })
  })

  it('lets exactly one of two setups at once win', async () => {
    await makeWedding(testDb, 'Shared wedding')
    const results = await Promise.all([setup(body({ email: 'one@example.com' })), setup(body({ email: 'two@example.com' }))])
    expect(results.map((r) => r.status).sort()).toEqual([200, 404])
    expect(await userCount()).toBe(1)
    const [admin] = await testDb.select().from(users)
    const winner = results.find((r) => r.status === 200)!
    expect(winner.headers.getSetCookie().some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(true)
    expect(results.find((r) => r.status === 404)!.headers.getSetCookie()).toEqual([])
    const owners = await testDb.select().from(weddingMembers)
    expect(owners.map((m) => m.userId)).toEqual([admin!.id])
  })
})
