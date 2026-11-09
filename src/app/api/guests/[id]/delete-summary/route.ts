import type { NextRequest } from 'next/server'
import { idParam, json, notFound, type IdContext } from '@/server/api-route'
import { withSiteAuth } from '@/server/auth/require'
import { getDb } from '@/server/db/client'
import { guestDeleteSummary } from '@/server/repo/guests'

/** GuestDeleteSummary: the layouts and tables the delete clears, the partner, and group and rule counts. */
export const GET = withSiteAuth(async (_req: NextRequest, ctx: IdContext) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const summary = await guestDeleteSummary(getDb(), id)
  return summary ? json(summary) : notFound()
})
