import type { NextRequest } from 'next/server'
import { createShareLinkBody } from '@/shared/api'
import { idParam, json, notFound, readBody, type IdContext } from '@/server/api-route'
import { withWeddingRole } from '@/server/auth/guards'
import { byLayoutId } from '@/server/auth/resolvers'
import { getDb } from '@/server/db/client'
import { createShareLink, listLayoutShareLinks } from '@/server/repo/share-links'

/** ShareLink[]: the layout's links that are on. Any member. */
export const GET = withWeddingRole(byLayoutId, 'editor', async (_req: NextRequest, ctx: IdContext, access) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const links = await listLayoutShareLinks(getDb(), access.weddingId, id)
  return links ? json(links) : notFound()
})

/**
 * 201 ShareLink: a new view-only link to this layout, with its own password.
 * 200 for a retry with the same id. Owners only: a link lets someone without
 * an account see the layout.
 */
export const POST = withWeddingRole(byLayoutId, 'owner', async (req: NextRequest, ctx: IdContext, access) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const body = await readBody(req, createShareLinkBody)
  if (!body.ok) return body.response
  const result = await createShareLink(getDb(), access.weddingId, id, body.data)
  switch (result.status) {
    case 'created':
      return json(result.link, result.existed ? 200 : 201)
    case 'id-taken':
      return json({ error: 'id_taken' }, 409)
    case 'not-found':
      return notFound()
  }
})
