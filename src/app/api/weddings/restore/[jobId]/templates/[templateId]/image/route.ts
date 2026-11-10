import type { NextRequest } from 'next/server'
import { MAX_VENUE_IMAGE_BYTES } from '@/shared/api'
import { json, notFound } from '@/server/api-route'
import { withSiteAuth } from '@/server/auth/require'
import { restoreTemplateImage } from '@/server/backup'
import { getDb } from '@/server/db/client'
import { readCappedBody } from '@/app/api/venues/_venue-route'
import { uuidOrNull, type JobContext } from '../../../../_job'

/**
 * Restore step 3: the floor plan image of a template step 2 copied, as the
 * raw request body (PNG or JPEG). `templateId` is the template's id in the
 * backup file. 200 { ok: true }.
 */
export const PUT = withSiteAuth(async (req: NextRequest, ctx: JobContext) => {
  const params = await ctx.params
  const jobId = uuidOrNull(params.jobId)
  const templateId = uuidOrNull(params.templateId)
  if (!jobId || !templateId) return notFound()
  const body = await readCappedBody(req, MAX_VENUE_IMAGE_BYTES)
  if (!body.ok) {
    return body.reason === 'too-large'
      ? json({ error: 'too_large', message: 'The floor plan image is too large to restore.' }, 413)
      : json({ error: 'unsupported_type', message: 'The floor plan image must be a PNG or JPEG.' }, 415)
  }
  const result = await restoreTemplateImage(getDb(), jobId, templateId, body.bytes)
  switch (result.status) {
    case 'created':
    case 'existed':
      return json({ ok: true })
    case 'not-found':
      return notFound()
    case 'too-large':
      return json({ error: 'too_large', message: 'The floor plan image is too large to restore.' }, 413)
    case 'bad-type':
    case 'bad-size':
      return json({ error: 'unsupported_type', message: 'The floor plan image must be a PNG or JPEG.' }, 415)
  }
})
