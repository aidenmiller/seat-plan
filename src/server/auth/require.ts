import 'server-only'
import type { NextRequest } from 'next/server'
import { withUser, type Guarded } from './guards'

export { authCookieOptions } from './cookie-options'
export { unauthorized } from './guards'

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
