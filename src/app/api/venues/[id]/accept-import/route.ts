import type { NextRequest } from 'next/server'
import { acceptImportBody } from '@/shared/api'
import { idParam, notFound, readBody, refuseUnstorableText, type IdContext } from '@/server/api-route'
import { withSiteAuth } from '@/server/auth/require'
import { getDb } from '@/server/db/client'
import { acceptImport } from '@/server/repo/venues'
import { invalid, saveReply } from '../../_venue-route'

/**
 * Accept on an import draft: fixed items, the reference image (an upload of
 * this template), its placement and imported_by, saved in one transaction as
 * a revision with reason 'import'. Answers like a save (PUT /api/venues/:id).
 */
export const POST = withSiteAuth(async (req: NextRequest, ctx: IdContext) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const body = await readBody(req, acceptImportBody)
  if (!body.ok) return body.response
  const write = await refuseUnstorableText(() => acceptImport(getDb(), id, body.data))
  if (!write.ok) return write.response
  const result = write.value
  if (result.status === 'bad-image') return invalid('imageId: That image was not uploaded to this venue')
  return saveReply(result)
})
