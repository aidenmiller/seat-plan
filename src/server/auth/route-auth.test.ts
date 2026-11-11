/**
 * Every route handler must check the session itself (PLAN section 5),
 * whatever the proxy does. This test imports every route file, calls every
 * exported HTTP method with no cookie and with forged ones, and expects 401
 * before the database is touched (there is no database here: a handler that
 * reaches for one throws instead of passing). It also reads each handler's
 * policy tag (guards.ts): only the sign-in, setup and share-password routes
 * are public.
 */
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { policyOf } from './guards'
import { SESSION_COOKIE, SITE_COOKIE, createShareToken, createSiteToken, newOpaqueToken, shareCookieName, signSessionCookie } from './tokens'

const APP_DIR = path.resolve(__dirname, '../../app')
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

/** Routes anyone may call: signing in, first-run setup (404 once an account exists), and a share link's own password. */
const PUBLIC_ROUTES = new Set(['api/auth/login/route.ts', 'api/setup/route.ts', 'share/[token]/login/route.ts'])

function routeFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) out.push(...routeFiles(full))
    else if (name === 'route.ts' || name === 'route.tsx') out.push(full)
  }
  return out
}

const files = routeFiles(APP_DIR).map((f) => path.relative(APP_DIR, f).split(path.sep).join('/'))

type Handler = (req: NextRequest, ctx: unknown) => Promise<Response> | Response

async function handlersOf(file: string): Promise<[string, Handler][]> {
  const mod = (await import(path.join(APP_DIR, file))) as Record<string, unknown>
  return METHODS.filter((m) => typeof mod[m] === 'function').map((m) => [m, mod[m] as Handler])
}

let signed = ''
beforeAll(() => {
  vi.stubEnv('AUTH_SECRET', 'route-auth-test-secret-at-least-32-chars')
  vi.stubEnv('SITE_PASSWORD', 'route-auth-test-password')
  // No database: a handler that skips the check and touches the database throws instead of passing.
  vi.stubEnv('DATABASE_URL', '')
  signed = signSessionCookie(newOpaqueToken(), Date.now() + 86_400_000)
})
afterAll(() => {
  vi.unstubAllEnvs()
})

/** Cookie headers that must never get anyone in. None of them reaches the database. */
function refusedCookies(): [string, string | null][] {
  return [
    ['no cookie', null],
    ['a forged session cookie', `${SESSION_COOKIE}=forged`],
    ['a session cookie with a broken signature', `${SESSION_COOKIE}=${signed}x`],
    ['a session cookie with a changed body', `${SESSION_COOKIE}=f${signed.slice(1)}`],
    ['an expired session cookie', `${SESSION_COOKIE}=${signSessionCookie(newOpaqueToken(), Date.now() - 1000)}`],
    ['a share token as the session cookie', `${SESSION_COOKIE}=${createShareToken('link', 1)}`],
    ['a site token as the session cookie', `${SESSION_COOKIE}=${createSiteToken()}`],
    ['the old site cookie', `${SITE_COOKIE}=${createSiteToken()}`],
    ['a link cookie with a forged signature', `${shareCookieName('link')}=${createShareToken('link', 1).split('.')[0]}.AAAA`],
  ]
}

describe('route handlers answer 401 without a valid session', () => {
  it('finds the route files', () => {
    expect(files).toContain('api/auth/login/route.ts')
    expect(files).toContain('api/auth/logout/route.ts')
    expect(files).toContain('api/setup/route.ts')
    for (const file of PUBLIC_ROUTES) expect(files).toContain(file)
  })

  for (const file of files) {
    if (PUBLIC_ROUTES.has(file)) continue
    it(file, async () => {
      const handlers = await handlersOf(file)
      expect(handlers.length, 'route file exports no handler').toBeGreaterThan(0)
      for (const [method, handler] of handlers) {
        for (const [what, cookie] of refusedCookies()) {
          const req = new NextRequest(`https://seat.example/${file.replace(/\/route\.tsx?$/, '')}`, {
            method,
            headers: cookie === null ? {} : { cookie },
          })
          let res: Response
          try {
            res = await handler(req, { params: Promise.resolve({ token: 'x'.repeat(43), id: 'x', jobId: 'x' }) })
          } catch (err) {
            throw new Error(`${method} ${file} with ${what} threw instead of answering 401: ${String(err)}`)
          }
          expect(res.status, `${method} ${file} with ${what}`).toBe(401)
          expect((await res.json()) as unknown, `${method} ${file} with ${what}`).toEqual({ error: 'unauthorized' })
        }
      }
    })
  }
})

describe('every route handler carries its policy', () => {
  it('tags the public routes public, with a reason, and nothing else', async () => {
    for (const file of files) {
      for (const [method, handler] of await handlersOf(file)) {
        const policy = policyOf(handler)
        expect(policy, `${method} ${file} has no policy tag: wrap it in a guard`).not.toBeNull()
        if (PUBLIC_ROUTES.has(file)) {
          expect(policy, `${method} ${file}`).toMatchObject({ kind: 'public', reason: expect.stringMatching(/\S/) })
        } else {
          expect(policy!.kind, `${method} ${file} is public but not listed here`).not.toBe('public')
        }
      }
    }
  })

  it('tags share routes share and every other route as needing a signed-in user (for now)', async () => {
    for (const file of files) {
      if (PUBLIC_ROUTES.has(file)) continue
      for (const [method, handler] of await handlersOf(file)) {
        expect(policyOf(handler)?.kind, `${method} ${file}`).toBe(file.startsWith('share/') ? 'share' : 'user')
      }
    }
  })
})
