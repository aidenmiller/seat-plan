import type { NextRequest } from 'next/server'
import { idParam, json, notFound, type IdContext } from '@/server/api-route'
import { withSiteAuth } from '@/server/auth/require'
import { getDb } from '@/server/db/client'
import { weddingSeatPlaces } from '@/server/repo/guests'

/**
 * GuestSeatPlace[]: where each live guest sits in the wedding's live
 * layouts, by layout name then table. The Guests page fetches it again after
 * a browser Back, when Next shows the page from its client cache.
 */
export const GET = withSiteAuth(async (_req: NextRequest, ctx: IdContext) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const seats = await weddingSeatPlaces(getDb(), id)
  return seats ? json(seats) : notFound()
})
