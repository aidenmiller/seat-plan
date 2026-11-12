import type { NextRequest } from 'next/server'
import { json, notFound, type IdContext } from '@/server/api-route'
import { withVenueAccess } from '@/server/auth/guards'
import { byTemplateId } from '@/server/auth/resolvers'
import { getDb } from '@/server/db/client'
import { templateDeleteSummary } from '@/server/repo/venues'

/**
 * VenueDeleteSummary: what the delete dialog lists, including the layouts
 * that block the delete. Layouts in weddings the caller does not belong to
 * are counted (hiddenLayouts), never named.
 */
export const GET = withVenueAccess('read', byTemplateId, async (_req: NextRequest, _ctx: IdContext, { templateId, viewer }) => {
  const summary = await templateDeleteSummary(getDb(), templateId, viewer)
  return summary ? json(summary) : notFound()
})
