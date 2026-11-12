/**
 * The member routes against the test database: who may list, change and
 * remove members (owner, editor, someone else, an admin), leaving a wedding,
 * the last-owner refusals, and the activity log.
 */
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { TEST_DATABASE_URL } from '../../../../../../test/db'
import { makeMember, makeUser, sessionCookie, type TestUser } from '../../../../../../test/auth'
import { callRoute } from '../../../../../../test/routes'
import { LAST_OWNER_LEAVE_MESSAGE, LAST_OWNER_MESSAGE } from '@/domain/account-wording'
import { activityEvents, weddingMembers, weddings } from '@/server/db/schema'
import type { WeddingMember } from '@/shared/accounts-api'

beforeAll(() => {
  vi.stubEnv('AUTH_SECRET', 'members-route-test-secret-32-chars-plus')
  vi.stubEnv('DATABASE_URL', TEST_DATABASE_URL)
})
afterAll(() => {
  vi.unstubAllEnvs()
})

async function db() {
  return (await import('@/server/db/client')).getDb()
}

const routes = async () => ({
  list: (await import('./route')) as Record<string, unknown>,
  one: (await import('./[userId]/route')) as Record<string, unknown>,
})

type Person = TestUser & { cookie: string }

async function person(opts: { isAdmin?: boolean; displayName?: string } = {}): Promise<Person> {
  const user = await makeUser(await db(), opts)
  return { ...user, cookie: await sessionCookie(await db(), user.id) }
}

/** A wedding with an owner, an editor, someone who is not a member, and an admin who is not one either. */
async function cast() {
  const { makeWedding } = await import('@/server/repo/test-fixtures')
  const weddingId = await makeWedding(await db())
  const owner = await person({ displayName: 'Olive' })
  const editor = await person({ displayName: 'Eddie' })
  const stranger = await person({ displayName: 'Sam' })
  const admin = await person({ displayName: 'Ada', isAdmin: true })
  await makeMember(await db(), weddingId, owner.id, 'owner')
  await makeMember(await db(), weddingId, editor.id, 'editor')
  return { weddingId, owner, editor, stranger, admin }
}

async function roleOf(weddingId: string, userId: string): Promise<string | null> {
  const [row] = await (await db())
    .select({ role: weddingMembers.role })
    .from(weddingMembers)
    .where(and(eq(weddingMembers.weddingId, weddingId), eq(weddingMembers.userId, userId)))
  return row?.role ?? null
}

async function events(weddingId: string, kind: string) {
  return (await db())
    .select({ userId: activityEvents.userId, subjectId: activityEvents.subjectId, detail: activityEvents.detail })
    .from(activityEvents)
    .where(and(eq(activityEvents.weddingId, weddingId), eq(activityEvents.kind, kind)))
}

describe('GET /api/weddings/:id/members', () => {
  it('lists the members for any member and for an admin, and is 404 for anyone else', async () => {
    const { list } = await routes()
    const { weddingId, owner, editor, stranger, admin } = await cast()
    for (const who of [owner, editor, admin]) {
      const res = await callRoute(list, 'GET', { cookie: who.cookie, params: { id: weddingId } })
      expect(res.status, who.displayName).toBe(200)
      expect((res.body as WeddingMember[]).map((m) => [m.displayName, m.role])).toEqual([
        ['Olive', 'owner'],
        ['Eddie', 'editor'],
      ])
    }
    const [first] = (await callRoute(list, 'GET', { cookie: owner.cookie, params: { id: weddingId } })).body as WeddingMember[]
    expect(first).toEqual({ userId: owner.id, email: owner.email, displayName: 'Olive', role: 'owner', disabled: false, addedAt: expect.any(String) })

    expect((await callRoute(list, 'GET', { cookie: stranger.cookie, params: { id: weddingId } })).status).toBe(404)
    expect((await callRoute(list, 'GET', { params: { id: weddingId } })).status).toBe(401)
    expect((await callRoute(list, 'GET', { cookie: owner.cookie, params: { id: randomUUID() } })).status).toBe(404)
    expect((await callRoute(list, 'GET', { cookie: owner.cookie, params: { id: 'not-a-uuid' } })).status).toBe(404)
    // A deleted wedding looks like one that does not exist.
    await (await db()).update(weddings).set({ deletedAt: new Date() }).where(eq(weddings.id, weddingId))
    expect((await callRoute(list, 'GET', { cookie: owner.cookie, params: { id: weddingId } })).status).toBe(404)
  })
})

describe('PATCH /api/weddings/:id/members/:userId', () => {
  it('lets an owner change roles, but never leave the wedding without an owner', async () => {
    const { one } = await routes()
    const { weddingId, owner, editor } = await cast()
    const patch = (who: Person, userId: string, body: unknown) => callRoute(one, 'PATCH', { cookie: who.cookie, params: { id: weddingId, userId }, body })

    // The only owner cannot step down.
    const alone = await patch(owner, owner.id, { role: 'editor' })
    expect(alone).toMatchObject({ status: 409, body: { error: 'last_owner', message: LAST_OWNER_MESSAGE } })
    expect(await roleOf(weddingId, owner.id)).toBe('owner')

    const raised = await patch(owner, editor.id, { role: 'owner' })
    expect(raised.status).toBe(200)
    expect(raised.body).toMatchObject({ userId: editor.id, role: 'owner' })
    // With a second owner, the first may step down.
    expect((await patch(owner, owner.id, { role: 'editor' })).body).toMatchObject({ userId: owner.id, role: 'editor' })
    expect(await roleOf(weddingId, owner.id)).toBe('editor')
    // Now an editor, they cannot change roles any more.
    expect((await patch(owner, editor.id, { role: 'editor' })).status).toBe(403)

    const changes = await events(weddingId, 'member_role_changed')
    expect(changes).toEqual(
      expect.arrayContaining([
        { userId: owner.id, subjectId: editor.id, detail: { role: 'owner' } },
        { userId: owner.id, subjectId: owner.id, detail: { role: 'editor' } },
      ]),
    )
  })

  it('refuses editors (403), strangers (404), non-members, bad ids and bad bodies', async () => {
    const { one } = await routes()
    const { weddingId, owner, editor, stranger } = await cast()
    const patch = (who: Person, userId: string, body: unknown) => callRoute(one, 'PATCH', { cookie: who.cookie, params: { id: weddingId, userId }, body })
    expect((await patch(editor, editor.id, { role: 'owner' })).status).toBe(403)
    expect((await patch(stranger, editor.id, { role: 'owner' })).status).toBe(404)
    expect((await patch(owner, stranger.id, { role: 'editor' })).status).toBe(404)
    expect((await patch(owner, 'not-a-uuid', { role: 'editor' })).status).toBe(404)
    expect((await patch(owner, editor.id, { role: 'admin' })).status).toBe(422)
    expect((await patch(owner, editor.id, {})).status).toBe(422)
    expect(await roleOf(weddingId, editor.id)).toBe('editor')
  })

  it('lets an admin who is not a member change roles, and logs it', async () => {
    const { one } = await routes()
    const { weddingId, editor, admin } = await cast()
    const res = await callRoute(one, 'PATCH', { cookie: admin.cookie, params: { id: weddingId, userId: editor.id }, body: { role: 'owner' } })
    expect(res.status).toBe(200)
    expect(await roleOf(weddingId, editor.id)).toBe('owner')
    expect((await events(weddingId, 'admin_access')).some((e) => e.userId === admin.id)).toBe(true)
  })
})

describe('DELETE /api/weddings/:id/members/:userId', () => {
  it('lets an owner remove anyone but the last owner, and an editor only themselves', async () => {
    const { one, list } = await routes()
    const { weddingId, owner, editor, stranger } = await cast()
    const second = await person({ displayName: 'Esme' })
    await makeMember(await db(), weddingId, second.id, 'editor')
    const remove = (who: Person, userId: string) => callRoute(one, 'DELETE', { cookie: who.cookie, params: { id: weddingId, userId } })

    // An editor cannot remove someone else, and a stranger cannot even see the wedding.
    expect((await remove(editor, second.id)).status).toBe(403)
    expect((await remove(editor, owner.id)).status).toBe(403)
    expect((await remove(stranger, second.id)).status).toBe(404)
    expect(await roleOf(weddingId, second.id)).toBe('editor')

    // The only owner cannot leave, or be removed.
    const stay = await remove(owner, owner.id)
    expect(stay).toMatchObject({ status: 409, body: { error: 'last_owner', message: LAST_OWNER_LEAVE_MESSAGE } })

    expect(await remove(owner, second.id)).toMatchObject({ status: 200, body: { ok: true } })
    expect(await roleOf(weddingId, second.id)).toBeNull()
    expect((await callRoute(list, 'GET', { cookie: second.cookie, params: { id: weddingId } })).status).toBe(404)
    // Gone already.
    expect((await remove(owner, second.id)).status).toBe(404)

    // An editor may leave.
    expect((await remove(editor, editor.id)).status).toBe(200)
    expect(await roleOf(weddingId, editor.id)).toBeNull()
    expect((await callRoute(list, 'GET', { cookie: editor.cookie, params: { id: weddingId } })).status).toBe(404)

    const removed = await events(weddingId, 'member_removed')
    expect(removed).toEqual(
      expect.arrayContaining([
        { userId: owner.id, subjectId: second.id, detail: { left: false } },
        { userId: editor.id, subjectId: editor.id, detail: { left: true } },
      ]),
    )
  })

  it('lets one of two owners leave, or be removed by the other', async () => {
    const { one } = await routes()
    const { weddingId, owner } = await cast()
    const coOwner = await person()
    await makeMember(await db(), weddingId, coOwner.id, 'owner')
    expect((await callRoute(one, 'DELETE', { cookie: owner.cookie, params: { id: weddingId, userId: coOwner.id } })).status).toBe(200)
    await makeMember(await db(), weddingId, coOwner.id, 'owner')
    expect((await callRoute(one, 'DELETE', { cookie: owner.cookie, params: { id: weddingId, userId: owner.id } })).status).toBe(200)
    expect(await roleOf(weddingId, coOwner.id)).toBe('owner')
    // The one left is the last owner now.
    expect((await callRoute(one, 'DELETE', { cookie: coOwner.cookie, params: { id: weddingId, userId: coOwner.id } })).status).toBe(409)
  })

  it('lets an admin remove someone, logging it when the admin is only an editor there', async () => {
    const { one } = await routes()
    const { weddingId, editor, admin } = await cast()
    const third = await person()
    await makeMember(await db(), weddingId, third.id, 'editor')
    await makeMember(await db(), weddingId, admin.id, 'editor')
    expect((await events(weddingId, 'admin_access')).length).toBe(0)
    expect((await callRoute(one, 'DELETE', { cookie: admin.cookie, params: { id: weddingId, userId: third.id } })).status).toBe(200)
    expect(await roleOf(weddingId, third.id)).toBeNull()
    const logged = await events(weddingId, 'admin_access')
    expect(logged).toHaveLength(1)
    expect(logged[0]).toMatchObject({ userId: admin.id, detail: { method: 'DELETE', resolver: 'byWeddingId', write: true } })
    // Leaving needs no power, so it is not logged.
    expect((await callRoute(one, 'DELETE', { cookie: admin.cookie, params: { id: weddingId, userId: admin.id } })).status).toBe(200)
    expect(await events(weddingId, 'admin_access')).toHaveLength(1)
    // As a non-member, the guard logs the access itself.
    expect((await callRoute(one, 'DELETE', { cookie: admin.cookie, params: { id: weddingId, userId: editor.id } })).status).toBe(200)
    expect(await events(weddingId, 'admin_access')).toHaveLength(2)
  })

  it('refuses a change from a page that does not name its user', async () => {
    const { one } = await routes()
    const { weddingId, owner, editor } = await cast()
    const res = await callRoute(one, 'DELETE', { cookie: owner.cookie, params: { id: weddingId, userId: editor.id }, origin: 'https://seat.example' })
    expect(res).toMatchObject({ status: 401, body: { error: 'stale_page' } })
    const ok = await callRoute(one, 'DELETE', {
      cookie: owner.cookie,
      params: { id: weddingId, userId: editor.id },
      origin: 'https://seat.example',
      userHeader: owner.id,
    })
    expect(ok.status).toBe(200)
  })
})
