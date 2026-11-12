import { idParam, json, notFound } from '@/server/api-route'
import { withWeddingRole } from '@/server/auth/guards'
import { byInviteId } from '@/server/auth/resolvers'
import { getDb } from '@/server/db/client'
import { recordEvent } from '@/server/repo/activity'
import { revokeInvite } from '@/server/repo/invites'

/**
 * Owners of the invite's wedding: cancels an invite nobody has used, so its
 * link stops working. 409 when it was used or cancelled already. A planner
 * invite has no wedding, so it resolves to nothing (404) here: the admins
 * cancel those through /api/admin/invites/:id.
 */
export const DELETE = withWeddingRole(byInviteId, 'owner', async (_req, ctx, access) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const db = getDb()
  if (!(await revokeInvite(db, id))) {
    return json({ error: 'not_pending', message: 'This invite was already used or cancelled.' }, 409)
  }
  await recordEvent(db, { kind: 'invite_revoked', userId: access.user.id, weddingId: access.weddingId, subjectId: id })
  return json({ ok: true })
})
