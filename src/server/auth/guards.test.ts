/**
 * The route guards with the database and session lookups mocked: the order of
 * the checks, what each refusal looks like, the admin log, the session touch,
 * and the policy tag on every wrapper.
 */
import { NextRequest, NextResponse } from 'next/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb } from '../db/client'
import { recordEvent } from '../repo/activity'
import { findSession, touchSession } from '../repo/sessions'
import { weddingAccess } from './access'
import { AUTH_POLICY, policyOf, publicRoute, withAdmin, withUser, withVenueAccess, withWeddingRole } from './guards'
import { USER_HEADER } from './origin'
import { SESSION_COOKIE, newOpaqueToken, signSessionCookie } from './tokens'
import { requireTemplate } from './venue-access'

vi.mock('../db/client', () => ({ getDb: vi.fn() }))
vi.mock('../repo/sessions', () => ({ findSession: vi.fn(), touchSession: vi.fn() }))
vi.mock('../repo/activity', () => ({ recordEvent: vi.fn() }))
vi.mock('./access', async (importOriginal) => ({ ...(await importOriginal<typeof import('./access')>()), weddingAccess: vi.fn() }))
vi.mock('./venue-access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./venue-access')>()),
  requireTemplate: vi.fn(),
}))

const USER_ID = '11111111-1111-4111-8111-111111111111'
const WEDDING_ID = '22222222-2222-4222-8222-222222222222'
const TEMPLATE_ID = '33333333-3333-4333-8333-333333333333'
const FAKE_DB = { fake: 'db' }

type User = { id: string; sessionId: string; email: string; displayName: string; isAdmin: boolean }
const member: User = { id: USER_ID, sessionId: 'session-1', email: 'pat@example.com', displayName: 'Pat', isAdmin: false }
const admin: User = { ...member, isAdmin: true }

let cookieValue = ''

beforeAll(() => {
  vi.stubEnv('AUTH_SECRET', 'guards-test-secret-that-is-at-least-32-chars')
  cookieValue = signSessionCookie(newOpaqueToken(), Date.now() + 86_400_000)
})
afterAll(() => {
  vi.unstubAllEnvs()
})

beforeEach(() => {
  vi.mocked(getDb).mockReset().mockImplementation(() => FAKE_DB as never)
  vi.mocked(findSession).mockReset().mockResolvedValue({ user: member, touchDue: false })
  vi.mocked(touchSession).mockReset().mockResolvedValue(true)
  vi.mocked(recordEvent).mockReset().mockResolvedValue(undefined)
  vi.mocked(weddingAccess).mockReset()
  vi.mocked(requireTemplate).mockReset()
})

function request(
  method: string,
  opts: { cookie?: string | null; origin?: string; userHeader?: string; path?: string } = {},
): NextRequest {
  const headers: Record<string, string> = { host: 'seat.example' }
  const cookie = opts.cookie === undefined ? cookieValue : opts.cookie
  if (cookie !== null) headers.cookie = `${SESSION_COOKIE}=${cookie}`
  if (opts.origin) headers.origin = opts.origin
  if (opts.userHeader) headers[USER_HEADER] = opts.userHeader
  return new NextRequest(`https://seat.example${opts.path ?? '/api/weddings/x'}`, { method, headers })
}

const ctx = { params: Promise.resolve({ id: WEDDING_ID }) }

function resolverTo(weddingId: string | null) {
  return { name: 'testResolver', resolve: vi.fn(async () => weddingId) }
}

const ok = () => NextResponse.json({ ok: true })

async function body(res: Response) {
  return { status: res.status, body: await res.json() }
}

describe('withWeddingRole', () => {
  const handler = vi.fn(async () => ok())
  beforeEach(() => handler.mockClear())

  it('answers 401 without a cookie, before the database or the resolver', async () => {
    const resolver = resolverTo(WEDDING_ID)
    const res = await withWeddingRole(resolver, 'editor', handler)(request('GET', { cookie: null }), ctx)
    expect(await body(res)).toEqual({ status: 401, body: { error: 'unauthorized' } })
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(getDb).not.toHaveBeenCalled()
    expect(findSession).not.toHaveBeenCalled()
    expect(resolver.resolve).not.toHaveBeenCalled()
    expect(handler).not.toHaveBeenCalled()
  })

  it('answers 401 for a forged or tampered cookie, before the database', async () => {
    // Every payload starts "eyJ" ('{"' in base64url): changing that letter breaks the signature.
    for (const cookie of ['forged', `${cookieValue}x`, `f${cookieValue.slice(1)}`]) {
      const res = await withWeddingRole(resolverTo(WEDDING_ID), 'editor', handler)(request('GET', { cookie }), ctx)
      expect(res.status).toBe(401)
    }
    expect(getDb).not.toHaveBeenCalled()
    expect(findSession).not.toHaveBeenCalled()
  })

  it('answers 401 when the session is not in the database (ended, expired, or the user is disabled)', async () => {
    vi.mocked(findSession).mockResolvedValue(null)
    const res = await withWeddingRole(resolverTo(WEDDING_ID), 'editor', handler)(request('GET'), ctx)
    expect(await body(res)).toEqual({ status: 401, body: { error: 'unauthorized' } })
    expect(handler).not.toHaveBeenCalled()
  })

  it('answers 401 stale_page for a browser change without the right user header, before resolving', async () => {
    const resolver = resolverTo(null)
    for (const userHeader of [undefined, '99999999-9999-4999-8999-999999999999']) {
      const res = await withWeddingRole(resolver, 'editor', handler)(
        request('POST', { origin: 'https://seat.example', userHeader }),
        ctx,
      )
      expect(await body(res)).toEqual({ status: 401, body: { error: 'stale_page' } })
    }
    expect(resolver.resolve).not.toHaveBeenCalled()
  })

  it('needs no user header on reads, or on changes sent without an Origin (scripts, tests)', async () => {
    vi.mocked(weddingAccess).mockResolvedValue({ user: member, weddingId: WEDDING_ID, role: 'owner', viaAdmin: false })
    expect((await withWeddingRole(resolverTo(WEDDING_ID), 'editor', handler)(request('GET', { origin: 'https://seat.example' }), ctx)).status).toBe(200)
    expect((await withWeddingRole(resolverTo(WEDDING_ID), 'editor', handler)(request('DELETE'), ctx)).status).toBe(200)
    expect(
      (await withWeddingRole(resolverTo(WEDDING_ID), 'editor', handler)(request('PATCH', { origin: 'https://seat.example', userHeader: USER_ID }), ctx))
        .status,
    ).toBe(200)
  })

  it('answers 404 when the resolver finds no wedding', async () => {
    const res = await withWeddingRole(resolverTo(null), 'editor', handler)(request('GET'), ctx)
    expect(await body(res)).toEqual({ status: 404, body: { error: 'not_found' } })
    expect(weddingAccess).not.toHaveBeenCalled()
  })

  it('answers 404, not 403, to a non-member or for a deleted wedding', async () => {
    vi.mocked(weddingAccess).mockResolvedValue(null)
    const res = await withWeddingRole(resolverTo(WEDDING_ID), 'editor', handler)(request('GET'), ctx)
    expect(await body(res)).toEqual({ status: 404, body: { error: 'not_found' } })
    expect(weddingAccess).toHaveBeenCalledWith(FAKE_DB, member, WEDDING_ID)
    expect(handler).not.toHaveBeenCalled()
  })

  it('answers 403 to a member whose role is too low', async () => {
    vi.mocked(weddingAccess).mockResolvedValue({ user: member, weddingId: WEDDING_ID, role: 'editor', viaAdmin: false })
    const res = await withWeddingRole(resolverTo(WEDDING_ID), 'owner', handler)(request('GET'), ctx)
    expect(await body(res)).toEqual({ status: 403, body: { error: 'forbidden' } })
    expect(handler).not.toHaveBeenCalled()
  })

  it('calls the handler with the access for a member with the role', async () => {
    vi.mocked(weddingAccess).mockResolvedValue({ user: member, weddingId: WEDDING_ID, role: 'editor', viaAdmin: false })
    const resolver = resolverTo(WEDDING_ID)
    const req = request('GET')
    const res = await withWeddingRole(resolver, 'editor', handler)(req, ctx)
    expect(await body(res)).toEqual({ status: 200, body: { ok: true } })
    expect(resolver.resolve).toHaveBeenCalledWith(req, ctx, FAKE_DB)
    expect(handler).toHaveBeenCalledWith(req, ctx, { user: member, weddingId: WEDDING_ID, role: 'editor', viaAdmin: false })
    expect(recordEvent).not.toHaveBeenCalled()
  })

  it('logs an admin who is not a member: every change, and reads once a day', async () => {
    vi.mocked(findSession).mockResolvedValue({ user: admin, touchDue: false })
    vi.mocked(weddingAccess).mockResolvedValue({ user: admin, weddingId: WEDDING_ID, role: null, viaAdmin: true })

    const read = await withWeddingRole(resolverTo(WEDDING_ID), 'owner', handler)(request('GET'), ctx)
    expect(read.status).toBe(200)
    expect(handler).toHaveBeenLastCalledWith(expect.anything(), ctx, expect.objectContaining({ role: null, viaAdmin: true }))
    const day = new Date().toISOString().slice(0, 10)
    expect(recordEvent).toHaveBeenLastCalledWith(FAKE_DB, {
      kind: 'admin_access',
      userId: USER_ID,
      weddingId: WEDDING_ID,
      detail: { method: 'GET', path: '/api/weddings/x', resolver: 'testResolver', write: false },
      dedupeKey: `admin_access:${USER_ID}:${WEDDING_ID}:${day}`,
    })

    const write = await withWeddingRole(resolverTo(WEDDING_ID), 'owner', handler)(request('PUT'), ctx)
    expect(write.status).toBe(200)
    expect(recordEvent).toHaveBeenLastCalledWith(FAKE_DB, expect.objectContaining({ kind: 'admin_access', dedupeKey: null }))
    expect(recordEvent).toHaveBeenCalledTimes(2)
  })

  it('does not log an admin acting within their own membership', async () => {
    vi.mocked(findSession).mockResolvedValue({ user: admin, touchDue: false })
    vi.mocked(weddingAccess).mockResolvedValue({ user: admin, weddingId: WEDDING_ID, role: 'owner', viaAdmin: false })
    expect((await withWeddingRole(resolverTo(WEDDING_ID), 'owner', handler)(request('PUT'), ctx)).status).toBe(200)
    vi.mocked(weddingAccess).mockResolvedValue({ user: admin, weddingId: WEDDING_ID, role: 'editor', viaAdmin: false })
    expect((await withWeddingRole(resolverTo(WEDDING_ID), 'editor', handler)(request('PUT'), ctx)).status).toBe(200)
    expect(recordEvent).not.toHaveBeenCalled()
  })

  it('lets an admin who is an editor do owner things, and logs it', async () => {
    vi.mocked(findSession).mockResolvedValue({ user: admin, touchDue: false })
    vi.mocked(weddingAccess).mockResolvedValue({ user: admin, weddingId: WEDDING_ID, role: 'editor', viaAdmin: false })
    const res = await withWeddingRole(resolverTo(WEDDING_ID), 'owner', handler)(request('DELETE'), ctx)
    expect(res.status).toBe(200)
    expect(handler).toHaveBeenLastCalledWith(expect.anything(), ctx, expect.objectContaining({ role: 'editor', viaAdmin: true }))
    expect(recordEvent).toHaveBeenCalledWith(FAKE_DB, expect.objectContaining({ kind: 'admin_access' }))
  })

  it('still answers when the activity log fails', async () => {
    vi.mocked(findSession).mockResolvedValue({ user: admin, touchDue: false })
    vi.mocked(weddingAccess).mockResolvedValue({ user: admin, weddingId: WEDDING_ID, role: null, viaAdmin: true })
    vi.mocked(recordEvent).mockRejectedValue(new Error('log is down'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await withWeddingRole(resolverTo(WEDDING_ID), 'owner', handler)(request('GET'), ctx)).status).toBe(200)
    spy.mockRestore()
  })
})

describe('touching the session', () => {
  it('touches and renews the cookie only when due', async () => {
    const route = withUser(async () => ok())
    const quiet = await route(request('GET'), {})
    expect(touchSession).not.toHaveBeenCalled()
    expect(quiet.headers.getSetCookie()).toEqual([])

    vi.mocked(findSession).mockResolvedValue({ user: member, touchDue: true })
    const due = await route(request('GET'), {})
    expect(touchSession).toHaveBeenCalledWith(FAKE_DB, member)
    const set = due.headers.getSetCookie()
    expect(set).toHaveLength(1)
    expect(set[0]).toContain(`${SESSION_COOKIE}=${cookieValue}`)
    expect(set[0]).toMatch(/Max-Age=2592000/)
    expect(set[0]).toMatch(/HttpOnly/i)
  })

  it('leaves a cookie the handler set or cleared alone', async () => {
    vi.mocked(findSession).mockResolvedValue({ user: member, touchDue: true })
    const route = withUser(async () => {
      const res = ok()
      res.cookies.set(SESSION_COOKIE, '', { maxAge: 0, path: '/' })
      return res
    })
    const res = await route(request('POST'), {})
    const set = res.headers.getSetCookie()
    expect(set).toHaveLength(1)
    expect(set[0]).toMatch(new RegExp(`^${SESSION_COOKIE}=;`))
  })

  it('still answers when the touch fails', async () => {
    vi.mocked(findSession).mockResolvedValue({ user: member, touchDue: true })
    vi.mocked(touchSession).mockRejectedValue(new Error('db is down'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await withUser(async () => ok())(request('GET'), {})).status).toBe(200)
    spy.mockRestore()
  })
})

describe('withUser', () => {
  it('runs steps 1 and 2, then the handler with the user', async () => {
    const handler = vi.fn(async () => ok())
    const route = withUser(handler)
    expect((await route(request('GET', { cookie: null }), {})).status).toBe(401)
    expect(getDb).not.toHaveBeenCalled()
    expect(await body(await route(request('POST', { origin: 'https://seat.example' }), {}))).toEqual({
      status: 401,
      body: { error: 'stale_page' },
    })
    expect(handler).not.toHaveBeenCalled()
    const req = request('POST', { origin: 'https://seat.example', userHeader: USER_ID })
    expect((await route(req, {})).status).toBe(200)
    expect(handler).toHaveBeenCalledWith(req, {}, member)
  })
})

describe('withAdmin', () => {
  it('answers 401 signed out, 404 to a non-admin, and runs for an admin', async () => {
    const handler = vi.fn(async () => ok())
    const route = withAdmin(handler)
    expect((await route(request('GET', { cookie: null }), {})).status).toBe(401)
    expect(getDb).not.toHaveBeenCalled()
    expect(await body(await route(request('GET'), {}))).toEqual({ status: 404, body: { error: 'not_found' } })
    expect(handler).not.toHaveBeenCalled()
    vi.mocked(findSession).mockResolvedValue({ user: admin, touchDue: false })
    expect(await body(await route(request('POST', { origin: 'https://seat.example' }), {}))).toEqual({
      status: 401,
      body: { error: 'stale_page' },
    })
    expect((await route(request('GET'), {})).status).toBe(200)
    expect(handler).toHaveBeenCalledWith(expect.anything(), {}, admin)
  })
})

describe('withVenueAccess', () => {
  const templateCtx = { params: Promise.resolve({ id: TEMPLATE_ID }) }
  const byTemplate = { name: 'byTemplateId', resolve: vi.fn(async () => TEMPLATE_ID) }
  const readable = { read: true, edit: false, library: true, ownerUserId: null, ownerName: null }

  it('lists and creates for any signed-in user, with the viewer', async () => {
    const handler = vi.fn(async () => ok())
    expect((await withVenueAccess('list', null, handler)(request('GET', { cookie: null }), {})).status).toBe(401)
    expect((await withVenueAccess('create', null, handler)(request('POST'), {})).status).toBe(200)
    expect(handler).toHaveBeenCalledWith(expect.anything(), {}, { user: member, viewer: { userId: USER_ID, isAdmin: false } })
    expect(requireTemplate).not.toHaveBeenCalled()
  })

  it('checks read or edit on the template, and answers with what requireTemplate says', async () => {
    const handler = vi.fn(async () => ok())
    vi.mocked(requireTemplate).mockResolvedValue({ ok: true, access: readable })
    expect((await withVenueAccess('read', byTemplate, handler)(request('GET'), templateCtx)).status).toBe(200)
    expect(requireTemplate).toHaveBeenLastCalledWith(FAKE_DB, { userId: USER_ID, isAdmin: false }, TEMPLATE_ID, 'read')
    expect(handler).toHaveBeenLastCalledWith(expect.anything(), templateCtx, {
      user: member,
      viewer: { userId: USER_ID, isAdmin: false },
      templateId: TEMPLATE_ID,
      template: readable,
    })

    vi.mocked(requireTemplate).mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'forbidden' }, { status: 403 }) })
    const res = await withVenueAccess('write', byTemplate, handler)(request('PUT'), templateCtx)
    expect(res.status).toBe(403)
    expect(requireTemplate).toHaveBeenLastCalledWith(FAKE_DB, { userId: USER_ID, isAdmin: false }, TEMPLATE_ID, 'edit')
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('answers 404 when the resolver finds no template id', async () => {
    const handler = vi.fn(async () => ok())
    const res = await withVenueAccess('read', { name: 'none', resolve: async () => null }, handler)(request('GET'), templateCtx)
    expect(res.status).toBe(404)
    expect(requireTemplate).not.toHaveBeenCalled()
  })
})

describe('publicRoute', () => {
  it('runs without a cookie and needs a reason', async () => {
    const route = publicRoute('the login form', async () => ok())
    expect((await route(request('POST', { cookie: null }), {})).status).toBe(200)
    expect(findSession).not.toHaveBeenCalled()
    expect(() => publicRoute('  ', async () => ok())).toThrow()
  })
})

describe('policy tags', () => {
  it('are on every wrapper and cannot be changed', () => {
    const h = async () => ok()
    const resolver = resolverTo(WEDDING_ID)
    const cases: [unknown, unknown][] = [
      [publicRoute('signing in', h), { kind: 'public', reason: 'signing in' }],
      [withUser(h), { kind: 'user' }],
      [withAdmin(h), { kind: 'admin' }],
      [withWeddingRole(resolver, 'owner', h), { kind: 'wedding', minRole: 'owner', resolver: 'testResolver' }],
      [withVenueAccess('list', null, h), { kind: 'venue', mode: 'list' }],
      [withVenueAccess('write', { name: 'byTemplateId', resolve: async () => null }, h), { kind: 'venue', mode: 'write' }],
    ]
    for (const [route, policy] of cases) {
      expect(policyOf(route)).toEqual(policy)
      expect((route as Record<symbol, unknown>)[AUTH_POLICY]).toEqual(policy)
      expect(() => {
        ;(route as Record<symbol, unknown>)[AUTH_POLICY] = { kind: 'public', reason: 'x' }
      }).toThrow()
    }
    expect(AUTH_POLICY).toBe(Symbol.for('seat-plan.auth-policy'))
    expect(policyOf(async () => ok())).toBeNull()
  })
})
