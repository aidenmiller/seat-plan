/**
 * Cross-site request checks. No 'server-only' import: the proxy uses this too.
 *
 * A browser names the page a request came from in the Origin header, and
 * modern browsers also say how the two sites relate in Sec-Fetch-Site. A
 * change (any method but GET, HEAD or OPTIONS) is let through only when it
 * comes from this site. With neither header (curl, Playwright's API client,
 * old browsers) it is let through: those cannot ride on someone's cookie
 * from another site.
 *
 * The page also sends the signed-in user's id in USER_HEADER on every change.
 * Another site cannot add a custom header to a cross-site request without the
 * browser asking first (CORS), and a tab left open from before someone else
 * signed in on this browser sends the wrong id, so its edits are refused
 * instead of landing under the new account.
 */
import { USER_HEADER } from '@/shared/user-header'

export { USER_HEADER }

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

type RequestLike = { method: string; headers: Headers }

export function isUnsafeMethod(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase())
}

/** The host the browser asked for: the first X-Forwarded-Host entry when a proxy set one, else Host. */
function requestHost(headers: Headers): string | null {
  const forwarded = headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  const host = forwarded || headers.get('host')?.trim()
  return host ? host.toLowerCase() : null
}

/** False for a change sent from another site. Safe methods always pass. */
export function originAllowed(req: RequestLike): boolean {
  if (!isUnsafeMethod(req.method)) return true
  const origin = req.headers.get('origin')
  if (origin !== null) {
    // "null" comes from sandboxed frames, data: URLs and some redirects: never this site.
    if (origin === 'null') return false
    const host = requestHost(req.headers)
    if (!host) return false
    try {
      return new URL(origin).host === host
    } catch {
      return false
    }
  }
  const site = req.headers.get('sec-fetch-site')
  return site !== 'cross-site' && site !== 'same-site'
}

/** True when the request carries this user's id in USER_HEADER. */
export function userHeaderMatches(req: { headers: Headers }, userId: string): boolean {
  const sent = req.headers.get(USER_HEADER)
  return sent !== null && sent.trim().toLowerCase() === userId.toLowerCase()
}
