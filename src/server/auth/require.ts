import 'server-only'

/**
 * Kept for its two re-exports. Route handlers are wrapped in a guard from
 * guards.ts (route-auth.test.ts checks every one), and pages call a check from
 * pages.ts (page-auth.test.ts checks every one).
 */
export { authCookieOptions } from './cookie-options'
export { unauthorized } from './guards'
