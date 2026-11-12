import type { NextRequest } from 'next/server'
import { deleteBody, updateWeddingBody } from '@/shared/api'
import { json, notFound, readBody, type IdContext } from '@/server/api-route'
import { withWeddingRole } from '@/server/auth/guards'
import { byWeddingId } from '@/server/auth/resolvers'
import { getDb } from '@/server/db/client'
import { recordEvent } from '@/server/repo/activity'
import { getWedding, softDeleteWedding, updateWedding } from '@/server/repo/weddings'

/** WeddingSummary. Any member. */
export const GET = withWeddingRole(byWeddingId, 'editor', async (_req: NextRequest, _ctx: IdContext, access) => {
  const wedding = await getWedding(getDb(), access.weddingId)
  return wedding ? json(wedding) : notFound()
})

/** Wedding settings: name, date, unit, minimum gap, the partners' names. Owners only. Replies with the WeddingSummary. */
export const PATCH = withWeddingRole(byWeddingId, 'owner', async (req: NextRequest, _ctx: IdContext, access) => {
  const body = await readBody(req, updateWeddingBody)
  if (!body.ok) return body.response
  const wedding = await updateWedding(getDb(), access.weddingId, body.data)
  return wedding ? json(wedding) : notFound()
})

/** Owners only. Needs { confirm: "delete" }. Marks only the wedding row (DECISIONS 32), and logs wedding_deleted. */
export const DELETE = withWeddingRole(byWeddingId, 'owner', async (req: NextRequest, _ctx: IdContext, access) => {
  const body = await readBody(req, deleteBody)
  if (!body.ok) return body.response
  const db = getDb()
  if (!(await softDeleteWedding(db, access.weddingId))) return notFound()
  await recordEvent(db, { kind: 'wedding_deleted', userId: access.user.id, weddingId: access.weddingId })
  return json({ ok: true })
})
