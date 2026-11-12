import type { NextRequest } from 'next/server'
import { json, notFound, type IdContext } from '@/server/api-route'
import { withWeddingRole } from '@/server/auth/guards'
import { byWeddingId } from '@/server/auth/resolvers'
import { getDb } from '@/server/db/client'
import { weddingDeleteSummary } from '@/server/repo/weddings'

/** WeddingDeleteSummary: what the delete dialog lists. Owners only, as deleting is. */
export const GET = withWeddingRole(byWeddingId, 'owner', async (_req: NextRequest, _ctx: IdContext, access) => {
  const summary = await weddingDeleteSummary(getDb(), access.weddingId)
  return summary ? json(summary) : notFound()
})
