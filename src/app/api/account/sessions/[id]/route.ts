import { idParam, json, notFound, type IdContext } from '@/server/api-route'
import { withUser } from '@/server/auth/guards'
import { clearAuthCookies } from '@/server/auth/session'
import { getDb } from '@/server/db/client'
import { endSession } from '@/server/repo/sessions'

/**
 * Signs one of the user's own sessions out. Another user's session, or one
 * that has ended, is 404: endSession only ends a session the caller owns.
 * Ending this browser's own session also clears its cookies.
 */
export const DELETE = withUser(async (req, ctx: IdContext, user) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  if (!(await endSession(getDb(), id, user.id))) return notFound()
  const res = json({ ok: true })
  if (id === user.sessionId) clearAuthCookies(res, req)
  return res
})
