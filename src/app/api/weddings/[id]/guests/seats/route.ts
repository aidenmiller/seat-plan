import type { NextRequest } from 'next/server'
import { json, notFound, type IdContext } from '@/server/api-route'
import { withWeddingRole } from '@/server/auth/guards'
import { byWeddingId } from '@/server/auth/resolvers'
import { getDb } from '@/server/db/client'
import { weddingSeatPlaces } from '@/server/repo/guests'

/**
 * GuestSeatPlace[]: where each live guest sits in the wedding's live
 * layouts, by layout name then table. The Guests page fetches it again after
 * a browser Back, when Next shows the page from its client cache. Any member.
 */
export const GET = withWeddingRole(byWeddingId, 'editor', async (_req: NextRequest, _ctx: IdContext, access) => {
  const seats = await weddingSeatPlaces(getDb(), access.weddingId)
  return seats ? json(seats) : notFound()
})
