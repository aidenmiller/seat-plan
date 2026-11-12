import { idParam, json, notFound, readBody, type IdContext } from '@/server/api-route'
import { withAdmin } from '@/server/auth/guards'
import { getDb } from '@/server/db/client'
import { recordEvent } from '@/server/repo/activity'
import { listUsersForAdmin, setUserAdmin, setUserDisabled } from '@/server/repo/users'
import { updateUserBody } from '@/shared/accounts-api'

/**
 * Admins: turns an account off or back on (`disabled`, setUserDisabled), or
 * makes someone an admin or takes that away (`admin`, setUserAdmin), one at a
 * time. Turning it off ends its sessions at once, so its next request is
 * refused, and cancels the invites and reset links it had out. Replies with
 * the AdminUser. 409 for your own account (turning it off, or removing your
 * own admin), for the last admin who is still on, and for making an account
 * that is turned off an admin.
 */
export const PATCH = withAdmin(async (req, ctx: IdContext, admin) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const body = await readBody(req, updateUserBody)
  if (!body.ok) return body.response
  const db = getDb()
  if (body.data.admin !== undefined) {
    const makeAdmin = body.data.admin
    const changed = await setUserAdmin(db, admin.id, id, makeAdmin)
    if (changed === 'not-found') return notFound()
    if (changed === 'self') return json({ error: 'self', message: 'You cannot remove your own admin access.' }, 409)
    if (changed === 'last-admin') {
      return json({ error: 'last_admin', message: 'This is the only admin account that is on, so it cannot lose admin access.' }, 409)
    }
    if (changed === 'disabled') return json({ error: 'user_disabled', message: 'That account is turned off. Turn it on first.' }, 409)
    await recordEvent(db, { kind: 'user_admin_changed', userId: admin.id, subjectId: id, detail: { admin: makeAdmin } })
    const user = (await listUsersForAdmin(db)).find((u) => u.id === id)
    return user ? json(user) : notFound()
  }
  const disabled = body.data.disabled === true
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
