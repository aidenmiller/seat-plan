import type { NextRequest } from 'next/server'
import { idParam, json, notFound, type IdContext } from '@/server/api-route'
import { withWeddingRole } from '@/server/auth/guards'
import { byGuestId } from '@/server/auth/resolvers'
import { getDb } from '@/server/db/client'
import { guestDeleteSummary } from '@/server/repo/guests'

/** GuestDeleteSummary: the layouts and tables the delete clears, the partner, and group and rule counts. Any member. */
export const GET = withWeddingRole(byGuestId, 'editor', async (_req: NextRequest, ctx: IdContext, access) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const summary = await guestDeleteSummary(getDb(), access.weddingId, id)
  return summary ? json(summary) : notFound()
})
