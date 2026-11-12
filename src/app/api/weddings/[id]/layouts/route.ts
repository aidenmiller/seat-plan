import type { NextRequest } from 'next/server'
import { createLayoutBody } from '@/shared/api'
import { json, notFound, readBody, refuseUnstorableText, type IdContext } from '@/server/api-route'
import { withWeddingRole } from '@/server/auth/guards'
import { byWeddingId } from '@/server/auth/resolvers'
import { getDb } from '@/server/db/client'
import { createLayout, listLayouts } from '@/server/repo/layouts'

/** LayoutSummary[]: the wedding's live layouts, last edited first. Any member. */
export const GET = withWeddingRole(byWeddingId, 'editor', async (_req: NextRequest, _ctx: IdContext, access) => {
  const list = await listLayouts(getDb(), access.weddingId)
  return list ? json(list) : notFound()
})

/**
 * 201 LayoutDetail: a new layout with an empty canvas. Any member. The venue
 * must be one the caller may use in this wedding (the library, their own, or
 * one the wedding already uses); any other is the same 422 as a deleted one.
 */
export const POST = withWeddingRole(byWeddingId, 'editor', async (req: NextRequest, _ctx: IdContext, access) => {
  const body = await readBody(req, createLayoutBody)
  if (!body.ok) return body.response
  const viewer = { userId: access.user.id, isAdmin: access.user.isAdmin }
  const write = await refuseUnstorableText(() => createLayout(getDb(), access.weddingId, body.data, viewer))
  if (!write.ok) return write.response
  const result = write.value
  switch (result.status) {
    case 'created':
      return json(result.layout, 201)
    case 'bad-template':
      return json({ error: 'invalid', issues: ['venueTemplateId: That venue no longer exists'] }, 422)
    case 'invalid':
      return json({ error: 'invalid', issues: result.issues }, 422)
    case 'id-taken':
      return json({ error: 'id_taken' }, 409)
    case 'not-found':
      return notFound()
  }
})
