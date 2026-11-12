import { idParam, json, notFound, type IdContext } from '@/server/api-route'
import { withAdmin } from '@/server/auth/guards'
import { getDb } from '@/server/db/client'
import { recordEvent } from '@/server/repo/activity'
import { listInvites, revokeInvite } from '@/server/repo/invites'

/**
 * Admins: cancels a planner invite nobody has used. Only planner invites:
 * 404 for any other id (a wedding's invites are cancelled through
 * /api/invites/:id, where an admin acts as an owner). 409 when it was used or
 * cancelled already.
 */
export const DELETE = withAdmin(async (_req, ctx: IdContext, admin) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const db = getDb()
  if (!(await listInvites(db, null)).some((invite) => invite.id === id)) return notFound()
  if (!(await revokeInvite(db, id))) {
    return json({ error: 'not_pending', message: 'This invite was already used or cancelled.' }, 409)
  }
  await recordEvent(db, { kind: 'invite_revoked', userId: admin.id, subjectId: id, detail: { planner: true } })
  return json({ ok: true })
})
