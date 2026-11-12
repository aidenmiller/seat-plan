/**
 * The group route handlers against the test database: create with palette
 * colors, names unique ignoring case, rename and recolor, bulk add members
 * (repeats skipped, other weddings' guests refused), remove a member, and
 * delete outright.
 */
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { TEST_DATABASE_URL } from '../../../../../../test/db'
import { makeUser, makeWeddingFor, sessionCookie } from '../../../../../../test/auth'
import type { Db } from '@/server/locks'
import { GROUP_COLORS } from '@/domain/group-colors'
import type { Group } from '@/shared/api'

/** The cookie of the user every test acts as: the owner of each wedding it makes. */
let signedIn = ''
let me = ''

/** A wedding the signed-in user owns (routes answer 404 to anyone who is not a member). */
const makeWedding = (database: Db, name?: string) => makeWeddingFor(database, me, name)

beforeAll(async () => {
  vi.stubEnv('AUTH_SECRET', 'groups-route-test-secret-32-chars-plus')
  vi.stubEnv('DATABASE_URL', TEST_DATABASE_URL)
  const database = await db()
  me = (await makeUser(database)).id
  signedIn = await sessionCookie(database, me)
})
afterAll(() => {
  vi.unstubAllEnvs()
})

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>

async function call(mod: Record<string, unknown>, method: string, params: Record<string, string>, body?: unknown) {
  const headers: Record<string, string> = { cookie: signedIn }
  if (body !== undefined) headers['content-type'] = 'application/json'
  const req = new NextRequest('https://seat.example/api/x', {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
  const res = await (mod[method] as Handler)(req, { params: Promise.resolve(params) })
  const text = await res.text()
  return { status: res.status, cache: res.headers.get('cache-control'), body: text ? JSON.parse(text) : null }
}

async function db() {
  return (await import('@/server/db/client')).getDb()
}

const routes = async () => ({
  list: await import('./route'),
  one: await import('../../../groups/[id]/route'),
  members: await import('../../../groups/[id]/members/route'),
  member: await import('../../../groups/[id]/members/[guestId]/route'),
  guests: await import('../guests/route'),
})

describe('/api/weddings/[id]/groups and /api/groups', () => {
  it('creates groups with cycling palette colors and refuses a name already used, ignoring case', async () => {
    const { list, one } = await routes()
    const w = await makeWedding(await db())

    const made: Group[] = []
    for (const name of ['Noa Family', 'Aiden HS Friends', 'Book Club']) {
      const res = await call(list, 'POST', { id: w }, { name })
      expect(res.status).toBe(201)
      expect(res.cache).toBe('no-store')
      made.push(res.body)
    }
    expect(made.map((g) => g.color)).toEqual(GROUP_COLORS.slice(0, 3))
    expect(made[0]).toMatchObject({ weddingId: w, name: 'Noa Family', memberIds: [] })

    const dupe = await call(list, 'POST', { id: w }, { name: '  noa FAMILY ' })
    expect(dupe.status).toBe(409)
    expect(dupe.body).toEqual({ error: 'name_taken', message: 'A group with that name already exists.' })
    // Another wedding may use the same name.
    const other = await makeWedding(await db())
    expect((await call(list, 'POST', { id: other }, { name: 'Noa Family' })).status).toBe(201)

    expect((await call(list, 'POST', { id: w }, { name: '' })).status).toBe(422)
    expect((await call(list, 'POST', { id: w }, { name: 'X', color: 'red' })).status).toBe(422)
    // A ";" would split the group in two on a CSV round trip (review finding).
    const semi = await call(list, 'POST', { id: w }, { name: 'Work; Gym' })
    expect(semi).toMatchObject({ status: 422, body: { issues: ['name: Group names cannot hold a semicolon'] } })
    // A name in decomposed form is stored composed (NFC).
    const nfd = await call(list, 'POST', { id: w }, { name: 'Zoe\u0308 friends' })
    expect(nfd.body.name).toBe('Zo\u00eb friends')
    expect((await call(one, 'DELETE', { id: nfd.body.id })).status).toBe(200)
    const colored = await call(list, 'POST', { id: w }, { name: 'Work Friends', color: '#0f766e' })
    expect(colored.body.color).toBe('#0F766E')

    // A deleted group's color is the first one offered again.
    expect((await call(one, 'DELETE', { id: made[1]!.id })).status).toBe(200)
    expect((await call(list, 'POST', { id: w }, { name: 'Cousins' })).body.color).toBe(GROUP_COLORS[1])

    const all = await call(list, 'GET', { id: w })
    expect(all.body.map((g: Group) => g.name)).toEqual(['Book Club', 'Cousins', 'Noa Family', 'Work Friends'])

    // A retried create with the same id gives the same group back.
    const id = randomUUID()
    const first = await call(list, 'POST', { id: w }, { id, name: 'Neighbors' })
    const retry = await call(list, 'POST', { id: w }, { id, name: 'Neighbors' })
    expect(retry).toMatchObject({ status: 201, body: { id, name: 'Neighbors', color: first.body.color } })
    expect((await call(list, 'POST', { id: other }, { id, name: 'Neighbors' })).status).toBe(409)

    expect((await call(list, 'GET', { id: 'nope' })).status).toBe(404)
    expect((await call(list, 'GET', { id: randomUUID() })).status).toBe(404)
  })

  it('renames and recolors, refusing a rename onto another group name', async () => {
    const { list, one } = await routes()
    const w = await makeWedding(await db())
    const a = (await call(list, 'POST', { id: w }, { name: 'Noa Family' })).body as Group
    await call(list, 'POST', { id: w }, { name: 'Aiden Family' })

    expect((await call(one, 'PATCH', { id: a.id }, {})).status).toBe(422)
    expect((await call(one, 'PATCH', { id: a.id }, { name: 'Noa; Family' })).status).toBe(422)
    expect((await call(one, 'PATCH', { id: a.id }, { name: 'AIDEN family' })).status).toBe(409)
    // Changing only the case of its own name is fine.
    expect((await call(one, 'PATCH', { id: a.id }, { name: 'NOA Family' })).body.name).toBe('NOA Family')
    const recolored = await call(one, 'PATCH', { id: a.id }, { name: 'Noa Cousins', color: '#DB2777' })
    expect(recolored).toMatchObject({ status: 200, body: { id: a.id, name: 'Noa Cousins', color: '#DB2777' } })

    expect((await call(one, 'PATCH', { id: randomUUID() }, { name: 'X' })).status).toBe(404)
    expect((await call(one, 'PATCH', { id: 'nope' }, { name: 'X' })).status).toBe(404)
  })

  it('adds members in bulk, skips repeats, refuses guests of another wedding, removes one, deletes the group', async () => {
    const { makeGuest } = await import('@/server/repo/test-fixtures')
    const { removeGuests } = await import('@/server/repo/guests')
    const { groupMembers } = await import('@/server/db/schema')
    const { list, one, members, member, guests } = await routes()
    const d = await db()
    const w = await makeWedding(d)
    const [ann, ben, cy] = [await makeGuest(d, w, 'Ann'), await makeGuest(d, w, 'Ben'), await makeGuest(d, w, 'Cy')]
    const other = await makeWedding(d)
    const stranger = await makeGuest(d, other, 'Stranger')

    const g = (await call(list, 'POST', { id: w }, { name: 'Book Club', guestIds: [ann] })).body as Group
    expect(g.memberIds).toEqual([ann])

    const added = await call(members, 'POST', { id: g.id }, { guestIds: [ann, ben, cy, ben] })
    expect(added.status).toBe(200)
    expect(added.body.added.sort()).toEqual([ben, cy].sort())
    expect(added.body.group.memberIds.sort()).toEqual([ann, ben, cy].sort())
    expect((await call(members, 'POST', { id: g.id }, { guestIds: [ann] })).body.added).toEqual([])

    // A guest of another wedding cannot join, and refuses the whole request.
    const foreign = await call(members, 'POST', { id: g.id }, { guestIds: [stranger] })
    expect(foreign.status).toBe(422)
    expect(foreign.body.issues[0]).toMatch(/^guestIds: /)
    const fresh = await makeGuest(d, w, 'Dee')
    expect((await call(members, 'POST', { id: g.id }, { guestIds: [fresh, stranger] })).status).toBe(422)
    const rows = await d.select().from(groupMembers).where(eq(groupMembers.groupId, g.id))
    expect(rows.map((r) => r.guestId)).not.toContain(fresh)
    expect((await call(list, 'POST', { id: w }, { name: 'Mixed', guestIds: [stranger] })).status).toBe(422)
    expect((await call(list, 'GET', { id: w })).body.map((x: Group) => x.name)).toEqual(['Book Club'])
    // A removed guest cannot join either, and no longer counts as a member.
    await removeGuests(d, w, [cy])
    expect((await call(members, 'POST', { id: g.id }, { guestIds: [cy] })).status).toBe(422)
    expect((await call(list, 'GET', { id: w })).body[0].memberIds.sort()).toEqual([ann, ben].sort())

    expect((await call(members, 'POST', { id: g.id }, { guestIds: [] })).status).toBe(422)
    expect((await call(members, 'POST', { id: randomUUID() }, { guestIds: [ann] })).status).toBe(404)

    const without = await call(member, 'DELETE', { id: g.id, guestId: ann })
    expect(without).toMatchObject({ status: 200, body: { id: g.id, memberIds: [ben] } })
    expect((await call(member, 'DELETE', { id: g.id, guestId: ann })).status).toBe(200)
    expect((await call(member, 'DELETE', { id: g.id, guestId: 'nope' })).status).toBe(404)
    expect((await call(member, 'DELETE', { id: randomUUID(), guestId: ann })).status).toBe(404)

    // The guests list shows group ids.
    const guestList = (await call(guests, 'GET', { id: w })).body as { id: string; groupIds: string[] }[]
    expect(guestList.find((x) => x.id === ben)!.groupIds).toEqual([g.id])

    expect((await call(one, 'DELETE', { id: g.id })).status).toBe(200)
    expect(await d.select().from(groupMembers).where(eq(groupMembers.groupId, g.id))).toEqual([])
    expect((await call(guests, 'GET', { id: w })).body.find((x: { id: string }) => x.id === ben).groupIds).toEqual([])
    expect((await call(one, 'DELETE', { id: g.id })).status).toBe(404)
  })

  it('hides groups of a deleted wedding', async () => {
    const { weddings } = await import('@/server/db/schema')
    const { list, one, members } = await routes()
    const d = await db()
    const w = await makeWedding(d)
    const g = (await call(list, 'POST', { id: w }, { name: 'Gone soon' })).body as Group
    await d.update(weddings).set({ deletedAt: new Date() }).where(eq(weddings.id, w))
    expect((await call(list, 'GET', { id: w })).status).toBe(404)
    expect((await call(list, 'POST', { id: w }, { name: 'New' })).status).toBe(404)
    expect((await call(one, 'PATCH', { id: g.id }, { name: 'X' })).status).toBe(404)
    expect((await call(members, 'POST', { id: g.id }, { guestIds: [randomUUID()] })).status).toBe(404)
    expect((await call(one, 'DELETE', { id: g.id })).status).toBe(404)
  })
})
