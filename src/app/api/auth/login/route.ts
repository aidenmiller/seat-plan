import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { EMAIL_MAX, PASSWORD_MAX, isPlausibleEmail, normalizeEmail } from '@/domain/accounts'
import { runAfterResponse } from '@/server/after-response'
import { json, readBody } from '@/server/api-route'
import { publicRoute } from '@/server/auth/guards'
import { verifyUserPassword } from '@/server/auth/passwords'
import { safeNextPath } from '@/server/auth/paths'
import { clearLegacySiteCookie, setSessionCookie } from '@/server/auth/session'
import {
  LOGIN_ADDRESS_SCOPE,
  addressKey,
  attemptSucceeded,
  beginAttempt,
  clientAddress,
  loginScope,
  wrongGuessDelay,
} from '@/server/auth/throttle'
import { SESSION_COOKIE } from '@/server/auth/tokens'
import { getDb } from '@/server/db/client'
import { recordEvent } from '@/server/repo/activity'
import { createSession, endSession, lookupSession, purgeExpiredSessions } from '@/server/repo/sessions'
import { findLoginCandidate } from '@/server/repo/users'

const loginBody = z.object({
  email: z
    .string()
    .max(EMAIL_MAX + 50)
    .transform(normalizeEmail)
    .refine(isPlausibleEmail, 'Enter your email address'),
  password: z.string().min(1, 'Enter your password').max(PASSWORD_MAX),
  next: z.string().max(2000).optional(),
})

function tooManyAttempts(retryAfterSeconds: number): Response {
  const res = json({ error: 'too_many_attempts', retryAfterSeconds }, 429)
  res.headers.set('Retry-After', String(retryAfterSeconds))
  return res
}

/**
 * Signing in with an email and password.
 *
 * Every try is counted before any password work (PLAN change 23), twice: by
 * this address across every account (`login-ip`), and by the account
 * (`login:<keyed email>`: per address, and across all addresses). Then the
 * password is checked, against a dummy hash for an unknown email, and a
 * disabled account is refused only after that check, so neither shows in the
 * reply or its timing. Every failure gets the same answer after about a
 * second: 401 { error: 'wrong_credentials' }.
 *
 * On success the session this browser held before, if any, ends (whoever's it
 * was), and a new one starts with a new cookie.
 */
export const POST = publicRoute('Signing in: open to anyone signed out', async (req: NextRequest) => {
  const body = await readBody(req, loginBody)
  if (!body.ok) return body.response
  const { email, password } = body.data

  const db = getDb()
  const ipKey = addressKey(clientAddress(req.headers))
  const accountScope = loginScope(email)
  const byAddress = await beginAttempt(db, LOGIN_ADDRESS_SCOPE, ipKey, { scopeWide: false })
  if (!byAddress.allowed) return tooManyAttempts(byAddress.retryAfterSeconds)
  const byAccount = await beginAttempt(db, accountScope, ipKey)
  if (!byAccount.allowed) return tooManyAttempts(byAccount.retryAfterSeconds)

  const candidate = await findLoginCandidate(db, email)
  const passwordRight = await verifyUserPassword(candidate?.passwordHash ?? null, password)
  if (!candidate || !passwordRight || candidate.disabled) {
    await wrongGuessDelay()
    return json({ error: 'wrong_credentials' }, 401)
  }

  await attemptSucceeded(db, LOGIN_ADDRESS_SCOPE, ipKey)
  await attemptSucceeded(db, accountScope, ipKey)

  // Never carry a session across a sign-in: whatever this browser held ends here.
  const previous = await lookupSession(db, req.cookies.get(SESSION_COOKIE)?.value)
  if (previous) await endSession(db, previous.sessionId, previous.id)

  const session = await createSession(db, candidate.id, { userAgent: req.headers.get('user-agent') })
  const res = json({ ok: true, redirect: safeNextPath(body.data.next) })
  setSessionCookie(res, req, session.cookieValue, session.expiresAt)
  clearLegacySiteCookie(res, req)
  await recordEvent(db, { kind: 'login', userId: candidate.id })
  await runAfterResponse(() => purgeExpiredSessions(getDb()))
  return res
})
