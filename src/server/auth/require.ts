import 'server-only'
import type { NextRequest } from 'next/server'
import type { SessionUser } from './access'
import { withUser, type Guarded } from './guards'
import { requireUser } from './pages'

export { authCookieOptions } from './cookie-options'
export { unauthorized } from './guards'

/**
 * Stand-ins from the shared-password days, kept so every page and route
 * changes over in one step: each now needs a signed-in user (any user) and
 * nothing more. The next phase replaces them with the per-wedding checks in
 * guards.ts and pages.ts, and deletes them.
 */

/** For pages: the signed-in user, or a redirect to /login that comes back to `nextPath`. */
export async function requireSiteSession(nextPath = '/'): Promise<SessionUser> {
  return requireUser(nextPath)
}

/**
 * Wraps a route handler so it answers only a signed-in user (withUser: 401
 * without a live session, 401 stale_page for a browser change without the
 * user's header). The proxy checks too, but the Next.js docs advise checking
 * inside each handler as well. A unit test fails if any handler under
 * src/app/api skips a guard.
 */
export function withSiteAuth<Ctx>(handler: (req: NextRequest, ctx: Ctx) => Promise<Response> | Response): Guarded<Ctx> {
  return withUser<Ctx>((req, ctx) => handler(req, ctx))
}
