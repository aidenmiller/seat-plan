import { NextRequest, NextResponse } from 'next/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb } from '../db/client'
import { findSession } from '../repo/sessions'
import { clearAuthCookies, refreshSessionCookie, sessionUserFromRequest, setSessionCookie } from './session'
import { SESSION_COOKIE, newOpaqueToken, signSessionCookie } from './tokens'

vi.mock('../db/client', () => ({ getDb: vi.fn() }))
vi.mock('../repo/sessions', () => ({ findSession: vi.fn() }))

const user = { id: 'u', sessionId: 's', email: 'pat@example.com', displayName: 'Pat', isAdmin: false }

beforeAll(() => {
  vi.stubEnv('AUTH_SECRET', 'session-test-secret-that-is-at-least-32-chars')
})
afterAll(() => {
  vi.unstubAllEnvs()
})
beforeEach(() => {
  vi.mocked(getDb).mockReset().mockImplementation(() => ({ fake: 'db' }) as never)
  vi.mocked(findSession).mockReset().mockResolvedValue({ user, touchDue: false })
})

function withCookie(value: string | null, url = 'https://seat.example/x') {
  return new NextRequest(url, { headers: value === null ? {} : { cookie: `${SESSION_COOKIE}=${value}` } })
}

describe('sessionUserFromRequest', () => {
  it('answers null for no cookie or a forged one without touching the database', async () => {
    expect(await sessionUserFromRequest(withCookie(null))).toBeNull()
    expect(await sessionUserFromRequest(withCookie('forged'))).toBeNull()
    expect(getDb).not.toHaveBeenCalled()
  })

  it('looks a signed cookie up in the database', async () => {
    const value = signSessionCookie(newOpaqueToken(), Date.now() + 60_000)
    expect(await sessionUserFromRequest(withCookie(value))).toEqual(user)
    expect(findSession).toHaveBeenCalledWith({ fake: 'db' }, value)
    vi.mocked(findSession).mockResolvedValue(null)
    expect(await sessionUserFromRequest(withCookie(value))).toBeNull()
  })
})

describe('the session cookie on replies', () => {
  it('is HttpOnly, SameSite=Lax, Path=/, Secure, and lives until the session expires (30 days at most)', () => {
    const req = withCookie(null)
    const res = NextResponse.json({})
    setSessionCookie(res, req, 'value', new Date(Date.now() + 3_600_000))
    const set = res.headers.getSetCookie()[0]!
    expect(set).toMatch(/^sp_session=value;/)
    expect(set).toMatch(/Path=\//)
    expect(set).toMatch(/HttpOnly/i)
    expect(set).toMatch(/Secure/i)
    expect(set).toMatch(/SameSite=lax/i)
    const maxAge = Number(/Max-Age=(\d+)/.exec(set)![1])
    expect(maxAge).toBeGreaterThan(3590)
    expect(maxAge).toBeLessThanOrEqual(3600)

    const far = NextResponse.json({})
    setSessionCookie(far, req, 'value', new Date(Date.now() + 400 * 86_400_000))
    expect(far.headers.getSetCookie()[0]).toMatch(/Max-Age=2592000/)
  })

  it('is not Secure on plain-http localhost', () => {
    const res = NextResponse.json({})
    setSessionCookie(res, withCookie(null, 'http://localhost:3000/x'), 'value', new Date(Date.now() + 60_000))
    expect(res.headers.getSetCookie()[0]).not.toMatch(/Secure/i)
  })

  it('clears the session cookie and the old site cookie', () => {
    const res = NextResponse.json({})
    clearAuthCookies(res, withCookie(null))
    const set = res.headers.getSetCookie()
    expect(set).toHaveLength(2)
    expect(set.find((c) => c.startsWith('sp_session=;'))).toMatch(/Max-Age=0/)
    expect(set.find((c) => c.startsWith('sp_site=;'))).toMatch(/Max-Age=0/)
  })

  it('renews the request cookie, but not on a reply that sets it or cannot change', () => {
    const req = withCookie('current')
    const res = NextResponse.json({})
    refreshSessionCookie(res, req)
    expect(res.headers.getSetCookie()[0]).toMatch(/^sp_session=current;.*Max-Age=2592000/)

    const replaced = NextResponse.json({})
    replaced.cookies.set(SESSION_COOKIE, 'new')
    refreshSessionCookie(replaced, req)
    expect(replaced.headers.getSetCookie()).toEqual([expect.stringMatching(/^sp_session=new;/)])

    const plain = new Response('x')
    refreshSessionCookie(plain, req)
    expect(plain.headers.getSetCookie()).toEqual([])
    expect(() => refreshSessionCookie(NextResponse.redirect('https://seat.example/'), req)).not.toThrow()

    const none = NextResponse.json({})
    refreshSessionCookie(none, withCookie(null))
    expect(none.headers.getSetCookie()).toEqual([])
  })
})
