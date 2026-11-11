import { idParam, json, notFound, readBody, type IdContext } from '@/server/api-route'
import { withAdmin } from '@/server/auth/guards'
import { getDb } from '@/server/db/client'
import { recordEvent } from '@/server/repo/activity'
import { listUsersForAdmin, setUserDisabled } from '@/server/repo/users'
import { setUserDisabledBody } from '@/shared/accounts-api'

/**
 * Admins: turns an account off or back on (setUserDisabled). Turning it off
 * ends its sessions at once, so its next request is refused, and cancels the
 * invites and reset links it had out. Replies with the AdminUser. 409 for
 * your own account, or for the last admin who is still on.
 */
export const PATCH = withAdmin(async (req, ctx: IdContext, admin) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const body = await readBody(req, setUserDisabledBody)
  if (!body.ok) return body.response
  const db = getDb()
  const { disabled } = body.data
  const result = await setUserDisabled(db, admin.id, id, disabled)
  if (result === 'not-found') return notFound()
  if (result === 'self') return json({ error: 'self', message: 'You cannot turn off your own account.' }, 409)
  if (result === 'last-admin') {
    return json({ error: 'last_admin', message: 'This is the only admin account that is on, so it cannot be turned off.' }, 409)
  }
  await recordEvent(db, { kind: disabled ? 'user_disabled' : 'user_enabled', userId: admin.id, subjectId: id })
  const user = (await listUsersForAdmin(db)).find((u) => u.id === id)
  return user ? json(user) : notFound()
})
