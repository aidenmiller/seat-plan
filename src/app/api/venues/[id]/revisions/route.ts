import type { NextRequest } from 'next/server'
import { idParam, json, notFound, type IdContext } from '@/server/api-route'
import { withSiteAuth } from '@/server/auth/require'
import { getDb } from '@/server/db/client'
import { listRevisions } from '@/server/repo/venues'

/** VenueRevisionList: newest first, with the revision "Undo import" restores. */
export const GET = withSiteAuth(async (_req: NextRequest, ctx: IdContext) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const list = await listRevisions(getDb(), id)
  return list ? json(list) : notFound()
})
