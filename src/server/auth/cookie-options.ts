/**
 * The options every auth cookie is set with. No 'server-only' import: the
 * proxy sets the session cookie too, and must set it exactly as the routes do.
 */
import type { NextRequest } from 'next/server'

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
