import type { NextRequest } from 'next/server'
import { idParam, json, notFound, type IdContext } from '@/server/api-route'
import { withSiteAuth } from '@/server/auth/require'
import { getDb } from '@/server/db/client'
import { templateWallCheck } from '@/server/repo/venues'

/** VenueWallCheck: every live layout using the template, with the tables a saved wall runs through. */
export const GET = withSiteAuth(async (_req: NextRequest, ctx: IdContext) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const check = await templateWallCheck(getDb(), id)
  return check ? json(check) : notFound()
})
