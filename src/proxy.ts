/**
 * The password gate (spec section 2). Runs on every request except Next's own
 * static files, fonts and robots.txt. Lets /login, the login and logout routes
 * and /share/<token> through; everything else needs a valid site cookie.
 * Route handlers and pages check the cookie again themselves.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { classifyPath } from '@/server/auth/paths'
import { SITE_COOKIE, verifySiteToken } from '@/server/auth/tokens'

function noindex(res: NextResponse): NextResponse {
  res.headers.set('X-Robots-Tag', 'noindex, nofollow')
  return res
}

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl
  const kind = classifyPath(pathname)
  if (kind !== 'protected') return noindex(NextResponse.next())

  if (verifySiteToken(req.cookies.get(SITE_COOKIE)?.value)) return noindex(NextResponse.next())

  if (pathname.startsWith('/api/')) {
    return noindex(NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } }))
  }
  const url = req.nextUrl.clone()
  url.pathname = '/login'
  url.search = ''
  if (pathname !== '/') url.searchParams.set('next', pathname + search)
  return noindex(NextResponse.redirect(url))
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|fonts/).*)'],
}
