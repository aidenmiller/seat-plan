/**
 * Venue share links against the test database, through the route handlers:
 * make a link, sign in with its own password, read the layout's data, and
 * the sign-outs (spec section 2): a new password or turning the link off
 * signs out anyone using it. Also: a share cookie never passes as the site
 * cookie, the site cookie opens every link, and the data hides names and notes
 * when the link says so (PLAN change 24). The wrong-guess delay is off here.
 */
import { randomBytes } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TEST_DATABASE_URL } from '../../../test/db'
import type { ChairRow, Note } from '@/domain/canvas-schema'
import { DEFAULT_RIGHT_LABEL, generateSeatingBlock } from '@/domain/ceremony'
import { SITE_COOKIE, createSiteToken } from '@/server/auth/tokens'
import { canvasOf, makeGuest, makeLayout, makeWedding, roundTable } from '@/server/repo/test-fixtures'
import type { ShareLink, ShareView } from '@/shared/api'

vi.mock('@/server/auth/throttle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/auth/throttle')>()),
  wrongGuessDelay: async () => {},
}))

beforeAll(() => {
  vi.stubEnv('AUTH_SECRET', 'share-links-int-test-secret-32-chars-plus')
  vi.stubEnv('SITE_PASSWORD', 'share-links-int-made-up-password')
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

type Params = Record<string, string>
type Handler = (req: NextRequest, ctx: { params: Promise<Params> }) => Promise<Response>

/** Calls a handler. `cookies` replaces the site cookie the site routes get by default. */
async function send(
  mod: Record<string, unknown>,
  method: string,
  url: string,
  params: Params,
  opts: { body?: unknown; cookies?: Record<string, string>; ip?: string } = {},
) {
  const headers: Record<string, string> = { 'x-real-ip': opts.ip ?? '203.0.113.50' }
  const cookies = opts.cookies ?? { [SITE_COOKIE]: createSiteToken() }
  const jar = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
  if (jar) headers.cookie = jar
  let body: string | undefined
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }
  const res = await (mod[method] as Handler)(new NextRequest(`https://seat.example${url}`, { method, headers, body }), {
    params: Promise.resolve(params),
  })
  const text = await res.text()
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null, text }
}

const routes = {
  layoutLinks: () => import('../api/layouts/[id]/share-links/route'),
  weddingLinks: () => import('../api/weddings/[id]/share-links/route'),
  link: () => import('../api/share-links/[id]/route'),
  weddings: () => import('../api/weddings/route'),
  login: () => import('./[token]/login/route'),
  data: () => import('./[token]/data/route'),
}

/** A wedding with Ann seated at a table and a private note on the plan. */
async function setup() {
  const database = await db()
  const weddingId = await makeWedding(database, 'Share test')
  const ann = await makeGuest(database, weddingId, 'Annabel', 'Quist')
  const note: Note = {
    id: 'n1',
    kind: 'note',
    x: 0,
    y: 0,
    rotation: 0,
    locked: false,
    type: 'sticky',
    width: 100,
    height: 100,
    text: 'Keep Uncle Bob away from the bar',
    color: 'yellow',
    author: 'Noa',
    done: false,
    createdAt: '2026-11-10T10:00:00.000Z',
    attachedTo: { start: null, end: null },
  }
  const layoutId = await makeLayout(database, weddingId, canvasOf(roundTable('t1', 1, [ann, null]), note), { name: 'Dinner' })
  return { weddingId, layoutId, ann }
}

async function makeLink(layoutId: string, body: Record<string, unknown>): Promise<{ link: ShareLink; token: string }> {
  const res = await send(await routes.layoutLinks(), 'POST', `/api/layouts/${layoutId}/share-links`, { id: layoutId }, { body })
  expect(res.status).toBe(201)
  const link = res.body as ShareLink
  return { link, token: link.path.replace('/share/', '') }
}

async function login(token: string, password: string, ip?: string) {
  return send(await routes.login(), 'POST', `/share/${token}/login`, { token }, { body: { password }, cookies: {}, ip })
}

/** The share cookie a sign-in set, as name and value. */
function cookieOf(res: { headers: Headers }): { name: string; value: string; raw: string } {
  const raw = res.headers.get('set-cookie') ?? ''
  const [pair = ''] = raw.split(';')
  const eq = pair.indexOf('=')
  return { name: pair.slice(0, eq), value: pair.slice(eq + 1), raw }
}

async function data(token: string, cookies: Record<string, string>) {
  return send(await routes.data(), 'GET', `/share/${token}/data`, { token }, { cookies })
}

describe('share links', () => {
  it('makes a link, signs in with its own password, and reads only that layout', async () => {
    const { weddingId, layoutId } = await setup()
    const { link, token } = await makeLink(layoutId, { label: 'Caterer', password: 'caterer-pass' })
    expect(link).toMatchObject({ label: 'Caterer', layoutId, layoutName: 'Dinner', showNames: true, showNotes: false, enabled: true, lastOpenedAt: null })
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(JSON.stringify(link)).not.toContain('caterer-pass')
    const stored = await (await db()).execute<{ password_hash: string }>(sql`select password_hash from share_links where id = ${link.id}`)
    expect(stored.rows[0]!.password_hash).toMatch(/^\$argon2id\$/)

    // Listed for the layout and the wedding.
    const forLayout = await send(await routes.layoutLinks(), 'GET', `/api/layouts/${layoutId}/share-links`, { id: layoutId })
    expect(forLayout.body.map((l: ShareLink) => l.id)).toEqual([link.id])
    const forWedding = await send(await routes.weddingLinks(), 'GET', `/api/weddings/${weddingId}/share-links`, { id: weddingId })
    expect(forWedding.body.map((l: ShareLink) => l.id)).toEqual([link.id])

    // No cookie: no data. The wrong password: no cookie.
    expect((await data(token, {})).status).toBe(401)
    const wrong = await login(token, 'not-it')
    expect(wrong.status).toBe(401)
    expect(wrong.headers.get('set-cookie')).toBeNull()
    expect(wrong.headers.get('referrer-policy')).toBe('no-referrer')

    // The right password sets this link's cookie on its own path, for 30 days.
    const right = await login(token, 'caterer-pass')
    expect(right.status).toBe(200)
    expect(right.headers.get('referrer-policy')).toBe('no-referrer')
    const cookie = cookieOf(right)
    expect(cookie.name).toBe(`sp_share_${link.id}`)
    expect(cookie.raw).toContain(`Path=/share/${token}`)
    expect(cookie.raw).toMatch(/HttpOnly/i)
    expect(cookie.raw).toMatch(/Secure/i)
    expect(cookie.raw).toMatch(/SameSite=lax/i)
    expect(cookie.raw).toMatch(/Max-Age=2592000/)

    const view = await data(token, { [cookie.name]: cookie.value })
    expect(view.status).toBe(200)
    expect(view.headers.get('referrer-policy')).toBe('no-referrer')
    expect(view.headers.get('cache-control')).toBe('no-store')
    expect(view.body as ShareView).toMatchObject({ weddingName: 'Share test', layoutName: 'Dinner', kind: 'reception', showNames: true, showNotes: false })

    // Opening it counts as opened.
    const after = await send(await routes.layoutLinks(), 'GET', `/api/layouts/${layoutId}/share-links`, { id: layoutId })
    expect(after.body[0].lastOpenedAt).not.toBeNull()
  })

  it('signs the viewer out when the password changes, and again when the link is turned off', async () => {
    const { layoutId } = await setup()
    const { link, token } = await makeLink(layoutId, { password: 'first-pass' })
    const first = cookieOf(await login(token, 'first-pass'))
    expect((await data(token, { [first.name]: first.value })).status).toBe(200)

    const changed = await send(await routes.link(), 'PATCH', `/api/share-links/${link.id}`, { id: link.id }, { body: { password: 'second-pass' } })
    expect(changed.status).toBe(200)
    const signedOut = await data(token, { [first.name]: first.value })
    expect(signedOut.status).toBe(401)
    // The stale cookie is cleared.
    expect(signedOut.headers.get('set-cookie')).toMatch(new RegExp(`^${first.name}=;`))
    expect((await login(token, 'first-pass')).status).toBe(401)

    const second = cookieOf(await login(token, 'second-pass'))
    expect((await data(token, { [second.name]: second.value })).status).toBe(200)

    const off = await send(await routes.link(), 'PATCH', `/api/share-links/${link.id}`, { id: link.id }, { body: { enabled: false } })
    expect(off.body).toMatchObject({ enabled: false })
    expect((await data(token, { [second.name]: second.value })).status).toBe(401)
    expect((await login(token, 'second-pass')).status).toBe(401)
    // The site cookie does not open a link that is off either, and the lists leave it out.
    expect((await data(token, { [SITE_COOKIE]: createSiteToken() })).status).toBe(401)
    const listed = await send(await routes.layoutLinks(), 'GET', `/api/layouts/${layoutId}/share-links`, { id: layoutId })
    expect(listed.body).toEqual([])

    // Turned back on, the old cookie still does not work: the viewer signs in again.
    await send(await routes.link(), 'PATCH', `/api/share-links/${link.id}`, { id: link.id }, { body: { enabled: true } })
    expect((await data(token, { [second.name]: second.value })).status).toBe(401)
    expect((await login(token, 'second-pass')).status).toBe(200)
  })

  it('never takes a share cookie as the site cookie', async () => {
    const { layoutId } = await setup()
    const { link, token } = await makeLink(layoutId, { password: 'venue-pass' })
    const share = cookieOf(await login(token, 'venue-pass'))
    const asSite = { [SITE_COOKIE]: share.value }
    expect((await send(await routes.weddings(), 'GET', '/api/weddings', {}, { cookies: asSite })).status).toBe(401)
    expect((await send(await routes.layoutLinks(), 'GET', `/api/layouts/${layoutId}/share-links`, { id: layoutId }, { cookies: asSite })).status).toBe(401)
    const patch = await send(await routes.link(), 'PATCH', `/api/share-links/${link.id}`, { id: link.id }, { body: { showNotes: true }, cookies: asSite })
    expect(patch.status).toBe(401)
    // Nor under its own name for another link's routes.
    expect((await send(await routes.weddings(), 'GET', '/api/weddings', {}, { cookies: { [share.name]: share.value } })).status).toBe(401)
  })

  it('opens every link with the site cookie, without counting as opened', async () => {
    const { layoutId } = await setup()
    const { token } = await makeLink(layoutId, { password: 'venue-pass' })
    const view = await data(token, { [SITE_COOKIE]: createSiteToken() })
    expect(view.status).toBe(200)
    const listed = await send(await routes.layoutLinks(), 'GET', `/api/layouts/${layoutId}/share-links`, { id: layoutId })
    expect(listed.body[0].lastOpenedAt).toBeNull()
  })

  it('hides guest names and notes when they are off, and shows them when on', async () => {
    const { layoutId } = await setup()
    const { link, token } = await makeLink(layoutId, { password: 'venue-pass', showNames: false, showNotes: false })
    const cookie = cookieOf(await login(token, 'venue-pass'))
    const jar = { [cookie.name]: cookie.value }

    const hidden = await data(token, jar)
    expect(hidden.status).toBe(200)
    expect(hidden.text).not.toContain('Annabel')
    expect(hidden.text).not.toContain('Quist')
    expect(hidden.text).not.toContain('Uncle Bob')
    // The seat still says someone sits there, with what a caterer needs.
    expect((hidden.body as ShareView).guests).toEqual([{ key: 'g1', meal: null, isChild: false }])

    await send(await routes.link(), 'PATCH', `/api/share-links/${link.id}`, { id: link.id }, { body: { showNames: true, showNotes: true } })
    // Names and notes are not sign-out changes: the same cookie still works.
    const shown = await data(token, jar)
    expect(shown.status).toBe(200)
    expect((shown.body as ShareView).guests).toEqual([{ key: 'g1', firstName: 'Annabel', lastName: 'Quist', meal: null, isChild: false }])
    expect(shown.text).toContain('Uncle Bob')
  })

  it('shows a ceremony layout’s chair rows whole, with the seated guest under a key', async () => {
    const database = await db()
    const weddingId = await makeWedding(database, 'Share ceremony test')
    const cy = await makeGuest(database, weddingId, 'Cyrille', 'Okafor')
    let n = 0
    const rows = generateSeatingBlock({ rows: 2, chairsPerRow: 4, origin: { x: 0, y: 0 } }, () => `row-${++n}`).map((row) =>
      row.blockLabel !== DEFAULT_RIGHT_LABEL
        ? row
        : row.rowNumber === 1
          ? { ...row, reservedFor: 'Family, row 1' }
          : { ...row, seats: row.seats.map((seat) => (seat.index === 2 ? { ...seat, guestId: cy } : seat)) },
    )
    const layoutId = await makeLayout(database, weddingId, canvasOf(...rows), { name: 'Vows', kind: 'ceremony' })
    const password = randomBytes(9).toString('base64url')
    const { token } = await makeLink(layoutId, { password, showNames: true })
    const cookie = cookieOf(await login(token, password))

    const res = await data(token, { [cookie.name]: cookie.value })
    expect(res.status).toBe(200)
    const view = res.body as ShareView
    expect(view.kind).toBe('ceremony')
    expect(view.guests).toEqual([{ key: 'g1', firstName: 'Cyrille', lastName: 'Okafor', meal: null, isChild: false }])
    expect(res.text).not.toContain(cy)
    // Every row as drawn in the editor: block, side label, aisle end, reserved label, chairs; only the guest id becomes its key.
    expect(view.items).toEqual(
      rows.map((row) => ({ ...row, seats: row.seats.map((seat) => ({ index: seat.index, guestId: seat.guestId === cy ? 'g1' : null })) })),
    )
    const shared = view.items as ChairRow[]
    expect(shared.filter((r) => r.aisleEnd !== undefined)).toHaveLength(4)
    expect(shared.filter((r) => r.reservedFor === 'Family, row 1').map((r) => r.blockLabel)).toEqual([DEFAULT_RIGHT_LABEL])
  })

  it('answers an unknown token like a wrong password', async () => {
    const res = await login('Z'.repeat(43), 'anything')
    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'wrong_password' })
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('slows a guesser down per link', async () => {
    const { layoutId } = await setup()
    const { token } = await makeLink(layoutId, { password: 'venue-pass' })
    for (let i = 0; i < 10; i++) expect((await login(token, 'guess', '203.0.113.77')).status).toBe(401)
    const blocked = await login(token, 'venue-pass', '203.0.113.77')
    expect(blocked.status).toBe(429)
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)
    // Another address still gets in.
    expect((await login(token, 'venue-pass', '203.0.113.78')).status).toBe(200)
  })

  it('refuses a short password and deletes a link', async () => {
    const { layoutId } = await setup()
    const short = await send(await routes.layoutLinks(), 'POST', `/api/layouts/${layoutId}/share-links`, { id: layoutId }, { body: { password: '123' } })
    expect(short.status).toBe(422)
    const { link, token } = await makeLink(layoutId, { password: 'venue-pass' })
    expect((await send(await routes.link(), 'DELETE', `/api/share-links/${link.id}`, { id: link.id })).status).toBe(200)
    expect((await login(token, 'venue-pass')).status).toBe(401)
    expect((await send(await routes.link(), 'DELETE', `/api/share-links/${link.id}`, { id: link.id })).status).toBe(404)
  })
})
