/**
 * The admin routes against the test database: anyone but an admin gets the
 * guard's 404; listing users; turning an account off (its sessions end, so
 * its next request is refused) and back on, but never your own; signing
 * someone out everywhere; planner invites; and every wedding, with taking
 * over one that has no owner.
 */
import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { TEST_DATABASE_URL } from '../../../../test/db'
import { makeMember, makeUser, sessionCookie, type TestUser } from '../../../../test/auth'
import { callRoute, type CallOptions } from '../../../../test/routes'
import { activityEvents, weddingMembers, weddings } from '@/server/db/schema'
import { lookupSession } from '@/server/repo/sessions'
import { findLoginCandidate } from '@/server/repo/users'
import type { AdminUser, AdminWedding, CreatedInvite, InviteSummary } from '@/shared/accounts-api'

beforeAll(() => {
  vi.stubEnv('AUTH_SECRET', 'admin-route-test-secret-32-chars-plus')
  vi.stubEnv('DATABASE_URL', TEST_DATABASE_URL)
})
afterAll(() => {
  vi.unstubAllEnvs()
})

async function db() {
  return (await import('@/server/db/client')).getDb()
}

const routes = async () => ({
  users: (await import('./users/route')) as Record<string, unknown>,
  user: (await import('./users/[id]/route')) as Record<string, unknown>,
  resetLink: (await import('./users/[id]/reset-link/route')) as Record<string, unknown>,
  signOut: (await import('./users/[id]/sign-out/route')) as Record<string, unknown>,
  invites: (await import('./invites/route')) as Record<string, unknown>,
  invite: (await import('./invites/[id]/route')) as Record<string, unknown>,
  weddings: (await import('./weddings/route')) as Record<string, unknown>,
  claim: (await import('./weddings/[id]/claim/route')) as Record<string, unknown>,
  weddingInvites: (await import('../weddings/[id]/invites/route')) as Record<string, unknown>,
  accountSessions: (await import('../account/sessions/route')) as Record<string, unknown>,
})

type Person = TestUser & { cookie: string }

async function person(opts: { isAdmin?: boolean; displayName?: string } = {}): Promise<Person> {
  const user = await makeUser(await db(), opts)
  return { ...user, cookie: await sessionCookie(await db(), user.id) }
}

const cookieValue = (cookie: string) => cookie.slice(cookie.indexOf('=') + 1)

let admin: Person
let planner: Person
beforeAll(async () => {
  admin = await person({ isAdmin: true, displayName: 'Ada' })
  planner = await person({ displayName: 'Pip' })
})

describe('every admin route refuses anyone but an admin', () => {
  it('answers 404 to a signed-in planner, as if the route did not exist, and 401 with no session', async () => {
    const r = await routes()
    const id = randomUUID()
    const calls: [Record<string, unknown>, string, CallOptions][] = [
      [r.users, 'GET', {}],
      [r.user, 'PATCH', { params: { id }, body: { disabled: true } }],
      [r.resetLink, 'POST', { params: { id } }],
      [r.signOut, 'POST', { params: { id } }],
      [r.invites, 'GET', {}],
      [r.invites, 'POST', { body: {} }],
      [r.invite, 'DELETE', { params: { id } }],
      [r.weddings, 'GET', {}],
      [r.claim, 'POST', { params: { id } }],
    ]
    for (const [mod, method, opts] of calls) {
      const res = await callRoute(mod, method, { ...opts, cookie: planner.cookie })
      expect(res, `${method} as a planner`).toMatchObject({ status: 404, body: { error: 'not_found' } })
      expect((await callRoute(mod, method, opts)).status, `${method} signed out`).toBe(401)
    }
  })
})

describe('users', () => {
  it('lists everyone for an admin, without password hashes', async () => {
    const { users } = await routes()
    const res = await callRoute(users, 'GET', { cookie: admin.cookie })
    expect(res.status).toBe(200)
    const list = res.body as AdminUser[]
    const pip = list.find((u) => u.id === planner.id)
    expect(pip).toEqual({
      id: planner.id,
      email: planner.email,
      displayName: 'Pip',
      isAdmin: false,
      disabled: false,
      createdAt: expect.any(String),
      disabledAt: null,
      lastLoginAt: expect.any(String),
      lastSeenAt: expect.any(String),
      weddingCount: 0,
    })
    expect(res.text).not.toMatch(/argon2|hash/i)
  })

  it('turns an account off, which ends its sessions so its next request is refused, and back on', async () => {
    const { user, accountSessions, invites } = await routes()
    const pat = await person()
    const second = await sessionCookie(await db(), pat.id)
    expect((await callRoute(accountSessions, 'GET', { cookie: pat.cookie })).status).toBe(200)

    const off = await callRoute(user, 'PATCH', { cookie: admin.cookie, params: { id: pat.id }, body: { disabled: true } })
    expect(off.status).toBe(200)
    expect(off.body).toMatchObject({ id: pat.id, disabled: true, disabledAt: expect.any(String) })
    for (const cookie of [pat.cookie, second]) expect(await lookupSession(await db(), cookieValue(cookie))).toBeNull()
    expect(await callRoute(accountSessions, 'GET', { cookie: pat.cookie })).toMatchObject({ status: 401, body: { error: 'unauthorized' } })
    expect((await findLoginCandidate(await db(), pat.email))!.disabled).toBe(true)

    const on = await callRoute(user, 'PATCH', { cookie: admin.cookie, params: { id: pat.id }, body: { disabled: false } })
    expect(on.body).toMatchObject({ id: pat.id, disabled: false, disabledAt: null })
    expect((await findLoginCandidate(await db(), pat.email))!.disabled).toBe(false)
    // The old sessions stay ended.
    expect(await lookupSession(await db(), cookieValue(second))).toBeNull()

    const kinds = await (await db())
      .select({ kind: activityEvents.kind, userId: activityEvents.userId })
      .from(activityEvents)
      .where(eq(activityEvents.subjectId, pat.id))
    expect(kinds).toEqual(expect.arrayContaining([{ kind: 'user_disabled', userId: admin.id }, { kind: 'user_enabled', userId: admin.id }]))

    // Turning an admin off cancels the invites they sent.
    const other = await person({ isAdmin: true })
    const sent = (await callRoute(invites, 'POST', { cookie: other.cookie, body: {} })).body as CreatedInvite
    expect((await callRoute(user, 'PATCH', { cookie: admin.cookie, params: { id: other.id }, body: { disabled: true } })).status).toBe(200)
    const listed = (await callRoute(invites, 'GET', { cookie: admin.cookie })).body as InviteSummary[]
    expect(listed.find((i) => i.id === sent.invite.id)!.state).toBe('revoked')
  })

  it('refuses turning off your own account, an unknown user and a body that does not fit', async () => {
    const { user } = await routes()
    expect(await callRoute(user, 'PATCH', { cookie: admin.cookie, params: { id: admin.id }, body: { disabled: true } })).toMatchObject({
      status: 409,
      body: { error: 'self' },
    })
    expect(await lookupSession(await db(), cookieValue(admin.cookie))).not.toBeNull()
    expect((await callRoute(user, 'PATCH', { cookie: admin.cookie, params: { id: randomUUID() }, body: { disabled: true } })).status).toBe(404)
    expect((await callRoute(user, 'PATCH', { cookie: admin.cookie, params: { id: 'nope' }, body: { disabled: true } })).status).toBe(404)
    expect((await callRoute(user, 'PATCH', { cookie: admin.cookie, params: { id: planner.id }, body: { disabled: 'yes' } })).status).toBe(422)
  })

  it('makes someone an admin and removes that, with the guards and a logged event', async () => {
    const { user, users } = await routes()
    const { setUserAdmin } = await import('@/server/repo/users')
    const pat = await person()
    const make = await callRoute(user, 'PATCH', { cookie: admin.cookie, params: { id: pat.id }, body: { admin: true } })
    expect(make).toMatchObject({ status: 200, body: { id: pat.id, isAdmin: true } })
    // The new admin can use the admin routes at once.
    expect((await callRoute(users, 'GET', { cookie: pat.cookie })).status).toBe(200)
    // Making an admin an admin again changes nothing and is fine.
    expect((await callRoute(user, 'PATCH', { cookie: admin.cookie, params: { id: pat.id }, body: { admin: true } })).status).toBe(200)

    // Not your own flag, even with another admin around.
    expect(await callRoute(user, 'PATCH', { cookie: pat.cookie, params: { id: pat.id }, body: { admin: false } })).toMatchObject({
      status: 409,
      body: { error: 'self' },
    })
    // An admin can remove another admin's flag, and the demoted one loses the admin routes at once.
    const boss = await person({ isAdmin: true })
    expect(await callRoute(user, 'PATCH', { cookie: pat.cookie, params: { id: boss.id }, body: { admin: false } })).toMatchObject({
      status: 200,
      body: { id: boss.id, isAdmin: false },
    })
    expect((await callRoute(users, 'GET', { cookie: boss.cookie })).status).toBe(404)

    const removed = await callRoute(user, 'PATCH', { cookie: admin.cookie, params: { id: pat.id }, body: { admin: false } })
    expect(removed).toMatchObject({ status: 200, body: { id: pat.id, isAdmin: false } })
    expect((await callRoute(users, 'GET', { cookie: pat.cookie })).status).toBe(404)

    // A turned-off account cannot be made an admin; the flag can still be taken from one.
    const off = await person()
    await callRoute(user, 'PATCH', { cookie: admin.cookie, params: { id: off.id }, body: { disabled: true } })
    expect(await callRoute(user, 'PATCH', { cookie: admin.cookie, params: { id: off.id }, body: { admin: true } })).toMatchObject({
      status: 409,
      body: { error: 'user_disabled' },
    })
    // The last admin who is on cannot be demoted (reached directly: the route's own self rule hides it from an admin).
    const lone = await person({ isAdmin: true })
    const others = await (await db()).execute<{ id: string }>(sql`update users set is_admin = false where id <> ${lone.id} and is_admin = true returning id`)
    expect(await setUserAdmin(await db(), planner.id, lone.id, false)).toBe('last-admin')
    expect(await setUserAdmin(await db(), planner.id, randomUUID(), true)).toBe('not-found')
    for (const row of others.rows) await (await db()).execute(sql`update users set is_admin = true where id = ${row.id}`)

    expect((await callRoute(user, 'PATCH', { cookie: admin.cookie, params: { id: pat.id }, body: {} })).status).toBe(422)
    expect((await callRoute(user, 'PATCH', { cookie: admin.cookie, params: { id: pat.id }, body: { admin: true, disabled: true } })).status).toBe(422)
    expect((await callRoute(user, 'PATCH', { cookie: admin.cookie, params: { id: pat.id }, body: { admin: 'yes' } })).status).toBe(422)
    expect((await callRoute(user, 'PATCH', { cookie: admin.cookie, params: { id: randomUUID() }, body: { admin: true } })).status).toBe(404)

    const events = await (await db())
      .select({ kind: activityEvents.kind, userId: activityEvents.userId, detail: activityEvents.detail })
      .from(activityEvents)
      .where(eq(activityEvents.subjectId, pat.id))
    expect(events.filter((e) => e.kind === 'user_admin_changed').map((e) => e.detail)).toEqual(expect.arrayContaining([{ admin: true }, { admin: false }]))
  })

  it('signs someone out everywhere, but not yourself', async () => {
    const { signOut } = await routes()
    const pat = await person()
    const second = await sessionCookie(await db(), pat.id)
    expect(await callRoute(signOut, 'POST', { cookie: admin.cookie, params: { id: pat.id } })).toMatchObject({ status: 200, body: { ended: 2 } })
    for (const cookie of [pat.cookie, second]) expect(await lookupSession(await db(), cookieValue(cookie))).toBeNull()
    // The account itself stays on.
    expect((await findLoginCandidate(await db(), pat.email))!.disabled).toBe(false)
    expect(await callRoute(signOut, 'POST', { cookie: admin.cookie, params: { id: admin.id } })).toMatchObject({ status: 409, body: { error: 'self' } })
    expect((await callRoute(signOut, 'POST', { cookie: admin.cookie, params: { id: randomUUID() } })).status).toBe(404)
  })
})

describe('planner invites', () => {
  it('makes, lists and cancels planner invites, and only those', async () => {
    const { invites, invite, weddingInvites } = await routes()
    const made = await callRoute(invites, 'POST', { cookie: admin.cookie, body: { email: 'New.Planner@Example.com', note: 'Spring' } })
    expect(made.status).toBe(201)
    const { invite: created, token } = made.body as CreatedInvite
    expect(created).toMatchObject({ weddingId: null, role: null, email: 'new.planner@example.com', note: 'Spring', state: 'pending' })
    expect((await callRoute(invites, 'POST', { cookie: admin.cookie, body: { role: 'owner', email: 'nope' } })).status).toBe(422)

    const listed = await callRoute(invites, 'GET', { cookie: admin.cookie })
    expect((listed.body as InviteSummary[]).find((i) => i.id === created.id)).toMatchObject({ state: 'pending' })
    expect(listed.text).not.toContain(token)

    // A wedding's invite is not a planner invite.
    const { makeWedding } = await import('@/server/repo/test-fixtures')
    const weddingId = await makeWedding(await db())
    const weddingInvite = (await callRoute(weddingInvites, 'POST', { cookie: admin.cookie, params: { id: weddingId }, body: { role: 'editor' } }))
      .body as CreatedInvite
    expect((await callRoute(invite, 'DELETE', { cookie: admin.cookie, params: { id: weddingInvite.invite.id } })).status).toBe(404)
    expect((await callRoute(invites, 'GET', { cookie: admin.cookie })).text).not.toContain(weddingInvite.invite.id)

    expect(await callRoute(invite, 'DELETE', { cookie: admin.cookie, params: { id: created.id } })).toMatchObject({ status: 200, body: { ok: true } })
    expect(await callRoute(invite, 'DELETE', { cookie: admin.cookie, params: { id: created.id } })).toMatchObject({
      status: 409,
      body: { error: 'not_pending' },
    })
    expect((await callRoute(invite, 'DELETE', { cookie: admin.cookie, params: { id: randomUUID() } })).status).toBe(404)

    const rows = await (await db()).execute<{ detail: string }>(sql`select detail::text as detail from activity_events`)
    expect(rows.rows.map((r) => r.detail).join('\n')).not.toContain(token)
  })
})

describe('weddings', () => {
  it('lists every wedding, deleted ones too, with members and counts', async () => {
    const { weddings: list } = await routes()
    const { makeWedding, makeGuest } = await import('@/server/repo/test-fixtures')
    const live = await makeWedding(await db(), `Live ${randomUUID()}`)
    const gone = await makeWedding(await db(), `Gone ${randomUUID()}`)
    await makeGuest(await db(), live)
    await makeMember(await db(), live, planner.id, 'owner')
    await (await db()).update(weddings).set({ deletedAt: new Date() }).where(eq(weddings.id, gone))

    const res = await callRoute(list, 'GET', { cookie: admin.cookie })
    expect(res.status).toBe(200)
    const all = res.body as AdminWedding[]
    expect(all.find((w) => w.id === live)).toMatchObject({
      guestCount: 1,
      layoutCount: 0,
      deletedAt: null,
      members: [{ userId: planner.id, displayName: 'Pip', email: planner.email, role: 'owner' }],
    })
    expect(all.find((w) => w.id === gone)).toMatchObject({ deletedAt: expect.any(String), members: [] })
  })

  it('lets an admin take over a wedding with no owner, and only then', async () => {
    const { claim } = await routes()
    const { makeWedding } = await import('@/server/repo/test-fixtures')
    const ownerless = await makeWedding(await db())
    const owned = await makeWedding(await db())
    await makeMember(await db(), owned, planner.id, 'owner')

    const res = await callRoute(claim, 'POST', { cookie: admin.cookie, params: { id: ownerless } })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ id: ownerless, members: [{ userId: admin.id, role: 'owner' }] })
    expect(await callRoute(claim, 'POST', { cookie: admin.cookie, params: { id: ownerless } })).toMatchObject({
      status: 409,
      body: { error: 'has_owner' },
    })
    expect((await callRoute(claim, 'POST', { cookie: admin.cookie, params: { id: owned } })).status).toBe(409)
    const ownedMembers = await (await db()).select().from(weddingMembers).where(eq(weddingMembers.weddingId, owned))
    expect(ownedMembers.map((m) => m.userId)).toEqual([planner.id])
    expect((await callRoute(claim, 'POST', { cookie: admin.cookie, params: { id: randomUUID() } })).status).toBe(404)

    // A deleted wedding with no owner can be taken over too, so restoring it later leaves someone who can open it.
    const deleted = await makeWedding(await db())
    await (await db()).update(weddings).set({ deletedAt: new Date() }).where(eq(weddings.id, deleted))
    expect((await callRoute(claim, 'POST', { cookie: admin.cookie, params: { id: deleted } })).status).toBe(200)

    const [logged] = await (await db())
      .select({ userId: activityEvents.userId, detail: activityEvents.detail })
      .from(activityEvents)
      .where(and(eq(activityEvents.kind, 'member_added'), eq(activityEvents.weddingId, ownerless)))
    expect(logged).toEqual({ userId: admin.id, detail: { role: 'owner', claimed: true } })
  })
})
