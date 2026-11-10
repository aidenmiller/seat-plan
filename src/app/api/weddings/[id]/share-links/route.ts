import type { NextRequest } from 'next/server'
import { idParam, json, notFound, type IdContext } from '@/server/api-route'
import { withSiteAuth } from '@/server/auth/require'
import { getDb } from '@/server/db/client'
import { listWeddingShareLinks } from '@/server/repo/share-links'

/** ShareLink[]: the wedding's links that are on, for the Links tab. */
export const GET = withSiteAuth(async (_req: NextRequest, ctx: IdContext) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const links = await listWeddingShareLinks(getDb(), id)
  return links ? json(links) : notFound()
})
