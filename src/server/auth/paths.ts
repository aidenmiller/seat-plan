/**
 * Which paths the proxy lets through without a session cookie. Pure, so it is
 * easy to test. Anything not named here needs a session cookie (fails closed).
 * Each of these pages and routes runs its own checks.
 */

export type PathKind = 'public' | 'share' | 'cron' | 'protected'

/**
 * Vercel Cron's routes. They carry no session cookie; each checks the cron
 * secret itself (withCronSecret in guards.ts) before anything else.
 */
const CRON_PATHS = new Set(['/api/cron/backups'])

const PUBLIC_PATHS = new Set([
  // Signing in.
  '/login',
  '/api/auth/login',
  // First-run setup: answers 404 once any account exists.
  '/setup',
  '/api/setup',
  // Accepting an invite and resetting a password (people with no session yet; each acts only on a one-time token).
  '/invite',
  '/reset',
  '/api/invites/lookup',
  '/api/invites/register',
  '/api/auth/reset',
  // The tab icon and web manifest: the sign-in page shows them, and browsers
  // fetch the manifest without cookies. They hold nothing private.
  '/icon.svg',
  '/apple-icon.png',
  '/manifest.webmanifest',
])

/** Pages for signed-out visitors, which must never be the return address after signing in. */
const SIGNED_OUT_PAGES = ['/login', '/setup', '/reset', '/invite']

function isSignedOutPage(pathname: string): boolean {
  return SIGNED_OUT_PAGES.some((page) => pathname === page || pathname.startsWith(`${page}/`))
}

/** Share tokens are 32 random bytes in base64url: 43 characters. */
export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

/** Invite and reset pages carry a one-time token: the browser must never pass their address on. */
export function hidesReferrer(pathname: string): boolean {
  return ['/invite', '/reset'].some((page) => pathname === page || pathname.startsWith(`${page}/`))
}

export function classifyPath(pathname: string): PathKind {
  if (PUBLIC_PATHS.has(pathname)) return 'public'
  if (CRON_PATHS.has(pathname)) return 'cron'
  const match = /^\/share\/([^/]+)(\/.*)?$/.exec(pathname)
  if (match && SHARE_TOKEN_PATTERN.test(match[1] ?? '')) return 'share'
  return 'protected'
}

/**
 * The `next` value after login must be a path on this site. Anything else
 * (another host, a protocol-relative URL, a backslash trick) goes home.
 */
export function safeNextPath(next: unknown): string {
  if (typeof next !== 'string' || next.length === 0 || next.length > 2000) return '/'
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return '/'
  if (/[\u0000-\u001f]/.test(next)) return '/'
  try {
    const url = new URL(next, 'http://seat-plan.invalid')
    if (url.host !== 'seat-plan.invalid') return '/'
    if (isSignedOutPage(url.pathname)) return '/'
    const result = url.pathname + url.search + url.hash
    // Dot segments can normalize "/.//evil.example" into "//evil.example",
    // which a browser reads as another site. Check again after normalizing.
    if (result.startsWith('//') || result.startsWith('/\\')) return '/'
    return result
  } catch {
    return '/'
  }
}
