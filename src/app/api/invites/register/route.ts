import type { NextRequest } from 'next/server'
import { json, notFound, readBody } from '@/server/api-route'
import { INVITE_SCOPE, inviteRefused, requestAddressKey, tooManyAttempts } from '@/server/accounts-route'
import { publicRoute } from '@/server/auth/guards'
import { clearLegacySiteCookie, setSessionCookie } from '@/server/auth/session'
import { attemptSucceeded, beginAttempt, wrongGuessDelay } from '@/server/auth/throttle'
import { SESSION_COOKIE } from '@/server/auth/tokens'
import { getDb } from '@/server/db/client'
import { recordEvent } from '@/server/repo/activity'
import { lookupInvite, registerWithInvite } from '@/server/repo/invites'
import { createSession, endSession, lookupSession } from '@/server/repo/sessions'
import { registerWithInviteBody, type InviteAccepted } from '@/shared/accounts-api'

/**
 * Makes an account through an invite link and signs it in, as signing in
 * does: whatever session this browser held ends, and a new one starts with a
 * new cookie. Accepting the invite and making the account are one
 * transaction (registerWithInvite), so a refusal keeps neither.
 *
 * The try is counted for the address (INVITE_SCOPE) before any password
 * work; only a sign-up that works clears the count. 404 for an unknown link
 * (after about a second); 409 InviteRefusal for a link that cannot be used,
 * an email the invite is not for, or an email that has an account already.
 * That last answer is the only one that says whether an email has an
 * account, and only to someone holding a working link.
 */
export const POST = publicRoute('Making an account through an invite link: the person has no account yet', async (req: NextRequest) => {
  const body = await readBody(req, registerWithInviteBody)
  if (!body.ok) return body.response
  const { token, email, displayName, password } = body.data
  const db = getDb()
  const ipKey = requestAddressKey(req)
  const verdict = await beginAttempt(db, INVITE_SCOPE, ipKey, { scopeWide: false })
  if (!verdict.allowed) return tooManyAttempts(verdict.retryAfterSeconds)

  const info = await lookupInvite(db, token)
  if (!info) {
    await wrongGuessDelay()
    return notFound()
  }
  const result = await registerWithInvite(db, token, { email, displayName, password })
  if (result.status === 'not-found') return notFound()
  if (result.status === 'email-taken') {
    return json({ error: 'email_taken', message: 'That email already has an account. Sign in to accept the invite.' }, 409)
  }
  if (result.status !== 'ok') return inviteRefused(result.status)

  await attemptSucceeded(db, INVITE_SCOPE, ipKey)
  // Never carry a session across a sign-in: whatever this browser held ends here.
  const previous = await lookupSession(db, req.cookies.get(SESSION_COOKIE)?.value)
  if (previous) await endSession(db, previous.sessionId, previous.id)
  const session = await createSession(db, result.user.id, { userAgent: req.headers.get('user-agent') })
  const reply: InviteAccepted = { ok: true, redirect: info.weddingId ? `/w/${info.weddingId}/layouts` : '/' }
  const res = json(reply)
  setSessionCookie(res, req, session.cookieValue, session.expiresAt)
  clearLegacySiteCookie(res, req)
  await recordEvent(db, {
    kind: 'invite_accepted',
    userId: result.user.id,
    weddingId: info.weddingId,
    subjectId: info.id,
    detail: { role: info.role, newAccount: true },
  })
  return res
})
