import { json, readBody } from '@/server/api-route'
import { accountPasswordScope, requestAddressKey, tooManyAttempts } from '@/server/accounts-route'
import { withUser } from '@/server/auth/guards'
import { setSessionCookie } from '@/server/auth/session'
import { attemptSucceeded, beginAttempt, wrongGuessDelay } from '@/server/auth/throttle'
import { getDb } from '@/server/db/client'
import { recordEvent } from '@/server/repo/activity'
import { createSession } from '@/server/repo/sessions'
import { changePassword } from '@/server/repo/users'
import { changePasswordBody } from '@/shared/accounts-api'

/**
 * Changes the signed-in user's password, after checking the current one.
 * changePassword ends every session the user has, this one included, so this
 * browser gets a new session and cookie: it stays signed in, and every other
 * device is signed out.
 *
 * Each try is counted before the current password is checked
 * (accountPasswordScope: per address, and across addresses for this account),
 * and a right password clears the count. A wrong one is answered after about
 * a second with 403 { error: 'wrong_password' }; too many give 429.
 */
export const POST = withUser(async (req, _ctx, user) => {
  const body = await readBody(req, changePasswordBody)
  if (!body.ok) return body.response
  const db = getDb()
  const scope = accountPasswordScope(user.id)
  const ipKey = requestAddressKey(req)
  const verdict = await beginAttempt(db, scope, ipKey)
  if (!verdict.allowed) return tooManyAttempts(verdict.retryAfterSeconds)

  const result = await changePassword(db, user.id, body.data.current, body.data.next)
  if (result === 'wrong-password') {
    await wrongGuessDelay()
    return json({ error: 'wrong_password', message: 'Your current password is wrong.' }, 403)
  }
  await attemptSucceeded(db, scope, ipKey)
  const session = await createSession(db, user.id, { userAgent: req.headers.get('user-agent') })
  const res = json({ ok: true })
  setSessionCookie(res, req, session.cookieValue, session.expiresAt)
  await recordEvent(db, { kind: 'password_changed', userId: user.id })
  return res
})
