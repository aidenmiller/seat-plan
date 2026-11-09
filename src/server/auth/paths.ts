/**
 * Which paths the proxy lets through without the site cookie. Pure, so it is
 * easy to test. Anything not named here needs the site cookie (fails closed).
 */

export type PathKind = 'public' | 'share' | 'protected'

const PUBLIC_PATHS = new Set(['/login', '/api/auth/login'])

/** Share tokens are 32 random bytes in base64url: 43 characters. */
export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export function classifyPath(pathname: string): PathKind {
  if (PUBLIC_PATHS.has(pathname)) return 'public'
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
    if (url.pathname === '/login') return '/'
    return url.pathname + url.search + url.hash
  } catch {
    return '/'
  }
}
