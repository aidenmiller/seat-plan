import 'server-only'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { NextResponse, type NextRequest } from 'next/server'
import { SITE_COOKIE, verifySiteToken } from './tokens'

/** For server components and pages: send anyone without the site cookie to /login. */
export async function requireSiteSession(nextPath = '/'): Promise<void> {
  const jar = await cookies()
  if (!verifySiteToken(jar.get(SITE_COOKIE)?.value)) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`)
  }
}

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
}

/**
 * Wraps a route handler so it answers 401 without a valid site cookie. The
 * proxy checks too, but the Next.js docs advise checking inside each handler
 * as well. A unit test fails if any handler under src/app/api skips this.
 */
export function withSiteAuth<Ctx>(
  handler: (req: NextRequest, ctx: Ctx) => Promise<Response> | Response,
): (req: NextRequest, ctx: Ctx) => Promise<Response> {
  return async (req, ctx) => {
    if (!verifySiteToken(req.cookies.get(SITE_COOKIE)?.value)) return unauthorized()
    return handler(req, ctx)
  }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Cookie options for every auth cookie. Secure everywhere except plain-http local runs. */
export function authCookieOptions(req: NextRequest, maxAgeSeconds: number, path = '/') {
  return {
    httpOnly: true,
    secure: !(LOCAL_HOSTS.has(req.nextUrl.hostname) && req.nextUrl.protocol === 'http:'),
    sameSite: 'lax' as const,
    path,
    maxAge: maxAgeSeconds,
  }
}
