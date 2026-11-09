import { getRedirectUrl, unstable_doesMiddlewareMatch } from 'next/experimental/testing/server'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { config, proxy } from './proxy'
import { SITE_COOKIE, createShareToken, createSiteToken } from './server/auth/tokens'

const TOKEN = 'T'.repeat(43)

beforeAll(() => {
  vi.stubEnv('AUTH_SECRET', 'proxy-test-secret-that-is-32-chars-or-more')
  vi.stubEnv('SITE_PASSWORD', 'proxy-test-password')
})
afterAll(() => {
  vi.unstubAllEnvs()
})

function req(path: string, cookie?: string) {
  const r = new NextRequest(`https://seat.example${path}`)
  if (cookie) r.cookies.set(SITE_COOKIE, cookie)
  return r
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

  it('lets a valid site cookie through and refuses a share cookie in its place', () => {
    expect(getRedirectUrl(proxy(req('/w/a', createSiteToken())))).toBeNull()
    expect(proxy(req('/api/weddings', createSiteToken())).status).toBe(200)
    expect(getRedirectUrl(proxy(req('/w/a', createShareToken('link', 1))))).toMatch(/\/login/)
  })

  it('passes /login, the login route and share paths to their own checks', () => {
    for (const path of ['/login', '/api/auth/login', `/share/${TOKEN}`, `/share/${TOKEN}/data`]) {
      const res = proxy(req(path))
      expect(res.status, path).toBe(200)
      expect(getRedirectUrl(res), path).toBeNull()
    }
  })

  it('marks every response noindex', () => {
    for (const path of ['/', '/api/x', '/login', `/share/${TOKEN}`]) {
      expect(proxy(req(path)).headers.get('x-robots-tag'), path).toContain('noindex')
    }
  })

  it('runs on everything except static files, fonts and robots.txt', () => {
    for (const url of ['/_next/static/chunk.js', '/_next/image?url=x', '/favicon.ico', '/robots.txt', '/fonts/a.ttf']) {
      expect(unstable_doesMiddlewareMatch({ config, url }), url).toBe(false)
    }
    for (const url of ['/', '/api/x', '/login', '/fontsx', '/w/a', `/share/${TOKEN}`, '/_next/data/x.json']) {
      expect(unstable_doesMiddlewareMatch({ config, url }), url).toBe(true)
    }
  })
})
