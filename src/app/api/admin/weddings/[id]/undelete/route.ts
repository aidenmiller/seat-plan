import { idParam, json, notFound, type IdContext } from '@/server/api-route'
import { withAdmin } from '@/server/auth/guards'
import { getDb } from '@/server/db/client'
import { recordEvent } from '@/server/repo/activity'
import { getWeddingForAdmin, undeleteWedding } from '@/server/repo/admin-weddings'

/**
 * Admins: brings a deleted wedding back by clearing its deleted_at, and only
 * that (its guests, layouts and links were never touched). A wedding that is
 * not deleted answers the same, so a retry is harmless; only a real undelete
 * is logged. Replies with the AdminWedding.
 */
export const POST = withAdmin(async (_req, ctx: IdContext, admin) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const db = getDb()
  const result = await undeleteWedding(db, id)
  if (result === 'not-found') return notFound()
  if (result === 'undeleted') await recordEvent(db, { kind: 'wedding_undeleted', userId: admin.id, weddingId: id })
  const wedding = await getWeddingForAdmin(db, id)
  return wedding ? json(wedding) : notFound()
})
