import 'server-only'
import type { SessionUser } from './access'
import { requireUser } from './pages'

export { authCookieOptions } from './cookie-options'
export { unauthorized } from './guards'

/**
 * A stand-in from the shared-password days, kept until every page changes
 * over to the per-wedding checks in pages.ts: it needs a signed-in user (any
 * user) and nothing more. Route handlers no longer use a stand-in; each one
 * is wrapped in a guard from guards.ts (route-auth.test.ts checks every one).
 */

/** For pages: the signed-in user, or a redirect to /login that comes back to `nextPath`. */
export async function requireSiteSession(nextPath = '/'): Promise<SessionUser> {
  return requireUser(nextPath)
}
