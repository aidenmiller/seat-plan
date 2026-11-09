import type { NextRequest } from 'next/server'
import { createLayoutBody } from '@/shared/api'
import { idParam, json, notFound, readBody, refuseUnstorableText, type IdContext } from '@/server/api-route'
import { withSiteAuth } from '@/server/auth/require'
import { getDb } from '@/server/db/client'
import { createLayout, listLayouts } from '@/server/repo/layouts'

/** LayoutSummary[]: the wedding's live layouts, last edited first. */
export const GET = withSiteAuth(async (_req: NextRequest, ctx: IdContext) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const list = await listLayouts(getDb(), id)
  return list ? json(list) : notFound()
})

/** 201 LayoutDetail: a new layout with an empty canvas. */
export const POST = withSiteAuth(async (req: NextRequest, ctx: IdContext) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const body = await readBody(req, createLayoutBody)
  if (!body.ok) return body.response
  const write = await refuseUnstorableText(() => createLayout(getDb(), id, body.data))
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
