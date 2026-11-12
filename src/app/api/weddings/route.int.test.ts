/**
 * The wedding and venue route handlers against the test database, signed in
 * as a test user, plus the 404 answer every [id] route gives to an
 * id that is not a uuid. Also: the creator of a wedding is its owner, the
 * list holds only the caller's weddings, and an editor may not change the
 * settings, delete or back up. (route-auth.test.ts covers the 401 without a
 * cookie; src/server/auth/isolation.int.test.ts covers everyone else.)
 */
import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { TEST_DATABASE_URL } from '../../../../test/db'
import { makeMember, makeUser, makeWeddingFor, sessionCookie } from '../../../../test/auth'

async function db() {
  return (await import('@/server/db/client')).getDb()
}

/** The cookie of the user every test acts as: the owner of each wedding it makes. */
let signedIn = ''
let me = ''

beforeAll(async () => {
  vi.stubEnv('AUTH_SECRET', 'weddings-route-test-secret-32-chars-plus')
  vi.stubEnv('DATABASE_URL', TEST_DATABASE_URL)
  const database = await db()
  me = (await makeUser(database)).id
  signedIn = await sessionCookie(database, me)
})
afterAll(() => {
  vi.unstubAllEnvs()
})

type Handler = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>

function request(method: string, path: string, body?: unknown, cookie = signedIn): NextRequest {
  const headers: Record<string, string> = { cookie }
  let payload: string | undefined
  if (body !== undefined) {
    headers['content-type'] = 'application/json'
    payload = typeof body === 'string' ? body : JSON.stringify(body)
  }
  return new NextRequest(`https://seat.example${path}`, { method, headers, body: payload })
}

const ctx = (id = '') => ({ params: Promise.resolve({ id }) })

async function call(mod: Record<string, unknown>, method: string, path: string, id?: string, body?: unknown, cookie = signedIn) {
  const res = await (mod[method] as Handler)(request(method, path, body, cookie), ctx(id))
  const text = await res.text()
  return { status: res.status, cache: res.headers.get('cache-control'), body: text ? JSON.parse(text) : null }
}

describe('/api/weddings', () => {
  it('creates, lists, reads, updates, summarises and deletes a wedding', async () => {
    const list = await import('./route')
    const one = await import('./[id]/route')
    const summary = await import('./[id]/delete-summary/route')
    const layouts = await import('./[id]/layouts/route')

    expect((await call(list, 'POST', '/api/weddings', undefined, 'not json')).status).toBe(400)
    const blank = await call(list, 'POST', '/api/weddings', undefined, { name: '   ' })
    expect(blank.status).toBe(422)
    expect(blank.body).toMatchObject({ error: 'invalid' })
    expect(blank.body.issues[0]).toMatch(/^name: /)

    const created = await call(list, 'POST', '/api/weddings', undefined, { name: 'Noa & Aiden', date: '2027-06-12' })
    expect(created.status).toBe(201)
    expect(created.cache).toBe('no-store')
    expect(created.body).toMatchObject({ name: 'Noa & Aiden', date: '2027-06-12', unit: 'ft', partner1Name: null, partner2Name: null, guestCount: 0, layoutCount: 0 })
    const id = created.body.id as string

    const all = await call(list, 'GET', '/api/weddings')
    expect(all.status).toBe(200)
    expect(all.cache).toBe('no-store')
    expect(all.body.find((w: { id: string }) => w.id === id)).toMatchObject({ name: 'Noa & Aiden' })

    expect((await call(one, 'GET', `/api/weddings/${id}`, id)).body).toMatchObject({ id, name: 'Noa & Aiden' })
    const patched = await call(one, 'PATCH', `/api/weddings/${id}`, id, { unit: 'm', minGapCm: 120 })
    expect(patched).toMatchObject({ status: 200, body: { unit: 'm', minGapCm: 120 } })
    expect((await call(one, 'PATCH', `/api/weddings/${id}`, id, {})).status).toBe(422)

    const madeLayout = await call(layouts, 'POST', `/api/weddings/${id}/layouts`, id, {
      name: 'Dinner',
      kind: 'reception',
      venueTemplateId: null,
      editedBy: 'Noa',
    })
    expect(madeLayout.status).toBe(201)
    expect((await call(summary, 'GET', `/api/weddings/${id}/delete-summary`, id)).body).toEqual({
      kind: 'wedding',
      name: 'Noa & Aiden',
      layouts: 1,
      guests: 0,
      groups: 0,
      rules: 0,
    })

    // Deleting needs the typed word, exactly, sent as JSON.
    expect((await call(one, 'DELETE', `/api/weddings/${id}`, id)).status).toBe(415)
    expect((await call(one, 'DELETE', `/api/weddings/${id}`, id, 'not json')).status).toBe(400)
    expect((await call(one, 'DELETE', `/api/weddings/${id}`, id, {})).status).toBe(422)
    expect((await call(one, 'DELETE', `/api/weddings/${id}`, id, { confirm: 'Delete' })).status).toBe(422)
    expect((await call(one, 'GET', `/api/weddings/${id}`, id)).status).toBe(200)
    expect(await call(one, 'DELETE', `/api/weddings/${id}`, id, { confirm: 'delete' })).toMatchObject({
      status: 200,
      body: { ok: true },
    })

    expect((await call(one, 'GET', `/api/weddings/${id}`, id)).status).toBe(404)
    expect((await call(layouts, 'GET', `/api/weddings/${id}/layouts`, id)).status).toBe(404)
    expect((await call(summary, 'GET', `/api/weddings/${id}/delete-summary`, id)).status).toBe(404)
    expect((await call(one, 'DELETE', `/api/weddings/${id}`, id, { confirm: 'delete' })).status).toBe(404)
    const layoutRoute = await import('../layouts/[id]/route')
    expect((await call(layoutRoute, 'GET', `/api/layouts/${madeLayout.body.id}`, madeLayout.body.id)).status).toBe(404)
  })

  it("keeps the partners' names: set at creation, changed or cleared in settings", async () => {
    const list = await import('./route')
    const one = await import('./[id]/route')
    const created = await call(list, 'POST', '/api/weddings', undefined, { name: 'Sam & Alex', partner1Name: '  Sam ', partner2Name: 'Alex' })
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ partner1Name: 'Sam', partner2Name: 'Alex' })
    const id = created.body.id as string

    const renamed = await call(one, 'PATCH', `/api/weddings/${id}`, id, { partner1Name: 'Samira' })
    expect(renamed).toMatchObject({ status: 200, body: { partner1Name: 'Samira', partner2Name: 'Alex' } })
    const cleared = await call(one, 'PATCH', `/api/weddings/${id}`, id, { partner2Name: '' })
    expect(cleared.body).toMatchObject({ partner1Name: 'Samira', partner2Name: null })
    expect((await call(one, 'GET', `/api/weddings/${id}`, id)).body).toMatchObject({ partner1Name: 'Samira', partner2Name: null })

    const tooLong = await call(one, 'PATCH', `/api/weddings/${id}`, id, { partner1Name: 'x'.repeat(61) })
    expect(tooLong.status).toBe(422)
    expect(tooLong.body.issues[0]).toMatch(/^partner1Name: /)
  })

  it('a wedding id that is unknown gives 404', async () => {
    const one = await import('./[id]/route')
    const id = randomUUID()
    expect((await call(one, 'GET', `/api/weddings/${id}`, id)).status).toBe(404)
    expect((await call(one, 'PATCH', `/api/weddings/${id}`, id, { name: 'X' })).status).toBe(404)
  })

  it('makes the creator the owner; lists only the caller weddings; an id someone else holds is 409 with nothing about it', async () => {
    const list = await import('./route')
    const { weddingMembers } = await import('@/server/db/schema')
    const { eq } = await import('drizzle-orm')
    const database = await db()
    const id = randomUUID()
    expect((await call(list, 'POST', '/api/weddings', undefined, { id, name: 'Ours' })).status).toBe(201)
    expect(await database.select({ userId: weddingMembers.userId, role: weddingMembers.role }).from(weddingMembers).where(eq(weddingMembers.weddingId, id))).toEqual([
      { userId: me, role: 'owner' },
    ])
    // A retry gives it back.
    expect(await call(list, 'POST', '/api/weddings', undefined, { id, name: 'Ours again' })).toMatchObject({ status: 201, body: { id, name: 'Ours' } })

    const someone = await makeUser(database)
    const theirCookie = await sessionCookie(database, someone.id)
    const taken = await call(list, 'POST', '/api/weddings', undefined, { id, name: 'Theirs' }, theirCookie)
    expect(taken).toEqual({ status: 409, cache: 'no-store', body: { error: 'id_taken' } })
    expect(((await call(list, 'GET', '/api/weddings', undefined, undefined, theirCookie)).body as { id: string }[]).map((w) => w.id)).not.toContain(id)
    expect(((await call(list, 'GET', '/api/weddings')).body as { id: string }[]).map((w) => w.id)).toContain(id)
    const theirs = await makeWeddingFor(database, someone.id, 'Theirs')
    expect(((await call(list, 'GET', '/api/weddings')).body as { id: string }[]).map((w) => w.id)).not.toContain(theirs)
  })

  it('lets an editor read and work in a wedding, but not change its settings, delete it or download a backup', async () => {
    const one = await import('./[id]/route')
    const summary = await import('./[id]/delete-summary/route')
    const backup = await import('./[id]/backup/route')
    const layouts = await import('./[id]/layouts/route')
    const database = await db()
    const owner = await makeUser(database)
    const w = await makeWeddingFor(database, owner.id, 'Owned elsewhere')
    await makeMember(database, w, me, 'editor')

    expect((await call(one, 'GET', `/api/weddings/${w}`, w)).status).toBe(200)
    expect((await call(layouts, 'GET', `/api/weddings/${w}/layouts`, w)).status).toBe(200)
    expect(await call(one, 'PATCH', `/api/weddings/${w}`, w, { name: 'Mine now' })).toMatchObject({ status: 403, body: { error: 'forbidden' } })
    expect((await call(one, 'DELETE', `/api/weddings/${w}`, w, { confirm: 'delete' })).status).toBe(403)
    expect((await call(summary, 'GET', `/api/weddings/${w}/delete-summary`, w)).status).toBe(403)
    expect((await call(backup, 'GET', `/api/weddings/${w}/backup`, w)).status).toBe(403)
    expect((await call(one, 'GET', `/api/weddings/${w}`, w)).body).toMatchObject({ name: 'Owned elsewhere' })
  })
})

describe('/api/venues', () => {
  it('lists live templates with how many layouts use them', async () => {
    const venues = await import('../venues/route')
    const res = await call(venues, 'GET', '/api/venues')
    expect(res.status).toBe(200)
    expect(res.cache).toBe('no-store')
    expect(Array.isArray(res.body)).toBe(true)
    for (const v of res.body) {
      expect(Object.keys(v).sort()).toEqual(
        [
          'access',
          'canEdit',
          'editedBy',
          'editedById',
          'fixedItemCount',
          'hasReferenceImage',
          'id',
          'importedBy',
          'name',
          'ownerName',
          'updatedAt',
          'usedBy',
          'version',
        ].sort(),
      )
    }
  })
})

describe('[id] routes answer 404 to an id that is not a uuid', () => {
  const routes: [string, () => Promise<Record<string, unknown>>][] = [
    ['weddings/[id]', () => import('./[id]/route')],
    ['weddings/[id]/delete-summary', () => import('./[id]/delete-summary/route')],
    ['weddings/[id]/layouts', () => import('./[id]/layouts/route')],
    ['layouts/[id]', () => import('../layouts/[id]/route')],
    ['layouts/[id]/version', () => import('../layouts/[id]/version/route')],
    ['layouts/[id]/duplicate', () => import('../layouts/[id]/duplicate/route')],
    ['layouts/[id]/delete-summary', () => import('../layouts/[id]/delete-summary/route')],
  ]
  for (const [name, load] of routes) {
    it(name, async () => {
      const mod = await load()
      const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].filter((m) => typeof mod[m] === 'function')
      expect(methods.length).toBeGreaterThan(0)
      for (const method of methods) {
        for (const bad of ['nope', '1', `${randomUUID()}x`, "'; drop table layouts; --"]) {
          const body = method === 'GET' ? undefined : { confirm: 'delete' }
          const res = await call(mod, method, `/api/${name}`, bad, body)
          expect(res.status, `${method} ${name} ${bad}`).toBe(404)
          expect(res.body).toEqual({ error: 'not_found' })
        }
      }
    })
  }
})
