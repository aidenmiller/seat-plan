import { getRedirectUrl, unstable_doesMiddlewareMatch } from 'next/experimental/testing/server'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { config, proxy } from './proxy'
import { SESSION_COOKIE, SITE_COOKIE, createShareToken, createSiteToken, newOpaqueToken, signSessionCookie } from './server/auth/tokens'

const TOKEN = 'T'.repeat(43)
const DAY = 86_400_000

beforeAll(() => {
  vi.stubEnv('AUTH_SECRET', 'proxy-test-secret-that-is-32-chars-or-more')
  vi.stubEnv('SITE_PASSWORD', 'proxy-test-password')
  // The proxy must never reach the database: with no address, any attempt throws.
  vi.stubEnv('DATABASE_URL', '')
})
afterAll(() => {
  vi.unstubAllEnvs()
})

function session(expMs = Date.now() + 365 * DAY): string {
  return signSessionCookie(newOpaqueToken(), expMs)
}

function req(
  path: string,
  opts: { session?: string; cookies?: Record<string, string>; method?: string; headers?: Record<string, string> } = {},
) {
  const r = new NextRequest(`https://seat.example${path}`, {
    method: opts.method ?? 'GET',
    headers: { host: 'seat.example', ...opts.headers },
  })
  if (opts.session) r.cookies.set(SESSION_COOKIE, opts.session)
  for (const [name, value] of Object.entries(opts.cookies ?? {})) r.cookies.set(name, value)
  return r
}

function setCookies(res: Response): string[] {
  return res.headers.getSetCookie()
}

describe('proxy', () => {
  it('sends signed-out page requests to /login with the page they asked for', () => {
    expect(getRedirectUrl(proxy(req('/w/a/layouts?t=1')))).toBe('https://seat.example/login?next=%2Fw%2Fa%2Flayouts%3Ft%3D1')
    expect(getRedirectUrl(proxy(req('/')))).toBe('https://seat.example/login')
  })

  it('answers 401 to signed-out API requests', async () => {
    const res = proxy(req('/api/weddings'))
    expect(res.status).toBe(401)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ error: 'unauthorized' })
  })

  it('lets a validly signed session cookie through, without looking it up', () => {
    const value = session()
    expect(getRedirectUrl(proxy(req('/w/a', { session: value })))).toBeNull()
    expect(proxy(req('/api/weddings', { session: value })).status).toBe(200)
    expect(proxy(req('/api/weddings', { session: value, method: 'POST' })).status).toBe(200)
  })

  it('refuses a forged, expired or wrong-kind cookie in the session cookie’s place', async () => {
    const value = session()
    const refused = [
      'forged',
      `${value}x`,
      `f${value.slice(1)}`,
      session(Date.now() - 1000),
      createShareToken('link', 1),
      createSiteToken(),
    ]
    for (const cookie of refused) {
      expect(getRedirectUrl(proxy(req('/w/a', { session: cookie }))), cookie).toMatch(/\/login/)
      const api = proxy(req('/api/weddings', { session: cookie }))
      expect(api.status, cookie).toBe(401)
      expect(await api.json()).toEqual({ error: 'unauthorized' })
    }
  })

  it('no longer takes the site cookie', () => {
    expect(getRedirectUrl(proxy(req('/w/a', { cookies: { [SITE_COOKIE]: createSiteToken() } })))).toMatch(/\/login/)
    expect(proxy(req('/api/weddings', { cookies: { [SITE_COOKIE]: createSiteToken() } })).status).toBe(401)
  })

  it('renews the session cookie on a page request, as setSessionCookie sets it', () => {
    const value = session()
    const res = proxy(req('/w/a', { session: value }))
    const set = setCookies(res)
    expect(set).toHaveLength(1)
    expect(set[0]).toMatch(new RegExp(`^${SESSION_COOKIE}=${value.replace(/[.]/g, '\\.')};`))
    expect(set[0]).toMatch(/Path=\//)
    expect(set[0]).toMatch(/Max-Age=2592000/)
    expect(set[0]).toMatch(/HttpOnly/i)
    expect(set[0]).toMatch(/Secure/i)
    expect(set[0]).toMatch(/SameSite=lax/i)
  })

  it('never renews past the cookie’s own hard cap', () => {
    const res = proxy(req('/', { session: session(Date.now() + 2 * DAY) }))
    const maxAge = Number(/Max-Age=(\d+)/.exec(setCookies(res)[0]!)![1])
    expect(maxAge).toBeGreaterThan(2 * 86_400 - 60)
    expect(maxAge).toBeLessThanOrEqual(2 * 86_400)
  })

  it('is not Secure on plain-http localhost', () => {
    const r = new NextRequest('http://localhost:3000/', { headers: { host: 'localhost:3000' } })
    r.cookies.set(SESSION_COOKIE, session())
    expect(setCookies(proxy(r))[0]).not.toMatch(/Secure/i)
  })

  it('renews nothing on API requests, changes, public or share paths', () => {
    const value = session()
    expect(setCookies(proxy(req('/api/weddings', { session: value })))).toEqual([])
    expect(setCookies(proxy(req('/w/a', { session: value, method: 'POST' })))).toEqual([])
    expect(setCookies(proxy(req('/login', { session: value })))).toEqual([])
    expect(setCookies(proxy(req(`/share/${TOKEN}`, { session: value })))).toEqual([])
  })

  it('clears a cookie left from the site password, signed in, signed out or on a public page', () => {
    const legacy = { [SITE_COOKIE]: createSiteToken() }
    for (const r of [req('/w/a', { session: session(), cookies: legacy }), req('/w/a', { cookies: legacy }), req('/api/weddings', { cookies: legacy }), req('/login', { cookies: legacy })]) {
      const cleared = setCookies(proxy(r)).find((c) => c.startsWith(`${SITE_COOKIE}=`))
      expect(cleared, r.nextUrl.pathname).toMatch(new RegExp(`^${SITE_COOKIE}=;`))
      expect(cleared).toMatch(/Max-Age=0/)
      expect(cleared).toMatch(/Path=\//)
    }
    expect(setCookies(proxy(req('/w/a', { session: session() }))).some((c) => c.startsWith(`${SITE_COOKIE}=`))).toBe(false)
  })

  it('passes /login, setup, invite, reset, their routes and share paths to their own checks', () => {
    for (const path of [
      '/login',
      '/api/auth/login',
      '/setup',
      '/api/setup',
      '/invite',
      '/reset',
      '/api/invites/lookup',
      '/api/invites/register',
      '/api/auth/reset',
      `/share/${TOKEN}`,
      `/share/${TOKEN}/data`,
    ]) {
      const res = proxy(req(path))
      expect(res.status, path).toBe(200)
      expect(getRedirectUrl(res), path).toBeNull()
    }
    // Logging out needs a session.
    expect(proxy(req('/api/auth/logout', { method: 'POST' })).status).toBe(401)
  })

  it('tells the browser never to pass a share, invite or reset address on', () => {
    for (const path of [`/share/${TOKEN}`, `/share/${TOKEN}/data`, '/invite', '/reset']) {
      expect(proxy(req(path)).headers.get('referrer-policy'), path).toBe('no-referrer')
    }
    expect(proxy(req('/login')).headers.get('referrer-policy')).toBeNull()
  })

  it('marks every response noindex', () => {
    for (const path of ['/', '/api/x', '/login', '/setup', `/share/${TOKEN}`]) {
      expect(proxy(req(path)).headers.get('x-robots-tag'), path).toContain('noindex')
    }
    expect(proxy(req('/api/x', { method: 'POST', headers: { origin: 'https://evil.example' } })).headers.get('x-robots-tag')).toContain('noindex')
  })

  describe('changes from another site', () => {
    const paths = ['/api/weddings', '/w/a', '/login', '/api/auth/login', '/api/setup', '/api/auth/logout', `/share/${TOKEN}/login`, `/share/${TOKEN}/data`]

    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      it(`answers 403 bad_origin to a cross-site ${method} on every path, signed in or not`, async () => {
        for (const path of paths) {
          const crossSite: Record<string, string>[] = [{ origin: 'https://evil.example' }, { origin: 'null' }, { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' }]
          for (const headers of crossSite) {
            for (const r of [req(path, { method, headers }), req(path, { method, headers, session: session() })]) {
              const res = proxy(r)
              expect(res.status, `${method} ${path} ${JSON.stringify(headers)}`).toBe(403)
              expect(res.headers.get('cache-control')).toBe('no-store')
              expect(await res.json()).toEqual({ error: 'bad_origin' })
            }
          }
        }
      })
    }

    it('lets the same change through from this site, or from a client that sends no Origin', () => {
      const value = session()
      const sameSite: Record<string, string>[] = [{ origin: 'https://seat.example' }, { 'sec-fetch-site': 'same-origin' }, {}]
      for (const headers of sameSite) {
        expect(proxy(req('/api/weddings', { method: 'POST', headers, session: value })).status).toBe(200)
        expect(proxy(req('/api/auth/login', { method: 'POST', headers })).status).toBe(200)
      }
      // Behind a proxy that names the original host.
      const forwarded = { origin: 'https://seat.example', host: 'internal:3000', 'x-forwarded-host': 'seat.example' }
      expect(proxy(req('/api/weddings', { method: 'POST', headers: forwarded, session: value })).status).toBe(200)
    })

    it('leaves reads alone, whatever site they come from', () => {
      const res = proxy(req('/w/a', { headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }, session: session() }))
      expect(res.status).toBe(200)
    })
  })

  it('runs on everything except static files, fonts and robots.txt', () => {
    for (const url of ['/_next/static/chunk.js', '/_next/image?url=x', '/favicon.ico', '/robots.txt', '/fonts/a.ttf']) {
      expect(unstable_doesMiddlewareMatch({ config, url }), url).toBe(false)
    }
    for (const url of ['/', '/api/x', '/login', '/setup', '/fontsx', '/w/a', `/share/${TOKEN}`, '/_next/data/x.json']) {
      expect(unstable_doesMiddlewareMatch({ config, url }), url).toBe(true)
    }
  })
})
