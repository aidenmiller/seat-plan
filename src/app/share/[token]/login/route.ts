import type { NextRequest } from 'next/server'
import { shareLoginBody } from '@/shared/api'
import { authCookieOptions } from '@/server/auth/cookie-options'
import { publicRoute } from '@/server/auth/guards'
import { SHARE_TOKEN_PATTERN } from '@/server/auth/paths'
import { shareCookiePath, shareJson, type TokenContext } from '@/server/auth/share'
import { addressKey, attemptSucceeded, beginAttempt, clientAddress, wrongGuessDelay } from '@/server/auth/throttle'
import { COOKIE_MAX_AGE_SECONDS, createShareToken, shareCookieName } from '@/server/auth/tokens'
import { getDb } from '@/server/db/client'
import { findLiveShareLink, touchShareLink, verifySharePassword } from '@/server/repo/share-links'

/**
 * The share link's own password (spec section 2). Open to anyone, like the
 * sign-in route: venue viewers have no account. Every try counts against the
 * link's scope before the compare (PLAN change 23); a wrong one waits about a
 * second. An unknown or turned-off token is checked against a dummy hash, so
 * the reply does not show which tokens exist. The right password sets this
 * link's cookie, for 30 days, on /share/<token> only.
 */
const REASON = 'A share link’s own password: venue viewers have no account'

export const POST = publicRoute(REASON, async (req: NextRequest, ctx: TokenContext) => {
  const { token } = await ctx.params
  let password: string
  try {
    password = shareLoginBody.parse(await req.json()).password
  } catch {
    return shareJson({ error: 'bad_request' }, 400)
  }

  const db = getDb()
  const link = SHARE_TOKEN_PATTERN.test(token) ? await findLiveShareLink(db, token) : null
  const scope = link ? `share:${link.id}` : 'share:unknown'
  const ipKey = addressKey(clientAddress(req.headers))
  const verdict = await beginAttempt(db, scope, ipKey)
  if (!verdict.allowed) {
    const res = shareJson({ error: 'too_many_attempts', retryAfterSeconds: verdict.retryAfterSeconds }, 429)
    res.headers.set('Retry-After', String(verdict.retryAfterSeconds))
    return res
  }

  const right = await verifySharePassword(link?.passwordHash ?? null, password)
  if (!link || !right) {
    await wrongGuessDelay()
    return shareJson({ error: 'wrong_password' }, 401)
  }

  await attemptSucceeded(db, scope, ipKey)
  await touchShareLink(db, link.id)
  const res = shareJson({ ok: true })
  res.cookies.set(
    shareCookieName(link.id),
    createShareToken(link.id, link.credentialVersion),
    authCookieOptions(req, COOKIE_MAX_AGE_SECONDS, shareCookiePath(token)),
  )
  return res
})
