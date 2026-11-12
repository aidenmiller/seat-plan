import type { NextRequest } from 'next/server'
import { idParam, json, notFound, type IdContext } from '@/server/api-route'
import { withWeddingRole } from '@/server/auth/guards'
import { byLayoutId } from '@/server/auth/resolvers'
import { getDb } from '@/server/db/client'
import { layoutDeleteSummary } from '@/server/repo/layouts'

/** LayoutDeleteSummary: what the delete dialog lists. Any member. */
export const GET = withWeddingRole(byLayoutId, 'editor', async (_req: NextRequest, ctx: IdContext, access) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const summary = await layoutDeleteSummary(getDb(), access.weddingId, id)
  return summary ? json(summary) : notFound()
})
