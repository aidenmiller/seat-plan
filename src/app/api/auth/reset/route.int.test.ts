/**
 * Reset links through the routes, against the test database: only an admin
 * makes one; looking it up; setting a password with it, which ends every
 * session the account had; and a link that is used, expired, or older than
 * the newest one, refused. The throttle counts every try before any password
 * work. No reply but the one that makes a link, and no activity row, holds a
 * token. The wrong-guess delay is switched off here.
 */
import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TEST_DATABASE_URL } from '../../../../../test/db'
import { makeMember, makeUser, sessionCookie, type TestUser } from '../../../../../test/auth'
import { callRoute, freshAddress, type CallOptions, type CallResult } from '../../../../../test/routes'
import { resetProblemMessage } from '@/domain/account-wording'
import { hashUserPassword, verifyUserPassword } from '@/server/auth/passwords'
import { PER_ADDRESS_LIMIT } from '@/server/auth/throttle'
import { activityEvents, passwordResets } from '@/server/db/schema'
import { lookupSession } from '@/server/repo/sessions'
import { findLoginCandidate } from '@/server/repo/users'
import type { CreatedResetLink, ResetLookup } from '@/shared/accounts-api'

vi.mock('@/server/auth/throttle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/auth/throttle')>()),
  wrongGuessDelay: async () => {},
}))
vi.mock('@/server/auth/passwords', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/server/auth/passwords')>()
  return { ...real, hashUserPassword: vi.fn(real.hashUserPassword) }
})

beforeAll(() => {
  vi.stubEnv('AUTH_SECRET', 'reset-route-test-secret-32-chars-plus')
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
  reset: (await import('./route')) as Record<string, unknown>,
  makeLink: (await import('../../admin/users/[id]/reset-link/route')) as Record<string, unknown>,
})

const issued: string[] = []

async function call(mod: Record<string, unknown>, method: string, opts: CallOptions & { makesToken?: boolean } = {}): Promise<CallResult> {
  const res = await callRoute(mod, method, opts)
  if (opts.makesToken && res.status === 201) {
    issued.push((res.body as CreatedResetLink).token)
  } else {
    for (const token of issued) expect(res.text).not.toContain(token)
  }
  return res
}

type Person = TestUser & { cookie: string }

async function person(opts: { isAdmin?: boolean; displayName?: string } = {}): Promise<Person> {
  const user = await makeUser(await db(), opts)
  return { ...user, cookie: await sessionCookie(await db(), user.id) }
}

let admin: Person
beforeAll(async () => {
  admin = await person({ isAdmin: true, displayName: 'Ada' })
})

async function resetLink(userId: string): Promise<string> {
  const { makeLink } = await routes()
  const res = await call(makeLink, 'POST', { cookie: admin.cookie, params: { id: userId }, makesToken: true })
  expect(res.status, res.text).toBe(201)
  const { token, expiresAt } = res.body as CreatedResetLink
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(Date.parse(expiresAt) - Date.now()).toBeGreaterThan(23.9 * 3_600_000)
  return token
}

const cookieValue = (cookie: string) => cookie.slice(cookie.indexOf('=') + 1)

describe('making a reset link', () => {
  it('is for admins only: an owner of a wedding the user belongs to gets 404, like anyone else', async () => {
    const { makeLink } = await routes()
    const { makeWedding } = await import('@/server/repo/test-fixtures')
    const weddingId = await makeWedding(await db())
    const owner = await person()
    const editor = await person()
    await makeMember(await db(), weddingId, owner.id, 'owner')
    await makeMember(await db(), weddingId, editor.id, 'editor')
    expect((await call(makeLink, 'POST', { cookie: owner.cookie, params: { id: editor.id }, makesToken: true })).status).toBe(404)
    expect((await call(makeLink, 'POST', { cookie: editor.cookie, params: { id: editor.id }, makesToken: true })).status).toBe(404)
    expect((await call(makeLink, 'POST', { params: { id: editor.id }, makesToken: true })).status).toBe(401)
    expect((await call(makeLink, 'POST', { cookie: admin.cookie, params: { id: randomUUID() }, makesToken: true })).status).toBe(404)
    expect(await (await db()).select().from(passwordResets).where(eq(passwordResets.userId, editor.id))).toEqual([])

    await resetLink(editor.id)
    const [made] = await (await db())
      .select({ userId: activityEvents.userId, detail: activityEvents.detail })
      .from(activityEvents)
      .where(and(eq(activityEvents.kind, 'reset_link_created'), eq(activityEvents.subjectId, editor.id)))
    expect(made).toEqual({ userId: admin.id, detail: {} })
  })
})

describe('POST /api/auth/reset', () => {
  it('shows whose link it is while it works, and 404 for an unknown or malformed link', async () => {
    const { reset } = await routes()
    const pat = await person({ displayName: 'Pat' })
    const token = await resetLink(pat.id)
    const seen = await call(reset, 'POST', { body: { token }, ip: freshAddress() })
    expect(seen.status).toBe(200)
    expect(seen.body).toEqual({ status: 'ok', displayName: 'Pat', email: pat.email, expiresAt: expect.any(String) } satisfies ResetLookup)
    expect(seen.text).not.toContain(pat.id)
    expect((await call(reset, 'POST', { body: { token: 'A'.repeat(43) }, ip: freshAddress() })).status).toBe(404)
    expect((await call(reset, 'POST', { body: { token: 'nope' }, ip: freshAddress() })).status).toBe(404)
    expect((await call(reset, 'POST', { body: {}, ip: freshAddress() })).status).toBe(422)
  })

  it('sets the password once, ends every session the account had, and leaves the person to sign in', async () => {
    const { reset } = await routes()
    const pat = await person()
    const otherDevice = await sessionCookie(await db(), pat.id)
    const token = await resetLink(pat.id)
    const res = await call(reset, 'POST', { body: { token, password: 'a fresh password here' }, ip: freshAddress() })
    expect(res).toMatchObject({ status: 200, body: { ok: true } })
    // Nobody is signed in by it.
    expect(res.headers.getSetCookie()).toEqual([])
    for (const cookie of [pat.cookie, otherDevice]) expect(await lookupSession(await db(), cookieValue(cookie))).toBeNull()
    const candidate = await findLoginCandidate(await db(), pat.email)
    expect(await verifyUserPassword(candidate!.passwordHash, 'a fresh password here')).toBe(true)
    expect(await verifyUserPassword(candidate!.passwordHash, pat.password)).toBe(false)

    // Once only.
    const again = await call(reset, 'POST', { body: { token, password: 'another new password' }, ip: freshAddress() })
    expect(again).toMatchObject({ status: 409, body: { error: 'reset_unusable', reason: 'used', message: resetProblemMessage('used') } })
    const seen = await call(reset, 'POST', { body: { token }, ip: freshAddress() })
    expect(seen.body).toEqual({ status: 'used' })
    const after = await findLoginCandidate(await db(), pat.email)
    expect(await verifyUserPassword(after!.passwordHash, 'a fresh password here')).toBe(true)

    const [used] = await (await db())
      .select({ userId: activityEvents.userId })
      .from(activityEvents)
      .where(and(eq(activityEvents.kind, 'reset_used'), eq(activityEvents.subjectId, pat.id)))
    expect(used).toEqual({ userId: pat.id })
  })

  it('refuses an older link once a newer one is made, and a link that has expired', async () => {
    const { reset } = await routes()
    const pat = await person()
    const older = await resetLink(pat.id)
    const newer = await resetLink(pat.id)
    expect((await call(reset, 'POST', { body: { token: older }, ip: freshAddress() })).body).toEqual({ status: 'expired' })
    expect(await call(reset, 'POST', { body: { token: older, password: 'a fresh password here' }, ip: freshAddress() })).toMatchObject({
      status: 409,
      body: { reason: 'expired' },
    })
    expect(await lookupSession(await db(), cookieValue(pat.cookie))).not.toBeNull()

    await (await db())
      .update(passwordResets)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(and(eq(passwordResets.userId, pat.id), sql`${passwordResets.usedAt} is null`))
    expect((await call(reset, 'POST', { body: { token: newer, password: 'a fresh password here' }, ip: freshAddress() })).body).toMatchObject({
      reason: 'expired',
    })
  })

  it('refuses a password that does not fit, before counting or hashing anything', async () => {
    const { reset } = await routes()
    const pat = await person()
    const token = await resetLink(pat.id)
    vi.mocked(hashUserPassword).mockClear()
    expect((await call(reset, 'POST', { body: { token, password: 'short' }, ip: freshAddress() })).status).toBe(422)
    expect((await call(reset, 'POST', { body: { token, password: 'x'.repeat(201) }, ip: freshAddress() })).status).toBe(422)
    expect(vi.mocked(hashUserPassword)).not.toHaveBeenCalled()
    expect((await (await db()).execute(sql`select 1 from login_attempts`)).rows).toHaveLength(0)
  })

  it('counts every try for the address before any password work, and a reset that works clears it', async () => {
    const { reset } = await routes()
    const pat = await person()
    const token = await resetLink(pat.id)
    const address = freshAddress()
    for (let i = 0; i < PER_ADDRESS_LIMIT - 1; i++) {
      expect((await call(reset, 'POST', { body: { token: `${'G'.repeat(40)}${String(i).padStart(3, '0')}` }, ip: address })).status).toBe(404)
    }
    expect((await call(reset, 'POST', { body: { token, password: 'a fresh password here' }, ip: address })).status).toBe(200)

    const next = await resetLink(pat.id)
    for (let i = 0; i < PER_ADDRESS_LIMIT; i++) {
      await call(reset, 'POST', { body: { token: `${'H'.repeat(40)}${String(i).padStart(3, '0')}`, password: 'a guess password' }, ip: address })
    }
    vi.mocked(hashUserPassword).mockClear()
    const blocked = await call(reset, 'POST', { body: { token: next, password: 'another fresh password' }, ip: address })
    expect(blocked).toMatchObject({ status: 429, body: { error: 'too_many_attempts' } })
    expect(vi.mocked(hashUserPassword)).not.toHaveBeenCalled()
    // Another address still can.
    expect((await call(reset, 'POST', { body: { token: next, password: 'another fresh password' }, ip: freshAddress() })).status).toBe(200)
  })

  it('leaves no token in the activity log', async () => {
    expect(issued.length).toBeGreaterThan(3)
    const rows = await (await db()).execute<{ detail: string }>(sql`select detail::text as detail from activity_events`)
    const all = rows.rows.map((r) => r.detail).join('\n')
    for (const token of issued) expect(all).not.toContain(token)
  })
})
