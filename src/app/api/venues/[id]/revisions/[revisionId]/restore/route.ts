import type { NextRequest } from 'next/server'
import { restoreRevisionBody } from '@/shared/api'
import { json, notFound, readBody } from '@/server/api-route'
import { withVenueAccess } from '@/server/auth/guards'
import { byTemplateId } from '@/server/auth/resolvers'
import { getDb } from '@/server/db/client'
import { restoreRevision } from '@/server/repo/venues'
import { saveReply, uuidParam } from '../../../../_venue-route'

type Context = { params: Promise<{ id: string; revisionId: string }> }

/**
 * Puts back the fixed items, reference and image a revision holds, as a new
 * save with its own revision ("Undo import"). Needs edit access to the
 * template. Answers like a save; 404 when the revision is not one of this
 * template's.
 */
export const POST = withVenueAccess<Context>('write', byTemplateId, async (req: NextRequest, ctx: Context, { templateId }) => {
  const revisionId = uuidParam((await ctx.params).revisionId)
  if (!revisionId) return notFound()
  const body = await readBody(req, restoreRevisionBody)
  if (!body.ok) return body.response
  const result = await restoreRevision(getDb(), templateId, revisionId, body.data)
  switch (result.status) {
    case 'revision-not-found':
      return notFound()
    case 'invalid':
      return json({ error: 'invalid', issues: result.issues }, 422)
    default:
      return saveReply(result)
  }
})
