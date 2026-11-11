/**
 * The sign-in gate (spec section 2). Runs on every request except Next's own
 * static files, fonts and robots.txt. An optimistic check only: it reads the
 * session cookie's signature and expiry and never the database, so a session
 * that was ended still gets past here. Every route handler and page checks
 * the session against the database itself (src/server/auth/guards.ts and
 * pages.ts).
 *
 *  1. A change (any method but GET, HEAD or OPTIONS) sent from another site
 *     answers 403 { error: 'bad_origin' }, on every path, public and share
 *     paths included.
 *  2. /share/<token> goes to its own check (src/server/auth/share.ts).
 *  3. The public paths (paths.ts) go through.
 *  4. Anything else needs a validly signed, unexpired session cookie: a page
 *     request without one goes to /login?next=..., an API request gets 401.
 *     A page request with one renews the cookie's 30-day lifetime, as the
 *     session slides forward in the database on use.
 *
 * A cookie left over from the shared site password (sp_site) is cleared.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { authCookieOptions } from '@/server/auth/cookie-options'
import { originAllowed } from '@/server/auth/origin'
import { classifyPath, hidesReferrer } from '@/server/auth/paths'
import { SESSION_COOKIE, SESSION_COOKIE_MAX_AGE_SECONDS, SITE_COOKIE, openSessionCookie } from '@/server/auth/tokens'

const NO_STORE = { 'Cache-Control': 'no-store' }

function noindex(res: NextResponse): NextResponse {
  res.headers.set('X-Robots-Tag', 'noindex, nofollow')
  return res
}

/** noindex, and clears the old site-password cookie when the browser still sends it. */
function finish(req: NextRequest, res: NextResponse): NextResponse {
  if (req.cookies.has(SITE_COOKIE)) res.cookies.set(SITE_COOKIE, '', authCookieOptions(req, 0))
  return noindex(res)
}

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl

  if (!originAllowed(req)) {
    return noindex(NextResponse.json({ error: 'bad_origin' }, { status: 403, headers: NO_STORE }))
  }

  const kind = classifyPath(pathname)
  if (kind === 'share') {
    // The share page and routes run their own check (src/server/auth/share.ts).
    // The token is in the address, so the browser must never pass it on.
    const res = noindex(NextResponse.next())
    res.headers.set('Referrer-Policy', 'no-referrer')
    return res
  }
  if (kind === 'public') {
    const res = finish(req, NextResponse.next())
    if (hidesReferrer(pathname)) res.headers.set('Referrer-Policy', 'no-referrer')
    return res
  }

  const value = req.cookies.get(SESSION_COOKIE)?.value
  const opened = openSessionCookie(value)
  if (value && opened) {
    const res = NextResponse.next()
    if (req.method === 'GET' && !pathname.startsWith('/api/')) {
      // The same value with a fresh lifetime, as setSessionCookie sets it: 30
      // days, and never past the cookie's own hard cap (its signed expiry).
      const capSeconds = Math.floor((opened.exp - Date.now()) / 1000)
      const maxAge = Math.max(0, Math.min(SESSION_COOKIE_MAX_AGE_SECONDS, capSeconds))
      res.cookies.set(SESSION_COOKIE, value, authCookieOptions(req, maxAge))
    }
    return finish(req, res)
  }

  if (pathname.startsWith('/api/')) {
    return finish(req, NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE }))
  }
  const url = req.nextUrl.clone()
  url.pathname = '/login'
  url.search = ''
  if (pathname !== '/') url.searchParams.set('next', pathname + search)
  return finish(req, NextResponse.redirect(url))
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|fonts/).*)'],
}
