import { NextResponse, type NextRequest } from 'next/server'
import { authCookieOptions, withSiteAuth } from '@/server/auth/require'
import { SITE_COOKIE } from '@/server/auth/tokens'

/**
 * Clears the site cookie on this device. Requires the cookie, so another site
 * cannot sign you out with a hidden form (the Lax cookie is not sent on that
 * cross-site POST, and the route answers 401).
 */
export const POST = withSiteAuth(async (req: NextRequest) => {
  const res = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  res.cookies.set(SITE_COOKIE, '', authCookieOptions(req, 0))
  return res
})
