import type { NextRequest } from 'next/server'
import { createShareLinkBody } from '@/shared/api'
import { idParam, json, notFound, readBody, type IdContext } from '@/server/api-route'
import { withSiteAuth } from '@/server/auth/require'
import { getDb } from '@/server/db/client'
import { createShareLink, listLayoutShareLinks } from '@/server/repo/share-links'

/** ShareLink[]: the layout's links that are on. */
export const GET = withSiteAuth(async (_req: NextRequest, ctx: IdContext) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const links = await listLayoutShareLinks(getDb(), id)
  return links ? json(links) : notFound()
})

/** 201 ShareLink: a new view-only link to this layout, with its own password. 200 for a retry with the same id. */
export const POST = withSiteAuth(async (req: NextRequest, ctx: IdContext) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const body = await readBody(req, createShareLinkBody)
  if (!body.ok) return body.response
  const result = await createShareLink(getDb(), id, body.data)
  switch (result.status) {
    case 'created':
      return json(result.link, result.existed ? 200 : 201)
    case 'id-taken':
      return json({ error: 'id_taken' }, 409)
    case 'not-found':
      return notFound()
  }
})
