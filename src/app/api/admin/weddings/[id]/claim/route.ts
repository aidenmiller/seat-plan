import { idParam, json, notFound, type IdContext } from '@/server/api-route'
import { withAdmin } from '@/server/auth/guards'
import { getDb } from '@/server/db/client'
import { recordEvent } from '@/server/repo/activity'
import { claimOwnerlessWedding, getWeddingForAdmin } from '@/server/repo/admin-weddings'

/**
 * Admins: become the owner of a wedding that has no owner, so somebody can
 * run it again and invite its people. Refused (409) while it has an owner.
 * Replies with the AdminWedding.
 */
export const POST = withAdmin(async (_req, ctx: IdContext, admin) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const db = getDb()
  const result = await claimOwnerlessWedding(db, id, admin.id)
  if (result === 'not-found') return notFound()
  if (result === 'has-owner') return json({ error: 'has_owner', message: 'This wedding has an owner already.' }, 409)
  await recordEvent(db, {
    kind: 'member_added',
    userId: admin.id,
    weddingId: id,
    subjectId: admin.id,
    detail: { role: 'owner', claimed: true },
  })
  const wedding = await getWeddingForAdmin(db, id)
  return wedding ? json(wedding) : notFound()
})
