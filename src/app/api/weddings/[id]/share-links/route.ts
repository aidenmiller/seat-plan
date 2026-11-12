import type { NextRequest } from 'next/server'
import { json, notFound, type IdContext } from '@/server/api-route'
import { withWeddingRole } from '@/server/auth/guards'
import { byWeddingId } from '@/server/auth/resolvers'
import { getDb } from '@/server/db/client'
import { listWeddingShareLinks } from '@/server/repo/share-links'

/** ShareLink[]: the wedding's links that are on, for the Links tab. Any member. */
export const GET = withWeddingRole(byWeddingId, 'editor', async (_req: NextRequest, _ctx: IdContext, access) => {
  const links = await listWeddingShareLinks(getDb(), access.weddingId)
  return links ? json(links) : notFound()
})
