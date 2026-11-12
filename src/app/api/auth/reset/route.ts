import type { NextRequest } from 'next/server'
import { resetProblemMessage } from '@/domain/account-wording'
import { json, notFound, readBody } from '@/server/api-route'
import { RESET_SCOPE, requestAddressKey, tooManyAttempts } from '@/server/accounts-route'
import { publicRoute } from '@/server/auth/guards'
import { attemptSucceeded, beginAttempt, wrongGuessDelay } from '@/server/auth/throttle'
import { getDb } from '@/server/db/client'
import { recordEvent } from '@/server/repo/activity'
import { completeReset, lookupReset } from '@/server/repo/password-resets'
import { resetBody, type ResetLookup } from '@/shared/accounts-api'

/**
 * A reset link an admin made (there is no email sending). One path does both
 * steps, because only this exact path is open without a session (paths.ts):
 *
 *  - { token }: whose link it is and whether it still works (ResetLookup).
 *    The name and email come back only while it works.
 *  - { token, password }: sets the password (completeReset), which ends every
 *    session the account had and cancels its other links. 200 { ok: true };
 *    the person then signs in as usual, so nothing here signs anyone in.
 *
 * Every try is counted for the address (RESET_SCOPE) before the token is
 * looked at or any password work, and only a reset that works clears the
 * count. 404 for an unknown token, after about a second; 409
 * { error: 'reset_unusable', reason } for a used or expired link.
 */
export const POST = publicRoute('Using a reset link: the person cannot sign in until they have used it', async (req: NextRequest) => {
  const body = await readBody(req, resetBody)
  if (!body.ok) return body.response
  const { token, password } = body.data
  const db = getDb()
  const ipKey = requestAddressKey(req)
  const verdict = await beginAttempt(db, RESET_SCOPE, ipKey, { scopeWide: false })
  if (!verdict.allowed) return tooManyAttempts(verdict.retryAfterSeconds)

  if (password === undefined) {
    const info = await lookupReset(db, token)
    if (!info) {
      await wrongGuessDelay()
      return notFound()
    }
    const reply: ResetLookup =
      info.state === 'ok'
        ? { status: 'ok', displayName: info.displayName, email: info.email, expiresAt: info.expiresAt }
        : { status: info.state }
    return json(reply)
  }

  const result = await completeReset(db, token, password)
  if (result.status === 'not-found') {
    await wrongGuessDelay()
    return notFound()
  }
  if (result.status !== 'ok') {
    return json({ error: 'reset_unusable', reason: result.status, message: resetProblemMessage(result.status) }, 409)
  }
  await attemptSucceeded(db, RESET_SCOPE, ipKey)
  await recordEvent(db, { kind: 'reset_used', userId: result.userId, subjectId: result.userId })
  return json({ ok: true })
})
