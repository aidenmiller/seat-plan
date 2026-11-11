/**
 * The rule route handlers against the test database: create, list, edit,
 * delete, guests from another wedding refused, a removed guest leaves a
 * rule that needs guests, and the couple rule switch on both partners.
 */
import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { TEST_DATABASE_URL } from '../../../../../../test/db'
import { makeUser, sessionCookie } from '../../../../../../test/auth'
import type { StoredRule } from '@/shared/api'

/** A signed-in user's cookie: for now any signed-in user may use these routes. */
let signedIn = ''

beforeAll(async () => {
  vi.stubEnv('AUTH_SECRET', 'rules-route-test-secret-32-chars-plus')
  vi.stubEnv('DATABASE_URL', TEST_DATABASE_URL)
  const database = await db()
  signedIn = await sessionCookie(database, (await makeUser(database)).id)
})
afterAll(() => {
  vi.unstubAllEnvs()
})

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>

async function call(mod: Record<string, unknown>, method: string, params: Record<string, string>, body?: unknown, cookie = true) {
  const headers: Record<string, string> = cookie ? { cookie: signedIn } : {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  const req = new NextRequest('https://seat.example/api/x', { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const res = await (mod[method] as Handler)(req, { params: Promise.resolve(params) })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

async function db() {
  return (await import('@/server/db/client')).getDb()
}

const routes = async () => ({
  list: await import('./route'),
  one: await import('../../../rules/[id]/route'),
  couple: await import('../../../rules/couple/route'),
  guest: await import('../../../guests/[id]/route'),
  guests: await import('../guests/route'),
})

describe('/api/weddings/[id]/rules and /api/rules', () => {
  it('creates, lists, edits and deletes rules', async () => {
    const { makeWedding, makeGuest } = await import('@/server/repo/test-fixtures')
    const { list, one } = await routes()
    const w = await makeWedding(await db())
    const ann = await makeGuest(await db(), w, 'Ann', 'Lee')
    const bob = await makeGuest(await db(), w, 'Bob', 'Adams')
    const cy = await makeGuest(await db(), w, 'Cy', 'Moss')

    expect((await call(list, 'GET', { id: w }, undefined, false)).status).toBe(401)

    const made = await call(list, 'POST', { id: w }, { kind: 'together', guestIds: [ann, bob, ann], nextToEachOther: true, note: 'Old friends' })
    expect(made.status).toBe(201)
    const rule = made.body as StoredRule
    // Repeats dropped, guests by last name.
    expect(rule).toMatchObject({ weddingId: w, kind: 'together', guestIds: [bob, ann], nextToEachOther: true, appliesTo: 'both', enabled: true, note: 'Old friends', needsGuests: false })

    // Two or more guests; next to each other only on together rules.
    expect((await call(list, 'POST', { id: w }, { kind: 'apart', guestIds: [ann] })).status).toBe(422)
    expect((await call(list, 'POST', { id: w }, { kind: 'apart', guestIds: [ann, cy], nextToEachOther: true })).status).toBe(422)
    // A guest of another wedding is refused.
    const other = await makeWedding(await db())
    const stranger = await makeGuest(await db(), other)
    expect((await call(list, 'POST', { id: w }, { kind: 'apart', guestIds: [ann, stranger] })).status).toBe(422)

    const apart = (await call(list, 'POST', { id: w }, { kind: 'apart', guestIds: [ann, cy], appliesTo: 'reception' })).body as StoredRule
    const all = await call(list, 'GET', { id: w })
    expect(all.body.map((r: StoredRule) => r.id)).toEqual([rule.id, apart.id])

    // A retried create with the same id gives the same rule back.
    const id = randomUUID()
    const first = await call(list, 'POST', { id: w }, { id, kind: 'apart', guestIds: [bob, cy] })
    const retry = await call(list, 'POST', { id: w }, { id, kind: 'apart', guestIds: [bob, cy] })
    expect(retry).toMatchObject({ status: 201, body: { id, createdAt: first.body.createdAt } })

    // Edit: guests replaced, turning it apart clears next to each other.
    const edited = await call(one, 'PATCH', { id: rule.id }, { guestIds: [ann, bob, cy], enabled: false })
    expect(edited.body).toMatchObject({ guestIds: [bob, ann, cy], enabled: false })
    const flipped = await call(one, 'PATCH', { id: rule.id }, { kind: 'apart' })
    expect(flipped.body).toMatchObject({ kind: 'apart', nextToEachOther: false })
    expect((await call(one, 'PATCH', { id: rule.id }, { nextToEachOther: true })).status).toBe(422)
    expect((await call(one, 'PATCH', { id: rule.id }, {})).status).toBe(422)
    expect((await call(one, 'PATCH', { id: randomUUID() }, { enabled: true })).status).toBe(404)

    expect((await call(one, 'DELETE', { id: rule.id })).status).toBe(200)
    expect((await call(one, 'DELETE', { id: rule.id })).status).toBe(404)
    expect((await call(list, 'GET', { id: w })).body.map((r: StoredRule) => r.id)).toEqual([apart.id, id])
    expect((await call(list, 'GET', { id: randomUUID() })).status).toBe(404)
  })

  it('keeps a rule whose guest was removed, as needing guests', async () => {
    const { makeWedding, makeGuest } = await import('@/server/repo/test-fixtures')
    const { list, guest } = await routes()
    const w = await makeWedding(await db())
    const ann = await makeGuest(await db(), w, 'Ann', 'Lee')
    const bob = await makeGuest(await db(), w, 'Bob', 'Adams')
    const rule = (await call(list, 'POST', { id: w }, { kind: 'apart', guestIds: [ann, bob] })).body as StoredRule
    expect((await call(guest, 'DELETE', { id: bob })).status).toBe(200)
    const [after] = (await call(list, 'GET', { id: w })).body as StoredRule[]
    expect(after).toMatchObject({ id: rule.id, guestIds: [ann], needsGuests: true })
  })

  it('switches a couple rule on both partners, and refuses a pair that is not linked', async () => {
    const { makeWedding, makeGuest } = await import('@/server/repo/test-fixtures')
    const { couple, guest } = await routes()
    const w = await makeWedding(await db())
    const ann = await makeGuest(await db(), w, 'Ann', 'Lee')
    const bob = await makeGuest(await db(), w, 'Bob', 'Lee')
    const cy = await makeGuest(await db(), w, 'Cy', 'Moss')
    expect((await call(guest, 'PATCH', { id: ann }, { partnerId: bob })).status).toBe(200)

    const off = await call(couple, 'PATCH', {}, { guestIds: [bob, ann], enabled: false })
    expect(off.status).toBe(200)
    expect(off.body.guests.map((g: { id: string; coupleRuleEnabled: boolean }) => [g.id, g.coupleRuleEnabled])).toEqual([
      [bob, false],
      [ann, false],
    ])
    const on = await call(couple, 'PATCH', {}, { guestIds: [ann, bob], enabled: true })
    expect(on.body.guests.every((g: { coupleRuleEnabled: boolean }) => g.coupleRuleEnabled)).toBe(true)

    const notLinked = await call(couple, 'PATCH', {}, { guestIds: [ann, cy], enabled: false })
    expect(notLinked.status).toBe(409)
    expect(notLinked.body.error).toBe('conflict')
    expect((await call(couple, 'PATCH', {}, { guestIds: [ann, ann], enabled: false })).status).toBe(422)
    expect((await call(couple, 'PATCH', {}, { guestIds: [randomUUID(), ann], enabled: false })).status).toBe(404)
  })
})
