/**
 * Every route handler must check the session itself (PLAN section 5),
 * whatever the proxy does. This test imports every route file, calls every
 * exported HTTP method with no cookie and with forged ones, and expects 401
 * before the database is touched (there is no database here: a handler that
 * reaches for one throws instead of passing).
 *
 * It also reads each handler's policy tag (guards.ts) and holds it to
 * EXPECTED_POLICY below, route by route and method by method, so a new
 * route, a new method or a changed policy fails here until the table says
 * so too, and shows up in review. Only the sign-in, setup, share-password,
 * invite-link and reset-link routes are public.
 */
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { legacySiteCookieValue } from '../../../test/legacy-site-cookie'
import { policyOf, type AuthPolicy } from './guards'
import { SESSION_COOKIE, SITE_COOKIE, createShareToken, newOpaqueToken, shareCookieName, signSessionCookie } from './tokens'

const APP_DIR = path.resolve(__dirname, '../../app')
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

/**
 * Routes anyone may call, each for a person who cannot have a session yet:
 * signing in, first-run setup (404 once an account exists), a share link's
 * own password, opening an invite link and making an account through it
 * (the person may have no account), and using a reset link an admin made
 * (the person cannot sign in until they have). The invite and reset routes
 * act only on a 32-byte token and are throttled per address.
 */
const PUBLIC_ROUTES = new Set([
  'api/auth/login/route.ts',
  'api/setup/route.ts',
  'share/[token]/login/route.ts',
  'api/invites/lookup/route.ts',
  'api/invites/register/route.ts',
  'api/auth/reset/route.ts',
])

/**
 * Who may call each route, as policyKey() writes a policy:
 *  - 'public': anyone (PUBLIC_ROUTES only);
 *  - 'user': any signed-in user (the account routes act only on the caller);
 *  - 'admin': admins only; anyone else signed in gets 404 (withAdmin);
 *  - 'share': a share link's cookie, or a member's session (share.ts);
 *  - 'wedding:<least role>:<resolver>': a member of the wedding the resolver
 *    finds, with at least that role (an admin always; logged);
 *  - 'venue:<mode>': venue template access (venue-access.ts).
 */
const EXPECTED_POLICY: Record<string, Partial<Record<(typeof METHODS)[number], string>>> = {
  'api/auth/login/route.ts': { POST: 'public' },
  'api/auth/logout/route.ts': { POST: 'user' },
  'api/setup/route.ts': { POST: 'public' },
  'share/[token]/login/route.ts': { POST: 'public' },
  'share/[token]/data/route.ts': { GET: 'share' },
  'api/auth/reset/route.ts': { POST: 'public' },

  'api/invites/lookup/route.ts': { POST: 'public' },
  'api/invites/register/route.ts': { POST: 'public' },
  'api/invites/accept/route.ts': { POST: 'user' },
  'api/invites/[id]/route.ts': { DELETE: 'wedding:owner:byInviteId' },

  'api/account/route.ts': { PATCH: 'user' },
  'api/account/password/route.ts': { POST: 'user' },
  'api/account/sessions/route.ts': { GET: 'user' },
  'api/account/sessions/[id]/route.ts': { DELETE: 'user' },
  'api/account/sessions/revoke-others/route.ts': { POST: 'user' },

  'api/admin/users/route.ts': { GET: 'admin' },
  'api/admin/users/[id]/route.ts': { PATCH: 'admin' },
  'api/admin/users/[id]/reset-link/route.ts': { POST: 'admin' },
  'api/admin/users/[id]/sign-out/route.ts': { POST: 'admin' },
  'api/admin/invites/route.ts': { GET: 'admin', POST: 'admin' },
  'api/admin/invites/[id]/route.ts': { DELETE: 'admin' },
  'api/admin/weddings/route.ts': { GET: 'admin' },
  'api/admin/weddings/[id]/claim/route.ts': { POST: 'admin' },
  // ---- Admin statistics and actions (milestone 8): begin ----
  'api/admin/weddings/[id]/undelete/route.ts': { POST: 'admin' },
  'api/admin/weddings/[id]/members/route.ts': { POST: 'admin' },
  'api/admin/weddings/[id]/transfer/route.ts': { POST: 'admin' },
  'api/admin/venues/[id]/route.ts': { PATCH: 'admin' },
  // ---- Admin statistics and actions (milestone 8): end ----

  'api/weddings/route.ts': { GET: 'user', POST: 'user' },
  'api/weddings/[id]/route.ts': { GET: 'wedding:editor:byWeddingId', PATCH: 'wedding:owner:byWeddingId', DELETE: 'wedding:owner:byWeddingId' },
  'api/weddings/[id]/delete-summary/route.ts': { GET: 'wedding:owner:byWeddingId' },
  'api/weddings/[id]/backup/route.ts': { GET: 'wedding:owner:byWeddingId' },
  'api/weddings/[id]/layouts/route.ts': { GET: 'wedding:editor:byWeddingId', POST: 'wedding:editor:byWeddingId' },
  'api/weddings/[id]/guests/route.ts': { GET: 'wedding:editor:byWeddingId', POST: 'wedding:editor:byWeddingId' },
  'api/weddings/[id]/guests/bulk/route.ts': { POST: 'wedding:editor:byWeddingId' },
  'api/weddings/[id]/guests/import/preview/route.ts': { POST: 'wedding:editor:byWeddingId' },
  'api/weddings/[id]/guests/import/commit/route.ts': { POST: 'wedding:editor:byWeddingId' },
  'api/weddings/[id]/guests/export/route.ts': { GET: 'wedding:editor:byWeddingId' },
  'api/weddings/[id]/guests/seats/route.ts': { GET: 'wedding:editor:byWeddingId' },
  'api/weddings/[id]/groups/route.ts': { GET: 'wedding:editor:byWeddingId', POST: 'wedding:editor:byWeddingId' },
  'api/weddings/[id]/rules/route.ts': { GET: 'wedding:editor:byWeddingId', POST: 'wedding:editor:byWeddingId' },
  'api/weddings/[id]/share-links/route.ts': { GET: 'wedding:editor:byWeddingId' },
  // Any member may see who belongs; changing a role needs an owner. Removing:
  // the guard lets any member through so they can leave, and the handler
  // wants an owner (or an admin's power) to remove someone else (403).
  'api/weddings/[id]/members/route.ts': { GET: 'wedding:editor:byWeddingId' },
  'api/weddings/[id]/members/[userId]/route.ts': { PATCH: 'wedding:owner:byWeddingId', DELETE: 'wedding:editor:byWeddingId' },
  'api/weddings/[id]/invites/route.ts': { GET: 'wedding:owner:byWeddingId', POST: 'wedding:owner:byWeddingId' },
  'api/weddings/restore/route.ts': { POST: 'user' },
  'api/weddings/restore/[jobId]/templates/route.ts': { POST: 'wedding:owner:byRestoreJob' },
  'api/weddings/restore/[jobId]/templates/[templateId]/image/route.ts': { PUT: 'wedding:owner:byRestoreJob' },
  'api/weddings/restore/[jobId]/layouts/route.ts': { POST: 'wedding:owner:byRestoreJob' },

  'api/layouts/[id]/route.ts': {
    GET: 'wedding:editor:byLayoutId',
    PUT: 'wedding:editor:byLayoutId',
    PATCH: 'wedding:editor:byLayoutId',
    DELETE: 'wedding:editor:byLayoutId',
  },
  'api/layouts/[id]/version/route.ts': { GET: 'wedding:editor:byLayoutId' },
  'api/layouts/[id]/duplicate/route.ts': { POST: 'wedding:editor:byLayoutId' },
  'api/layouts/[id]/delete-summary/route.ts': { GET: 'wedding:editor:byLayoutId' },
  'api/layouts/[id]/share-links/route.ts': { GET: 'wedding:editor:byLayoutId', POST: 'wedding:owner:byLayoutId' },
  'api/share-links/[id]/route.ts': { PATCH: 'wedding:owner:byShareLinkId', DELETE: 'wedding:owner:byShareLinkId' },

  'api/guests/[id]/route.ts': { PATCH: 'wedding:editor:byGuestId', DELETE: 'wedding:editor:byGuestId' },
  'api/guests/[id]/delete-summary/route.ts': { GET: 'wedding:editor:byGuestId' },
  'api/groups/[id]/route.ts': { PATCH: 'wedding:editor:byGroupId', DELETE: 'wedding:editor:byGroupId' },
  'api/groups/[id]/members/route.ts': { POST: 'wedding:editor:byGroupId' },
  'api/groups/[id]/members/[guestId]/route.ts': { DELETE: 'wedding:editor:byGroupId' },
  'api/rules/[id]/route.ts': { PATCH: 'wedding:editor:byRuleId', DELETE: 'wedding:editor:byRuleId' },
  'api/rules/couple/route.ts': { PATCH: 'wedding:editor:byCouplePair' },

  'api/venues/route.ts': { GET: 'venue:list', POST: 'venue:create' },
  'api/venues/[id]/route.ts': { GET: 'venue:read', PUT: 'venue:write', PATCH: 'venue:write', DELETE: 'venue:write' },
  'api/venues/[id]/delete-summary/route.ts': { GET: 'venue:read' },
  'api/venues/[id]/wall-check/route.ts': { GET: 'venue:read' },
  'api/venues/[id]/revisions/route.ts': { GET: 'venue:read' },
  'api/venues/[id]/revisions/[revisionId]/restore/route.ts': { POST: 'venue:write' },
  'api/venues/[id]/images/route.ts': { POST: 'venue:write' },
  'api/venues/[id]/images/[imageId]/route.ts': { GET: 'venue:read' },
  'api/venues/[id]/import/route.ts': { POST: 'venue:write' },
  'api/venues/[id]/accept-import/route.ts': { POST: 'venue:write' },
  // Copying needs only read access: the copy is the caller's own, and private.
  'api/venues/[id]/duplicate/route.ts': { POST: 'venue:read' },
}

/** A policy as one short string, the way EXPECTED_POLICY writes it. */
function policyKey(policy: AuthPolicy): string {
  switch (policy.kind) {
    case 'wedding':
      return `wedding:${policy.minRole}:${policy.resolver}`
    case 'venue':
      return `venue:${policy.mode}`
    default:
      return policy.kind
  }
}

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
    ['an old site cookie as the session cookie', `${SESSION_COOKIE}=${legacySiteCookieValue()}`],
    ['the old site cookie', `${SITE_COOKIE}=${legacySiteCookieValue()}`],
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

  it('lists every route file in EXPECTED_POLICY, and nothing else', () => {
    expect([...files].sort(), 'a route file was added or removed: give it a row in EXPECTED_POLICY').toEqual(Object.keys(EXPECTED_POLICY).sort())
  })

  for (const file of files) {
    it(`${file} has exactly the policies EXPECTED_POLICY gives it`, async () => {
      const expected = EXPECTED_POLICY[file]
      expect(expected, `${file} has no row in EXPECTED_POLICY`).toBeDefined()
      const actual: Record<string, string> = {}
      for (const [method, handler] of await handlersOf(file)) {
        const policy = policyOf(handler)
        expect(policy, `${method} ${file} has no policy tag`).not.toBeNull()
        actual[method] = policyKey(policy!)
      }
      expect(actual, file).toEqual(expected)
    })
  }

  it('keeps the public routes to the allowlist', () => {
    const publicInTable = Object.entries(EXPECTED_POLICY)
      .filter(([, methods]) => Object.values(methods).includes('public'))
      .map(([file]) => file)
    expect(publicInTable.sort()).toEqual([...PUBLIC_ROUTES].sort())
  })
})
