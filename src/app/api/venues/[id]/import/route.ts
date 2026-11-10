import type { NextRequest } from 'next/server'
import { fitsModel } from '@/domain/floorplan/image-size'
import { floorplanImportBody, IMPORT_NOT_CONFIGURED_MESSAGE, type ImportNotConfigured } from '@/shared/api'
import { idParam, json, notFound, readBody, type IdContext } from '@/server/api-route'
import { floorplanImportStream, importConfigured } from '@/server/ai/floorplan-import'
import { withSiteAuth } from '@/server/auth/require'
import { getDb } from '@/server/db/client'
import { getTemplateImage, liveTemplateName } from '@/server/repo/venues'
import { invalid } from '../../_venue-route'

/** The model can take minutes on a detailed plan; the call itself stops at about 280 s. */
export const maxDuration = 300

/**
 * The AI floor plan import (spec section 5). Reads an image uploaded to this
 * template, sends it (and, for a vector PDF, its numbered lines and text) to
 * the model, and streams NDJSON: progress lines, then one draft or error line
 * (FloorplanImportLine). Never writes to the template; Accept does that.
 * 503 ImportNotConfigured without ANTHROPIC_API_KEY.
 */
export const POST = withSiteAuth(async (req: NextRequest, ctx: IdContext) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  if (!importConfigured()) {
    const reply: ImportNotConfigured = { error: 'not_configured', message: IMPORT_NOT_CONFIGURED_MESSAGE }
    return json(reply, 503)
  }
  const body = await readBody(req, floorplanImportBody)
  if (!body.ok) return body.response
  const db = getDb()
  const venueName = await liveTemplateName(db, id)
  if (venueName === null) return notFound()
  const { imageId, imageWidth, imageHeight, segments, labels, doorHints } = body.data
  const image = await getTemplateImage(db, id, imageId)
  if (!image) return invalid('imageId: That image was not uploaded to this venue')
  if (image.width !== imageWidth || image.height !== imageHeight) {
    return invalid(`imageWidth: The stored image is ${image.width} by ${image.height} pixels`)
  }
  if (!fitsModel(image.width, image.height)) {
    return invalid('imageId: The image is larger than the AI model reads at full size. Upload the plan again so the app can shrink it')
  }
  const stream = floorplanImportStream(
    {
      image: { contentType: image.contentType, bytes: image.bytes },
      prompt: {
        width: image.width,
        height: image.height,
        kind: segments && segments.length > 0 ? 'vector' : 'raster',
        segments,
        texts: labels,
        doorHints,
        venueName,
      },
    },
    { requestSignal: req.signal },
  )
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  })
})
