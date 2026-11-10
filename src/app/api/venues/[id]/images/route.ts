import type { NextRequest } from 'next/server'
import { MAX_VENUE_IMAGE_BYTES, MAX_VENUE_IMAGE_SIDE } from '@/shared/api'
import { idParam, json, notFound, type IdContext } from '@/server/api-route'
import { withSiteAuth } from '@/server/auth/require'
import { getDb } from '@/server/db/client'
import { addTemplateImage } from '@/server/repo/venues'
import { readCappedBody } from '../../_venue-route'

const MAX_MB = (MAX_VENUE_IMAGE_BYTES / (1024 * 1024)).toFixed(1)

/**
 * Stores a floor plan image sent as the raw request body (PLAN change 6). The
 * type is read from the bytes (PNG or JPEG), and so are the width and height.
 * The template does not point at it until Accept. 201 VenueImageInfo, or 200
 * when the same bytes were stored for this template before.
 * 413 over 3.5 MB, 415 not a PNG or JPEG, 422 a side over 8,000 px.
 */
export const POST = withSiteAuth(async (req: NextRequest, ctx: IdContext) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const body = await readCappedBody(req, MAX_VENUE_IMAGE_BYTES)
  if (!body.ok) {
    return body.reason === 'too-large'
      ? json({ error: 'too_large', message: `The image is over ${MAX_MB} MB. Use a smaller one.` }, 413)
      : json({ error: 'unsupported_type', message: 'Upload a PNG or JPEG image.' }, 415)
  }
  const result = await addTemplateImage(getDb(), id, body.bytes)
  switch (result.status) {
    case 'created':
      return json(result.image, 201)
    case 'existed':
      return json(result.image, 200)
    case 'not-found':
      return notFound()
    case 'too-large':
      return json({ error: 'too_large', message: `The image is over ${MAX_MB} MB. Use a smaller one.` }, 413)
    case 'bad-type':
      return json({ error: 'unsupported_type', message: 'Upload a PNG or JPEG image.' }, 415)
    case 'bad-size':
      return json(
        { error: 'invalid', issues: [`image: Images can be at most ${MAX_VENUE_IMAGE_SIDE.toLocaleString('en-US')} pixels on a side`] },
        422,
      )
  }
})
