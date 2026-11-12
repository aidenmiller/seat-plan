/**
 * The account routes against the test database: changing your name and your
 * password (every other session ends, this browser gets a new one, wrong
 * current passwords are counted), and your own sessions: listing them,
 * signing one out, and signing out everywhere else. Nobody can touch another
 * person's session. The wrong-guess delay is switched off here.
 */
import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TEST_DATABASE_URL } from '../../../../test/db'
import { makeUser, sessionCookie, type TestUser } from '../../../../test/auth'
import { callRoute, freshAddress, sessionCookieFrom } from '../../../../test/routes'
import { verifyUserPassword } from '@/server/auth/passwords'
import { PER_ADDRESS_LIMIT } from '@/server/auth/throttle'
import { activityEvents } from '@/server/db/schema'
import { lookupSession } from '@/server/repo/sessions'
import { findLoginCandidate, getUserDto } from '@/server/repo/users'
import type { AccountSession } from '@/shared/accounts-api'

vi.mock('@/server/auth/throttle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/auth/throttle')>()),
  wrongGuessDelay: async () => {},
}))

beforeAll(() => {
  vi.stubEnv('AUTH_SECRET', 'account-route-test-secret-32-chars-plus')
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

const routes = async () => ({
  account: (await import('./route')) as Record<string, unknown>,
  password: (await import('./password/route')) as Record<string, unknown>,
  sessions: (await import('./sessions/route')) as Record<string, unknown>,
  session: (await import('./sessions/[id]/route')) as Record<string, unknown>,
  others: (await import('./sessions/revoke-others/route')) as Record<string, unknown>,
})

type Person = TestUser & { cookie: string }

async function person(): Promise<Person> {
  const user = await makeUser(await db())
  return { ...user, cookie: await sessionCookie(await db(), user.id) }
}

const cookieValue = (cookie: string) => cookie.slice(cookie.indexOf('=') + 1)
const sessionIdOf = async (cookie: string) => (await lookupSession(await db(), cookieValue(cookie)))!.sessionId

describe('PATCH /api/account', () => {
  it('changes your own display name, trimmed, and refuses one that does not fit', async () => {
    const { account } = await routes()
    const pat = await person()
    const res = await callRoute(account, 'PATCH', { cookie: pat.cookie, body: { displayName: '  Patricia  ' } })
    expect(res).toMatchObject({ status: 200, body: { id: pat.id, email: pat.email, displayName: 'Patricia' } })
    expect((await getUserDto(await db(), pat.id))!.displayName).toBe('Patricia')
    expect((await callRoute(account, 'PATCH', { cookie: pat.cookie, body: { displayName: '   ' } })).status).toBe(422)
    expect((await callRoute(account, 'PATCH', { cookie: pat.cookie, body: { displayName: 'x'.repeat(61) } })).status).toBe(422)
    expect((await callRoute(account, 'PATCH', { body: { displayName: 'Nobody' } })).status).toBe(401)
    // A page that does not name its user is refused, as on every change.
    expect(
      await callRoute(account, 'PATCH', { cookie: pat.cookie, body: { displayName: 'Stale' }, origin: 'https://seat.example' }),
    ).toMatchObject({ status: 401, body: { error: 'stale_page' } })
  })
})

describe('POST /api/account/password', () => {
  it('changes the password, signs out every other session, and keeps this browser signed in with a new session', async () => {
    const { password, sessions } = await routes()
    const pat = await person()
    const otherDevice = await sessionCookie(await db(), pat.id)
    const res = await callRoute(password, 'POST', { cookie: pat.cookie, body: { current: pat.password, next: 'a much better password' }, ip: freshAddress() })
    expect(res).toMatchObject({ status: 200, body: { ok: true } })
    const fresh = sessionCookieFrom(res)!
    expect(fresh).toBeTruthy()
    expect(fresh).not.toBe(pat.cookie)

    expect(await lookupSession(await db(), cookieValue(pat.cookie))).toBeNull()
    expect(await lookupSession(await db(), cookieValue(otherDevice))).toBeNull()
    expect(await lookupSession(await db(), cookieValue(fresh))).toMatchObject({ id: pat.id })
    expect((await callRoute(sessions, 'GET', { cookie: otherDevice })).status).toBe(401)
    const listed = await callRoute(sessions, 'GET', { cookie: fresh })
    expect((listed.body as AccountSession[]).map((s) => s.current)).toEqual([true])

    const candidate = await findLoginCandidate(await db(), pat.email)
    expect(await verifyUserPassword(candidate!.passwordHash, 'a much better password')).toBe(true)
    expect(await verifyUserPassword(candidate!.passwordHash, pat.password)).toBe(false)

    const logged = await (await db())
      .select({ detail: activityEvents.detail })
      .from(activityEvents)
      .where(and(eq(activityEvents.kind, 'password_changed'), eq(activityEvents.userId, pat.id)))
    expect(logged).toEqual([{ detail: {} }])
  })

  it('refuses a wrong current password (403) or a new one that does not fit (422), changing nothing', async () => {
    const { password } = await routes()
    const pat = await person()
    const wrong = await callRoute(password, 'POST', { cookie: pat.cookie, body: { current: 'not my password', next: 'a much better password' }, ip: freshAddress() })
    expect(wrong).toMatchObject({ status: 403, body: { error: 'wrong_password' } })
    expect(wrong.headers.getSetCookie()).toEqual([])
    expect((await callRoute(password, 'POST', { cookie: pat.cookie, body: { current: pat.password, next: 'short' }, ip: freshAddress() })).status).toBe(422)
    expect((await callRoute(password, 'POST', { cookie: pat.cookie, body: { next: 'a much better password' }, ip: freshAddress() })).status).toBe(422)
    expect(await lookupSession(await db(), cookieValue(pat.cookie))).not.toBeNull()
    const candidate = await findLoginCandidate(await db(), pat.email)
    expect(await verifyUserPassword(candidate!.passwordHash, pat.password)).toBe(true)
  })

  it('blocks after too many wrong current passwords, even the right one, and only for that account', async () => {
    const { password } = await routes()
    const pat = await person()
    const sam = await person()
    const address = freshAddress()
    for (let i = 0; i < PER_ADDRESS_LIMIT; i++) {
      expect((await callRoute(password, 'POST', { cookie: pat.cookie, body: { current: `guess ${i}`, next: 'a much better password' }, ip: address })).status).toBe(403)
    }
    const blocked = await callRoute(password, 'POST', { cookie: pat.cookie, body: { current: pat.password, next: 'a much better password' }, ip: address })
    expect(blocked).toMatchObject({ status: 429, body: { error: 'too_many_attempts' } })
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)
    // Someone else at the same address is not held up.
    expect((await callRoute(password, 'POST', { cookie: sam.cookie, body: { current: sam.password, next: 'a much better password' }, ip: address })).status).toBe(200)
  })
})

describe('your sessions', () => {
  it('lists only your own sessions, marking this one', async () => {
    const { sessions } = await routes()
    const pat = await person()
    const second = await sessionCookie(await db(), pat.id)
    const sam = await person()
    const res = await callRoute(sessions, 'GET', { cookie: pat.cookie })
    expect(res.status).toBe(200)
    const list = res.body as AccountSession[]
    expect(list.map((s) => s.id).sort()).toEqual([await sessionIdOf(pat.cookie), await sessionIdOf(second)].sort())
    expect(list.find((s) => s.current)!.id).toBe(await sessionIdOf(pat.cookie))
    expect(list[0]).toEqual({ id: expect.any(String), userAgent: 'vitest', createdAt: expect.any(String), lastSeenAt: expect.any(String), current: expect.any(Boolean) })
    expect(res.text).not.toContain(await sessionIdOf(sam.cookie))
    expect(res.text).not.toMatch(/hash/i)
    expect((await callRoute(sessions, 'GET')).status).toBe(401)
  })

  it('signs out one of your sessions, never someone else’s', async () => {
    const { session } = await routes()
    const pat = await person()
    const second = await sessionCookie(await db(), pat.id)
    const sam = await person()
    const samSession = await sessionIdOf(sam.cookie)

    expect((await callRoute(session, 'DELETE', { cookie: pat.cookie, params: { id: samSession } })).status).toBe(404)
    expect(await lookupSession(await db(), cookieValue(sam.cookie))).not.toBeNull()
    expect((await callRoute(session, 'DELETE', { cookie: pat.cookie, params: { id: randomUUID() } })).status).toBe(404)
    expect((await callRoute(session, 'DELETE', { cookie: pat.cookie, params: { id: 'nope' } })).status).toBe(404)

    const ended = await callRoute(session, 'DELETE', { cookie: pat.cookie, params: { id: await sessionIdOf(second) } })
    expect(ended).toMatchObject({ status: 200, body: { ok: true } })
    expect(await lookupSession(await db(), cookieValue(second))).toBeNull()
    expect(await lookupSession(await db(), cookieValue(pat.cookie))).not.toBeNull()
    // That one did not touch this browser's cookie.
    expect(sessionCookieFrom(ended)).not.toBe('')

    // Ending this browser's own session clears its cookie.
    const own = await callRoute(session, 'DELETE', { cookie: pat.cookie, params: { id: await sessionIdOf(pat.cookie) } })
    expect(own.status).toBe(200)
    expect(sessionCookieFrom(own)).toBe('')
  })

  it('signs out everywhere but here', async () => {
    const { others, sessions } = await routes()
    const pat = await person()
    const second = await sessionCookie(await db(), pat.id)
    const third = await sessionCookie(await db(), pat.id)
    const sam = await person()
    const res = await callRoute(others, 'POST', { cookie: pat.cookie })
    expect(res).toMatchObject({ status: 200, body: { ended: 2 } })
    for (const gone of [second, third]) expect(await lookupSession(await db(), cookieValue(gone))).toBeNull()
    expect(await lookupSession(await db(), cookieValue(pat.cookie))).not.toBeNull()
    expect(await lookupSession(await db(), cookieValue(sam.cookie))).not.toBeNull()
    expect(((await callRoute(sessions, 'GET', { cookie: pat.cookie })).body as AccountSession[]).length).toBe(1)
    expect((await callRoute(others, 'POST', { cookie: pat.cookie })).body).toEqual({ ended: 0 })
  })
})
