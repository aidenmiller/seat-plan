import type { NextRequest } from 'next/server'
import { json, notFound, type IdContext } from '@/server/api-route'
import { withVenueAccess } from '@/server/auth/guards'
import { byTemplateId } from '@/server/auth/resolvers'
import { getDb } from '@/server/db/client'
import { templateWallCheck } from '@/server/repo/venues'

/**
 * VenueWallCheck: every live layout using the template that the caller may
 * see, with the tables a saved wall runs through, and a count of the others.
 */
export const GET = withVenueAccess('read', byTemplateId, async (_req: NextRequest, _ctx: IdContext, { templateId, viewer }) => {
  const check = await templateWallCheck(getDb(), templateId, viewer)
  return check ? json(check) : notFound()
})
