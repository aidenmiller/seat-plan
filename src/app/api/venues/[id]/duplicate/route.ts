import type { NextRequest } from 'next/server'
import { duplicateVenueBody } from '@/shared/api'
import { json, notFound, readBody, refuseUnstorableText, type IdContext } from '@/server/api-route'
import { withVenueAccess } from '@/server/auth/guards'
import { byTemplateId } from '@/server/auth/resolvers'
import { getDb } from '@/server/db/client'
import { duplicateTemplate } from '@/server/repo/venues'

/**
 * 201 VenueDetail: a copy with the same fixed items, reference and reference
 * image. Anyone who may read the template may copy it; the copy is the
 * caller's own and private, whatever the original was.
 */
export const POST = withVenueAccess('read', byTemplateId, async (req: NextRequest, _ctx: IdContext, { templateId, viewer }) => {
  const body = await readBody(req, duplicateVenueBody)
  if (!body.ok) return body.response
  const write = await refuseUnstorableText(() => duplicateTemplate(getDb(), templateId, body.data, viewer))
  if (!write.ok) return write.response
  const result = write.value
  switch (result.status) {
    case 'created':
      return json(result.venue, 201)
    case 'id-taken':
      return json({ error: 'id_taken' }, 409)
    case 'not-found':
      return notFound()
  }
})
