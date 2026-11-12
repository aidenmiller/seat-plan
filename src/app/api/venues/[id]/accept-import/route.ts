import type { NextRequest } from 'next/server'
import { acceptImportBody } from '@/shared/api'
import { readBody, refuseUnstorableText, type IdContext } from '@/server/api-route'
import { withVenueAccess } from '@/server/auth/guards'
import { byTemplateId } from '@/server/auth/resolvers'
import { getDb } from '@/server/db/client'
import { acceptImport } from '@/server/repo/venues'
import { invalid, saveReply } from '../../_venue-route'

/**
 * Accept on an import draft: fixed items, the reference image (an upload of
 * this template), its placement and imported_by, saved in one transaction as
 * a revision with reason 'import'. Needs edit access to the template.
 * Answers like a save (PUT /api/venues/:id).
 */
export const POST = withVenueAccess('write', byTemplateId, async (req: NextRequest, _ctx: IdContext, { templateId }) => {
  const body = await readBody(req, acceptImportBody)
  if (!body.ok) return body.response
  const write = await refuseUnstorableText(() => acceptImport(getDb(), templateId, body.data))
  if (!write.ok) return write.response
  const result = write.value
  if (result.status === 'bad-image') return invalid('imageId: That image was not uploaded to this venue')
  return saveReply(result)
})
