import 'server-only'
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'
import { getDb } from '../db/client'
import type { Db } from '../locks'
import { lookupSession } from '../repo/sessions'
import { findLiveShareLink, touchShareLink, type LiveShareLink } from '../repo/share-links'
import { weddingAccess } from './access'
import { tagPolicy, type Guarded } from './guards'
import { SHARE_TOKEN_PATTERN } from './paths'
import { SESSION_COOKIE, openSessionCookie, shareCookieName, verifyShareToken } from './tokens'

/**
 * The second check behind /share/<token> (spec section 2, PLAN section 5,
 * "Password gate"). The proxy lets every /share/ path through; each share
 * page and route then checks here that the request holds either a session
 * whose user may open the link's wedding (a member, any role, or an admin),
 * or this link's own cookie. Either way the link must be on and its layout
 * and wedding live, and a link cookie's credential version must match the
 * link's, so a new password or turning the link off signs viewers out.
 * Venue viewers never need an account.
 */

const SHARE_COOKIE_PREFIX = shareCookieName('')

export type ShareAccess = { link: LiveShareLink; via: 'member' | 'link' }
export type ShareCheck = ({ ok: true } & ShareAccess) | { ok: false; staleCookie: string | null }

type CookieLike = { name: string; value: string }

/**
 * Checks the cookies for this token. The database is read only when the
 * request holds a validly signed session cookie or a validly signed link
 * cookie, so a request with neither never reaches it.
 */
export async function checkShareAccess(db: () => Db, token: string, jar: readonly CookieLike[]): Promise<ShareCheck> {
  const denied: ShareCheck = { ok: false, staleCookie: null }
  if (!SHARE_TOKEN_PATTERN.test(token)) return denied
  const sessionValue = jar.find((c) => c.name === SESSION_COOKIE)?.value
  const signedSession = openSessionCookie(sessionValue) !== null
  const claims = jar.flatMap((c) => {
    if (!c.name.startsWith(SHARE_COOKIE_PREFIX)) return []
    const claim = verifyShareToken(c.value)
    // A cookie only speaks for the link its name holds.
    return claim && shareCookieName(claim.linkId) === c.name ? [{ name: c.name, ...claim }] : []
  })
  if (!signedSession && claims.length === 0) return denied

  const link = await findLiveShareLink(db(), token)
  if (!link) return denied
  if (signedSession) {
    // A planner checking the link: a member of its wedding, or an admin.
    const user = await lookupSession(db(), sessionValue)
    if (user && (await weddingAccess(db(), user, link.weddingId))) return { ok: true, link, via: 'member' }
  }
  const claim = claims.find((c) => c.linkId === link.id)
  if (!claim) return denied
  if (claim.credentialVersion !== link.credentialVersion) return { ok: false, staleCookie: claim.name }
  return { ok: true, link, via: 'link' }
}

const SHARE_HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }

/** A JSON reply from a share route: never cached, and never sends the page address (and its token) on. */
export function shareJson(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: SHARE_HEADERS })
}

export function shareCookiePath(token: string): string {
  return `/share/${token}`
}

export type TokenContext = { params: Promise<{ token: string }> }

/**
 * Wraps a share route handler: 401 without a member's session or this link's
 * valid cookie. A link cookie from before a password change or turn-off is
 * cleared in the reply. Tagged with the 'share' policy (guards.ts). A unit
 * test fails if a route under share/[token] (apart from the login route)
 * skips this.
 */
export function withShareAuth(
  handler: (req: NextRequest, access: ShareAccess, token: string) => Promise<Response> | Response,
): Guarded<TokenContext> {
  return tagPolicy<TokenContext>({ kind: 'share' }, async (req, ctx) => {
    const { token } = await ctx.params
    const check = await checkShareAccess(getDb, token, req.cookies.getAll())
    if (!check.ok) {
      const res = shareJson({ error: 'unauthorized' }, 401)
      if (check.staleCookie) res.cookies.set(check.staleCookie, '', { path: shareCookiePath(token), maxAge: 0 })
      return res
    }
    return handler(req, { link: check.link, via: check.via }, token)
  })
}

/**
 * For the share page: the link and how the viewer got in, or null when the
 * page should show the password form. Opening it with the link's cookie
 * counts as the link being opened; a member's session (a planner checking the
 * link) does not (DECISIONS 105).
 */
export async function requireShareAccess(token: string): Promise<ShareAccess | null> {
  const jar = await cookies()
  const check = await checkShareAccess(getDb, token, jar.getAll())
  if (!check.ok) return null
  if (check.via === 'link') await touchShareLink(getDb(), check.link.id)
  return { link: check.link, via: check.via }
}
