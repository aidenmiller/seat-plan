/**
 * The wedding and venue route handlers against the test database, signed in
 * with a made-up password, plus the 404 answer every [id] route gives to an
 * id that is not a uuid. (route-auth.test.ts covers the 401 without a cookie.)
 */
import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { TEST_DATABASE_URL } from '../../../../test/db'
import { SITE_COOKIE, createSiteToken } from '@/server/auth/tokens'

beforeAll(() => {
  vi.stubEnv('AUTH_SECRET', 'weddings-route-test-secret-32-chars-plus')
  vi.stubEnv('SITE_PASSWORD', 'weddings-route-made-up-password')
  vi.stubEnv('DATABASE_URL', TEST_DATABASE_URL)
})
afterAll(() => {
  vi.unstubAllEnvs()
})

type Handler = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>

function request(method: string, path: string, body?: unknown): NextRequest {
  const headers: Record<string, string> = { cookie: `${SITE_COOKIE}=${createSiteToken()}` }
  let payload: string | undefined
  if (body !== undefined) {
    headers['content-type'] = 'application/json'
    payload = typeof body === 'string' ? body : JSON.stringify(body)
  }
  return new NextRequest(`https://seat.example${path}`, { method, headers, body: payload })
}

const ctx = (id = '') => ({ params: Promise.resolve({ id }) })

async function call(mod: Record<string, unknown>, method: string, path: string, id?: string, body?: unknown) {
  const res = await (mod[method] as Handler)(request(method, path, body), ctx(id))
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

    // Deleting needs the typed word, exactly.
    expect((await call(one, 'DELETE', `/api/weddings/${id}`, id)).status).toBe(400)
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
        ['editedBy', 'editedById', 'fixedItemCount', 'hasReferenceImage', 'id', 'importedBy', 'name', 'updatedAt', 'usedBy', 'version'].sort(),
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
