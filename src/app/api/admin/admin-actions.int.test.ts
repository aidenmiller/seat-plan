/**
 * The admin-only changes (milestone 8) against the test database: undeleting
 * a wedding, adding someone to a wedding with no invite, giving a wedding a
 * new owner (the last-owner rule holds, even with a removal at the same
 * time), and moving venues in and out of the library or to another owner.
 * Anyone but an admin gets the guard's 404 and changes nothing.
 */
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { TEST_DATABASE_URL } from '../../../../test/db'
import { makeMember, makeUser, makeWeddingFor, sessionCookie, type TestUser } from '../../../../test/auth'
import { callRoute, type CallOptions } from '../../../../test/routes'
import { activityEvents, venueTemplates, weddingMembers, weddings } from '@/server/db/schema'
import { removeMember } from '@/server/repo/members'
import { makeGuest, makeTemplate } from '@/server/repo/test-fixtures'
import type { AdminWedding, WeddingMember } from '@/shared/accounts-api'
import type { AdminVenue } from '@/shared/admin-api'

beforeAll(() => {
  vi.stubEnv('AUTH_SECRET', 'admin-actions-test-secret-32-chars-plus')
  vi.stubEnv('DATABASE_URL', TEST_DATABASE_URL)
})
afterAll(() => {
  vi.unstubAllEnvs()
})

async function db() {
  return (await import('@/server/db/client')).getDb()
}

const routes = async () => ({
  undelete: (await import('./weddings/[id]/undelete/route')) as Record<string, unknown>,
  members: (await import('./weddings/[id]/members/route')) as Record<string, unknown>,
  transfer: (await import('./weddings/[id]/transfer/route')) as Record<string, unknown>,
  venue: (await import('./venues/[id]/route')) as Record<string, unknown>,
})

type Person = TestUser & { cookie: string }

async function person(opts: { isAdmin?: boolean; displayName?: string; disabled?: boolean } = {}): Promise<Person> {
  const user = await makeUser(await db(), opts)
  return { ...user, cookie: opts.disabled ? '' : await sessionCookie(await db(), user.id) }
}

let admin: Person
let planner: Person
beforeAll(async () => {
  admin = await person({ isAdmin: true, displayName: 'Ada' })
  planner = await person({ displayName: 'Pip' })
})

async function rolesIn(weddingId: string): Promise<Record<string, string>> {
  const rows = await (await db()).select({ userId: weddingMembers.userId, role: weddingMembers.role }).from(weddingMembers).where(eq(weddingMembers.weddingId, weddingId))
  return Object.fromEntries(rows.map((r) => [r.userId, r.role]))
}

async function events(kind: string, where: { weddingId?: string; subjectId?: string }) {
  return (await db())
    .select({ userId: activityEvents.userId, subjectId: activityEvents.subjectId, detail: activityEvents.detail })
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.kind, kind),
        where.weddingId ? eq(activityEvents.weddingId, where.weddingId) : undefined,
        where.subjectId ? eq(activityEvents.subjectId, where.subjectId) : undefined,
      ),
    )
}

async function weddingRow(id: string) {
  const [row] = await (await db()).select().from(weddings).where(eq(weddings.id, id))
  return row!
}

async function venueRow(id: string) {
  const [row] = await (await db()).select().from(venueTemplates).where(eq(venueTemplates.id, id))
  return row!
}

describe('the admin actions refuse anyone but an admin', () => {
  it('answers 404 to a planner and 401 signed out, and nothing changes', async () => {
    const r = await routes()
    const wedding = await makeWeddingFor(await db(), planner.id, 'Pip’s')
    const gone = await makeWeddingFor(await db(), planner.id, 'Pip’s old one')
    await (await db()).update(weddings).set({ deletedAt: new Date() }).where(eq(weddings.id, gone))
    const hall = await makeTemplate(await db(), 'Pip hall')
    await (await db()).update(venueTemplates).set({ ownerUserId: planner.id }).where(eq(venueTemplates.id, hall))
    const before = { roles: await rolesIn(wedding), gone: await weddingRow(gone), hall: await venueRow(hall) }
    const calls: [Record<string, unknown>, string, CallOptions][] = [
      [r.undelete, 'POST', { params: { id: gone } }],
      [r.members, 'POST', { params: { id: wedding }, body: { userId: planner.id, role: 'owner' } }],
      [r.transfer, 'POST', { params: { id: wedding }, body: { toUserId: admin.id, keepPreviousAsEditors: true } }],
      [r.venue, 'PATCH', { params: { id: hall }, body: { library: true } }],
    ]
    for (const [mod, method, opts] of calls) {
      expect(await callRoute(mod, method, { ...opts, cookie: planner.cookie }), `${method} as a planner`).toMatchObject({ status: 404, body: { error: 'not_found' } })
      expect((await callRoute(mod, method, opts)).status, `${method} signed out`).toBe(401)
    }
    expect({ roles: await rolesIn(wedding), gone: await weddingRow(gone), hall: await venueRow(hall) }).toEqual(before)
  })
})

describe('undelete', () => {
  it('clears deleted_at and nothing else, once; a live wedding answers the same; a made-up id 404', async () => {
    const { undelete } = await routes()
    const gone = await makeWeddingFor(await db(), planner.id, `Gone ${randomUUID()}`)
    await makeGuest(await db(), gone)
    await (await db()).update(weddings).set({ deletedAt: new Date() }).where(eq(weddings.id, gone))
    const before = await weddingRow(gone)

    const res = await callRoute(undelete, 'POST', { cookie: admin.cookie, params: { id: gone } })
    expect(res.status).toBe(200)
    expect(res.body as AdminWedding).toMatchObject({ id: gone, deletedAt: null, guestCount: 1, members: [{ userId: planner.id, role: 'owner' }] })
    expect(await weddingRow(gone)).toEqual({ ...before, deletedAt: null })

    expect(await callRoute(undelete, 'POST', { cookie: admin.cookie, params: { id: gone } })).toMatchObject({ status: 200, body: { id: gone, deletedAt: null } })
    expect(await events('wedding_undeleted', { weddingId: gone })).toEqual([{ userId: admin.id, subjectId: null, detail: {} }])
    expect((await callRoute(undelete, 'POST', { cookie: admin.cookie, params: { id: randomUUID() } })).status).toBe(404)
    expect((await callRoute(undelete, 'POST', { cookie: admin.cookie, params: { id: 'not-an-id' } })).status).toBe(404)
  })
})

describe('adding someone to a wedding', () => {
  it('adds someone with an account as an owner or an editor, with no invite, and logs it', async () => {
    const { members } = await routes()
    const wedding = await makeWeddingFor(await db(), planner.id, 'Adding')
    const kit = await person({ displayName: 'Kit' })
    const res = await callRoute(members, 'POST', { cookie: admin.cookie, params: { id: wedding }, body: { userId: kit.id, role: 'editor' } })
    expect(res.status).toBe(201)
    expect(res.body as WeddingMember).toMatchObject({ userId: kit.id, displayName: 'Kit', role: 'editor', disabled: false })
    expect(await rolesIn(wedding)).toEqual({ [planner.id]: 'owner', [kit.id]: 'editor' })
    const [added] = await (await db()).select().from(weddingMembers).where(and(eq(weddingMembers.weddingId, wedding), eq(weddingMembers.userId, kit.id)))
    expect(added!.addedByUserId).toBe(admin.id)
    expect(await events('member_added', { weddingId: wedding })).toEqual([{ userId: admin.id, subjectId: kit.id, detail: { role: 'editor', byAdmin: true } }])
    // Kit can open it now: the wedding is in Kit's list.
    const list = (await import('../weddings/route')) as Record<string, unknown>
    expect(((await callRoute(list, 'GET', { cookie: kit.cookie })).body as { id: string }[]).map((w) => w.id)).toContain(wedding)
  })

  it('refuses someone who belongs already, an account that is off, an unknown account, and a deleted or unknown wedding', async () => {
    const { members } = await routes()
    const wedding = await makeWeddingFor(await db(), planner.id, 'Refusing')
    const off = await person({ displayName: 'Off', disabled: true })
    const add = (id: string, userId: string, role = 'editor') => callRoute(members, 'POST', { cookie: admin.cookie, params: { id }, body: { userId, role } })
    expect(await add(wedding, planner.id, 'editor')).toMatchObject({ status: 409, body: { error: 'already_member' } })
    expect(await add(wedding, off.id)).toMatchObject({ status: 409, body: { error: 'user_disabled' } })
    expect(await add(wedding, randomUUID())).toMatchObject({ status: 422, body: { error: 'invalid' } })
    expect((await add(wedding, 'nobody')).status).toBe(422)
    expect((await callRoute(members, 'POST', { cookie: admin.cookie, params: { id: wedding }, body: { userId: off.id, role: 'boss' } })).status).toBe(422)
    expect((await add(randomUUID(), off.id)).status).toBe(404)
    await (await db()).update(weddings).set({ deletedAt: new Date() }).where(eq(weddings.id, wedding))
    const kit = await person({ displayName: 'Kit' })
    expect(await add(wedding, kit.id)).toMatchObject({ status: 409, body: { error: 'deleted' } })
    expect(await rolesIn(wedding)).toEqual({ [planner.id]: 'owner' })
  })
})

describe('giving a wedding a new owner', () => {
  it('adds the new owner and makes the owners before editors, or leaves them owners', async () => {
    const { transfer } = await routes()
    const wedding = await makeWeddingFor(await db(), planner.id, 'Handing over')
    const second = await person({ displayName: 'Sam' })
    await makeMember(await db(), wedding, second.id, 'owner')
    const heir = await person({ displayName: 'Heir' })

    const res = await callRoute(transfer, 'POST', { cookie: admin.cookie, params: { id: wedding }, body: { toUserId: heir.id, keepPreviousAsEditors: true } })
    expect(res.status).toBe(200)
    expect((res.body as WeddingMember[]).map((m) => [m.displayName, m.role])).toEqual([
      ['Heir', 'owner'],
      ['Pip', 'editor'],
      ['Sam', 'editor'],
    ])
    const [logged] = await events('ownership_transferred', { weddingId: wedding })
    expect(logged).toMatchObject({ userId: admin.id, subjectId: heir.id, detail: { previousNowEditors: true } })
    expect(((logged!.detail as { previousOwners: string[] }).previousOwners).sort()).toEqual([planner.id, second.id].sort())

    // Without the switch, the owners stay owners; an editor is raised.
    const keep = await callRoute(transfer, 'POST', { cookie: admin.cookie, params: { id: wedding }, body: { toUserId: planner.id, keepPreviousAsEditors: false } })
    expect(keep.status).toBe(200)
    expect(await rolesIn(wedding)).toEqual({ [heir.id]: 'owner', [planner.id]: 'owner', [second.id]: 'editor' })
  })

  it('never leaves a wedding without an owner: to its only owner, with the switch, changes nothing', async () => {
    const { transfer } = await routes()
    const wedding = await makeWeddingFor(await db(), planner.id, 'Same hands')
    const res = await callRoute(transfer, 'POST', { cookie: admin.cookie, params: { id: wedding }, body: { toUserId: planner.id, keepPreviousAsEditors: true } })
    expect(res.status).toBe(200)
    expect(await rolesIn(wedding)).toEqual({ [planner.id]: 'owner' })
  })

  it('keeps an owner when the new owner is taken out at the same time', async () => {
    const { transfer } = await routes()
    for (let round = 0; round < 5; round++) {
      const wedding = await makeWeddingFor(await db(), planner.id, `Race ${round}`)
      const heir = await person({ displayName: 'Heir' })
      await makeMember(await db(), wedding, heir.id, 'editor')
      const [moved, removed] = await Promise.all([
        callRoute(transfer, 'POST', { cookie: admin.cookie, params: { id: wedding }, body: { toUserId: heir.id, keepPreviousAsEditors: true } }),
        removeMember(await db(), wedding, heir.id),
      ])
      expect(moved.status, moved.text).toBe(200)
      const roles = await rolesIn(wedding)
      expect(Object.values(roles), `round ${round}: ${removed}`).toContain('owner')
      // Either the removal came first and the heir was added back as the owner, or it came second and was refused.
      if (removed === 'ok') expect(roles).toEqual({ [heir.id]: 'owner', [planner.id]: 'editor' })
      else expect(removed).toBe('last-owner')
    }
  })

  it('refuses an account that is off, an unknown account, and a deleted or unknown wedding', async () => {
    const { transfer } = await routes()
    const wedding = await makeWeddingFor(await db(), planner.id, 'Not moving')
    const off = await person({ displayName: 'Off', disabled: true })
    const move = (id: string, toUserId: string) =>
      callRoute(transfer, 'POST', { cookie: admin.cookie, params: { id }, body: { toUserId, keepPreviousAsEditors: true } })
    expect(await move(wedding, off.id)).toMatchObject({ status: 409, body: { error: 'user_disabled' } })
    expect((await move(wedding, randomUUID())).status).toBe(422)
    expect((await move(randomUUID(), planner.id)).status).toBe(404)
    expect((await callRoute(transfer, 'POST', { cookie: admin.cookie, params: { id: wedding }, body: { toUserId: planner.id } })).status).toBe(422)
    await (await db()).update(weddings).set({ deletedAt: new Date() }).where(eq(weddings.id, wedding))
    expect(await move(wedding, admin.id)).toMatchObject({ status: 409, body: { error: 'deleted' } })
    expect(await rolesIn(wedding)).toEqual({ [planner.id]: 'owner' })
  })
})

describe('venues', () => {
  it('puts a venue in the library and takes it out, keeping its owner, contents and edit time, and logs each change', async () => {
    const { venue } = await routes()
    const hall = await makeTemplate(await db(), `Pip hall ${randomUUID()}`)
    await (await db()).update(venueTemplates).set({ ownerUserId: planner.id }).where(eq(venueTemplates.id, hall))
    const before = await venueRow(hall)
    const patch = (body: unknown) => callRoute(venue, 'PATCH', { cookie: admin.cookie, params: { id: hall }, body })

    const promoted = await patch({ library: true })
    expect(promoted.status).toBe(200)
    expect(promoted.body as AdminVenue).toMatchObject({ id: hall, status: 'library', isLibrary: true, owner: { id: planner.id, displayName: 'Pip' } })
    expect(await venueRow(hall)).toEqual({ ...before, isLibrary: true })
    // Every planner sees it now.
    const list = (await import('../venues/route')) as Record<string, unknown>
    const someone = await person({ displayName: 'Other' })
    expect(((await callRoute(list, 'GET', { cookie: someone.cookie })).body as { id: string }[]).map((v) => v.id)).toContain(hall)

    expect(await patch({ library: false })).toMatchObject({ status: 200, body: { status: 'private', owner: { id: planner.id } } })
    expect(await venueRow(hall)).toEqual(before)
    expect((await events('venue_library_changed', { subjectId: hall })).map((e) => e.detail)).toEqual([{ library: true }, { library: false }])
  })

  it('wants an owner outside the library, and changes owners', async () => {
    const { venue } = await routes()
    const hall = await makeTemplate(await db(), `Old hall ${randomUUID()}`)
    const patch = (body: unknown) => callRoute(venue, 'PATCH', { cookie: admin.cookie, params: { id: hall }, body })
    // Into the library with no owner: fine. Out again with none: refused until it gets one.
    expect(await patch({ library: true })).toMatchObject({ status: 200, body: { status: 'library', owner: null } })
    expect(await patch({ library: false })).toMatchObject({ status: 409, body: { error: 'needs_owner' } })
    expect((await venueRow(hall)).isLibrary).toBe(true)
    expect(await patch({ library: false, ownerUserId: planner.id })).toMatchObject({ status: 200, body: { status: 'private', owner: { id: planner.id } } })
    // A private venue cannot lose its owner.
    expect(await patch({ ownerUserId: null })).toMatchObject({ status: 409, body: { error: 'needs_owner' } })
    const kit = await person({ displayName: 'Kit' })
    expect(await patch({ ownerUserId: kit.id })).toMatchObject({ status: 200, body: { owner: { id: kit.id, displayName: 'Kit' } } })
    expect((await events('venue_owner_changed', { subjectId: hall })).map((e) => e.detail)).toEqual([
      { from: null, to: planner.id },
      { from: planner.id, to: kit.id },
    ])
    // Nothing to change: answered, not logged.
    expect((await patch({ ownerUserId: kit.id })).status).toBe(200)
    expect(await events('venue_owner_changed', { subjectId: hall })).toHaveLength(2)
  })

  it('refuses an owner who is off or unknown, an empty change, and a deleted or unknown venue', async () => {
    const { venue } = await routes()
    const hall = await makeTemplate(await db(), `Spare hall ${randomUUID()}`)
    const off = await person({ displayName: 'Off', disabled: true })
    const patch = (id: string, body: unknown) => callRoute(venue, 'PATCH', { cookie: admin.cookie, params: { id }, body })
    expect(await patch(hall, { ownerUserId: off.id })).toMatchObject({ status: 409, body: { error: 'user_disabled' } })
    expect((await patch(hall, { ownerUserId: randomUUID() })).status).toBe(422)
    expect((await patch(hall, {})).status).toBe(422)
    expect((await patch(randomUUID(), { library: true })).status).toBe(404)
    await (await db()).update(venueTemplates).set({ deletedAt: new Date() }).where(eq(venueTemplates.id, hall))
    expect((await patch(hall, { library: true })).status).toBe(404)
    expect(await venueRow(hall)).toMatchObject({ isLibrary: false, ownerUserId: null })
  })
})
