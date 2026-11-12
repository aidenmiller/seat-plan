/**
 * Signing in with an email and password, against the test database: the one
 * answer for every failure, the per-account and per-address limits, a fresh
 * session every time (the old one ends), and the cookies. The wrong-guess
 * delay is switched off here.
 */
import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TEST_DATABASE_URL } from '../../../../../test/db'
import { makeUser, sessionCookie, type TestUser } from '../../../../../test/auth'
import { legacySiteCookieValue } from '../../../../../test/legacy-site-cookie'
import { PASSWORD_MAX } from '@/domain/accounts'
import { verifyUserPassword } from '@/server/auth/passwords'
import { SCOPE_LIMIT } from '@/server/auth/throttle'
import { SESSION_COOKIE, SITE_COOKIE, openSessionCookie } from '@/server/auth/tokens'
import { activityEvents } from '@/server/db/schema'
import { lookupSession } from '@/server/repo/sessions'

vi.mock('@/server/auth/throttle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/auth/throttle')>()),
  wrongGuessDelay: async () => {},
}))
vi.mock('@/server/auth/passwords', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/server/auth/passwords')>()
  return { ...real, verifyUserPassword: vi.fn(real.verifyUserPassword) }
})

beforeAll(() => {
  vi.stubEnv('AUTH_SECRET', 'route-int-test-secret-of-32-chars-or-more')
  vi.stubEnv('SITE_PASSWORD', 'route-int-made-up-site-password')
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
  vi.mocked(verifyUserPassword).mockClear()
})

let n = 0
/** A made-up address no other test uses. */
function ip(): string {
  n += 1
  return `198.51.${Math.floor(n / 250)}.${(n % 250) + 1}`
}

async function login(body: unknown, opts: { ip: string; cookie?: string; contentType?: string | null }) {
  const { POST } = await import('./route')
  const headers: Record<string, string> = { 'x-real-ip': opts.ip, 'user-agent': 'vitest browser' }
  if (opts.contentType !== null) headers['content-type'] = opts.contentType ?? 'application/json'
  if (opts.cookie) headers.cookie = opts.cookie
  const res = await POST(
    new NextRequest('https://seat.example/api/auth/login', {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
      headers,
    }),
    { params: Promise.resolve({}) },
  )
  const text = await res.text()
  return { status: res.status, headers: res.headers, body: text ? (JSON.parse(text) as unknown) : null }
}

/** The session cookie a reply set: its value and the whole Set-Cookie line. */
function sessionSet(res: { headers: Headers }): { value: string; raw: string } | null {
  const raw = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`))
  if (!raw) return null
  return { value: raw.slice(SESSION_COOKIE.length + 1, raw.indexOf(';')), raw }
}

const WRONG = { status: 401, body: { error: 'wrong_credentials' } }

describe('POST /api/auth/login', () => {
  let pat: TestUser
  beforeAll(async () => {
    pat = await makeUser(await db(), { email: `pat-${randomUUID()}@example.com`, displayName: 'Pat' })
  })

  it('signs in with the right email and password: a Secure, HttpOnly, Lax session cookie for 30 days, and a login event', async () => {
    const address = ip()
    await login({ email: pat.email, password: 'wrong password' }, { ip: address })
    const res = await login({ email: ` ${pat.email.toUpperCase()} `, password: pat.password, next: '/w/abc' }, { ip: address })
    expect(res.status).toBe(200)
    // The user's id, so the sign-in form can tell this browser's other tabs who signed in.
    expect(res.body).toEqual({ ok: true, redirect: '/w/abc', userId: pat.id })
    expect(res.headers.get('cache-control')).toBe('no-store')
    const cookie = sessionSet(res)!
    expect(cookie.raw).toMatch(/HttpOnly/i)
    expect(cookie.raw).toMatch(/Secure/i)
    expect(cookie.raw).toMatch(/SameSite=lax/i)
    expect(cookie.raw).toMatch(/Path=\//)
    const maxAge = Number(/Max-Age=(\d+)/.exec(cookie.raw)![1])
    expect(maxAge).toBeGreaterThan(30 * 86_400 - 120)
    expect(maxAge).toBeLessThanOrEqual(30 * 86_400)
    expect(await lookupSession(await db(), cookie.value)).toMatchObject({ id: pat.id, email: pat.email })
    // A right password clears this address's counts.
    const rows = await (await db()).execute(sql`select scope from login_attempts where ip_key <> '*'`)
    expect(rows.rows).toEqual([])
    const events = await (await db())
      .select({ kind: activityEvents.kind })
      .from(activityEvents)
      .where(and(eq(activityEvents.userId, pat.id), eq(activityEvents.kind, 'login')))
    expect(events.length).toBeGreaterThan(0)
  })

  it('gives one answer for a wrong password, an unknown email, and a disabled account, checking a password every time', async () => {
    const disabled = await makeUser(await db(), { disabled: true })
    const tries = [
      { email: pat.email, password: 'not the password', known: true },
      { email: `nobody-${randomUUID()}@example.com`, password: pat.password, known: false },
      { email: disabled.email, password: disabled.password, known: true },
      { email: disabled.email, password: 'not the password', known: true },
    ]
    for (const { known, ...body } of tries) {
      vi.mocked(verifyUserPassword).mockClear()
      const res = await login(body, { ip: ip() })
      expect({ status: res.status, body: res.body }, body.email).toEqual(WRONG)
      expect(res.headers.getSetCookie(), body.email).toEqual([])
      // The unknown email runs the check against the dummy hash; the disabled account is refused only after its check.
      expect(vi.mocked(verifyUserPassword), body.email).toHaveBeenCalledTimes(1)
      const [hash, password] = vi.mocked(verifyUserPassword).mock.calls[0]!
      expect(hash === null, body.email).toBe(!known)
      expect(password).toBe(body.password)
    }
  })

  it('limits tries per address across every account, before any password work', async () => {
    const address = ip()
    for (let i = 0; i < 10; i++) {
      expect((await login({ email: `guess-${i}-${randomUUID()}@example.com`, password: 'guess' }, { ip: address })).status).toBe(401)
    }
    vi.mocked(verifyUserPassword).mockClear()
    const blocked = await login({ email: pat.email, password: pat.password }, { ip: address })
    expect(blocked.status).toBe(429)
    expect(blocked.body).toMatchObject({ error: 'too_many_attempts' })
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(sessionSet(blocked)).toBeNull()
    expect(vi.mocked(verifyUserPassword)).not.toHaveBeenCalled()
    // Another address still gets in.
    expect((await login({ email: pat.email, password: pat.password }, { ip: ip() })).status).toBe(200)
  })

  it(`limits tries per account across every address (${SCOPE_LIMIT} an hour), leaving other accounts alone`, async () => {
    const target = await makeUser(await db())
    const other = await makeUser(await db())
    for (let i = 0; i < SCOPE_LIMIT; i++) {
      expect((await login({ email: target.email, password: `guess ${i}` }, { ip: ip() })).status).toBe(401)
    }
    vi.mocked(verifyUserPassword).mockClear()
    const blocked = await login({ email: target.email.toUpperCase(), password: target.password }, { ip: ip() })
    expect(blocked.status).toBe(429)
    expect(vi.mocked(verifyUserPassword)).not.toHaveBeenCalled()
    expect((await login({ email: other.email, password: other.password }, { ip: ip() })).status).toBe(200)
    // The table keys the account by a keyed hash, never by its email.
    const scopes = await (await db()).execute<{ scope: string }>(sql`select distinct scope from login_attempts`)
    expect(scopes.rows.map((r) => r.scope).join(' ')).not.toContain(target.email.split('@')[0]!)
  }, 120_000)

  it('ends the session the browser held before, whoever’s it was, and never reuses its cookie', async () => {
    const sam = await makeUser(await db())
    const before = (await sessionCookie(await db(), pat.id)).slice(SESSION_COOKIE.length + 1)
    const res = await login({ email: sam.email, password: sam.password }, { ip: ip(), cookie: `${SESSION_COOKIE}=${before}` })
    expect(res.status).toBe(200)
    const after = sessionSet(res)!.value
    expect(after).not.toBe(before)
    expect(openSessionCookie(after)!.secret).not.toBe(openSessionCookie(before)!.secret)
    expect(await lookupSession(await db(), before)).toBeNull()
    expect(await lookupSession(await db(), after)).toMatchObject({ id: sam.id })

    // Signing in again as the same person replaces the session too.
    const again = await login({ email: sam.email, password: sam.password }, { ip: ip(), cookie: `${SESSION_COOKIE}=${after}` })
    expect(await lookupSession(await db(), after)).toBeNull()
    expect(await lookupSession(await db(), sessionSet(again)!.value)).toMatchObject({ id: sam.id })
  })

  it('makes its own session whatever cookie comes in (no fixation)', async () => {
    const forged = `${SESSION_COOKIE}=${Buffer.from(JSON.stringify({ typ: 'user', s: 'A'.repeat(43), exp: Date.now() + 1e9 })).toString('base64url')}.AAAA`
    const res = await login({ email: pat.email, password: pat.password }, { ip: ip(), cookie: forged })
    expect(res.status).toBe(200)
    expect(openSessionCookie(sessionSet(res)!.value)!.secret).not.toBe('A'.repeat(43))
  })

  it('clears a cookie left from the site password', async () => {
    const res = await login({ email: pat.email, password: pat.password }, { ip: ip(), cookie: `${SITE_COOKIE}=${legacySiteCookieValue()}` })
    expect(res.status).toBe(200)
    const cleared = res.headers.getSetCookie().find((c) => c.startsWith(`${SITE_COOKIE}=`))
    expect(cleared).toMatch(new RegExp(`^${SITE_COOKIE}=;`))
    expect(cleared).toMatch(/Max-Age=0/)
    expect(sessionSet(res)).not.toBeNull()
  })

  it('refuses a body that is not JSON, or does not fit, without counting it', async () => {
    const address = ip()
    expect((await login({ email: pat.email, password: pat.password }, { ip: address, contentType: 'text/plain' })).status).toBe(415)
    expect((await login({ email: pat.email, password: pat.password }, { ip: address, contentType: null })).status).toBe(415)
    expect((await login('not json', { ip: address })).status).toBe(400)
    expect((await login({ password: pat.password }, { ip: address })).status).toBe(422)
    expect((await login({ email: 'not an email', password: pat.password }, { ip: address })).status).toBe(422)
    expect((await login({ email: pat.email, password: '' }, { ip: address })).status).toBe(422)
    expect((await login({ email: pat.email, password: 'x'.repeat(PASSWORD_MAX + 1) }, { ip: address })).status).toBe(422)
    const rows = await (await db()).execute(sql`select 1 from login_attempts`)
    expect(rows.rows).toHaveLength(0)
    // JSON with a charset is still JSON.
    expect((await login({ email: pat.email, password: pat.password }, { ip: address, contentType: 'application/json; charset=utf-8' })).status).toBe(200)
  })

  it('never sends anyone off the site, or back to a signed-out page', async () => {
    for (const next of ['//evil.example', 'https://evil.example', '/login', '/setup', '/reset']) {
      const res = await login({ email: pat.email, password: pat.password, next }, { ip: ip() })
      expect(res.body, next).toEqual({ ok: true, redirect: '/', userId: expect.any(String) })
    }
  })
})
