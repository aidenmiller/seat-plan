import type { NextRequest } from 'next/server'
import { idParam, json, notFound, type IdContext } from '@/server/api-route'
import { withSiteAuth } from '@/server/auth/require'
import { getDb } from '@/server/db/client'
import { weddingDeleteSummary } from '@/server/repo/weddings'

/** WeddingDeleteSummary: what the delete dialog lists. */
export const GET = withSiteAuth(async (_req: NextRequest, ctx: IdContext) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const summary = await weddingDeleteSummary(getDb(), id)
  return summary ? json(summary) : notFound()
})
