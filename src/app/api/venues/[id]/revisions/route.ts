import type { NextRequest } from 'next/server'
import { json, notFound, type IdContext } from '@/server/api-route'
import { withVenueAccess } from '@/server/auth/guards'
import { byTemplateId } from '@/server/auth/resolvers'
import { getDb } from '@/server/db/client'
import { listRevisions } from '@/server/repo/venues'

/** VenueRevisionList: newest first, with the revision "Undo import" restores. */
export const GET = withVenueAccess('read', byTemplateId, async (_req: NextRequest, _ctx: IdContext, { templateId }) => {
  const list = await listRevisions(getDb(), templateId)
  return list ? json(list) : notFound()
})
