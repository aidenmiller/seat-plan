/**
 * The login route against the test database: right, wrong, blocked and
 * malformed requests. The wrong-guess delay is switched off here.
 */
import { sql } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TEST_DATABASE_URL } from '../../../../../test/db'

vi.mock('@/server/auth/throttle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/auth/throttle')>()),
  wrongGuessDelay: async () => {},
}))

const PASSWORD = 'route-test-made-up-password'

beforeAll(() => {
  vi.stubEnv('AUTH_SECRET', 'route-int-test-secret-of-32-chars-or-more')
  vi.stubEnv('SITE_PASSWORD', PASSWORD)
  vi.stubEnv('DATABASE_URL', TEST_DATABASE_URL)
})
afterAll(() => {
  vi.unstubAllEnvs()
})

async function db() {
  return (await import('@/server/db/client')).getDb()
}

beforeEach(async () => {
  await (await db()).execute(sql`delete from login_attempts`)
})

async function login(body: unknown, ip: string) {
  const { POST } = await import('./route')
  return POST(
    new NextRequest('https://seat.example/api/auth/login', {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
      headers: { 'content-type': 'application/json', 'x-real-ip': ip },
    }),
  )
}

describe('POST /api/auth/login', () => {
  it('sets a Secure, HttpOnly, Lax site cookie for the right password and clears the count', async () => {
    await login({ password: 'wrong' }, '203.0.113.1')
    const res = await login({ password: PASSWORD, next: '/w/abc' }, '203.0.113.1')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, redirect: '/w/abc' })
    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toMatch(/^sp_site=/)
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/Secure/i)
    expect(cookie).toMatch(/SameSite=lax/i)
    expect(cookie).toMatch(/Max-Age=2592000/)
    const rows = await (await db()).execute(sql`select 1 from login_attempts where ip_key <> '*'`)
    expect(rows.rows).toHaveLength(0)
  })

  it('answers 401 with no cookie for a wrong password', async () => {
    const res = await login({ password: 'wrong' }, '203.0.113.2')
    expect(res.status).toBe(401)
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('blocks after 10 tries, even for the right password, with Retry-After and no cookie', async () => {
    for (let i = 0; i < 10; i++) expect((await login({ password: 'wrong' }, '203.0.113.3')).status).toBe(401)
    const res = await login({ password: PASSWORD }, '203.0.113.3')
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(await res.json()).toMatchObject({ error: 'too_many_attempts' })
    // Another address still gets in.
    expect((await login({ password: PASSWORD }, '203.0.113.4')).status).toBe(200)
  })

  it('answers 400 to a malformed body without counting it', async () => {
    expect((await login('not json', '203.0.113.5')).status).toBe(400)
    expect((await login({ pass: 'x' }, '203.0.113.5')).status).toBe(400)
    const rows = await (await db()).execute(sql`select 1 from login_attempts`)
    expect(rows.rows).toHaveLength(0)
  })

  it('never redirects off the site', async () => {
    const res = await login({ password: PASSWORD, next: '//evil.example' }, '203.0.113.6')
    expect(await res.json()).toEqual({ ok: true, redirect: '/' })
  })
})
