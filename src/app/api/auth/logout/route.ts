import { json } from '@/server/api-route'
import { withUser } from '@/server/auth/guards'
import { clearAuthCookies } from '@/server/auth/session'
import { getDb } from '@/server/db/client'
import { recordEvent } from '@/server/repo/activity'
import { endSession } from '@/server/repo/sessions'

/**
 * Signs this device out: ends its session in the database and clears the
 * cookies. Needs the session, so another site cannot sign you out with a
 * hidden form (the proxy refuses its Origin, and the Lax cookie is not sent on
 * that cross-site POST anyway).
 */
export const POST = withUser(async (req, _ctx, user) => {
  const db = getDb()
  await endSession(db, user.sessionId, user.id)
  const res = json({ ok: true })
  clearAuthCookies(res, req)
  await recordEvent(db, { kind: 'logout', userId: user.id })
  return res
})
