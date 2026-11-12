import type { NextRequest } from 'next/server'
import { fitsModel } from '@/domain/floorplan/image-size'
import { floorplanImportBody, IMPORT_NOT_CONFIGURED_MESSAGE, type ImportLimitReached, type ImportNotConfigured } from '@/shared/api'
import { json, notFound, readBody, type IdContext } from '@/server/api-route'
import { floorplanImportStream, importConfigured } from '@/server/ai/floorplan-import'
import { importLimitMessage, reserveAiImport } from '@/server/ai/import-quota'
import { withVenueAccess } from '@/server/auth/guards'
import { byTemplateId } from '@/server/auth/resolvers'
import { getDb } from '@/server/db/client'
import { getTemplateImage, liveTemplateName } from '@/server/repo/venues'
import { invalid } from '../../_venue-route'

/** The model can take minutes on a detailed plan; the call itself stops at about 280 s. */
export const maxDuration = 300

/**
 * The AI floor plan import (spec section 5). Reads an image uploaded to this
 * template, sends it (and, for a vector PDF, its numbered lines and text) to
 * the model, and streams NDJSON: progress lines, then one draft or error line
 * (FloorplanImportLine). Never writes to the template; Accept does that. Needs
 * edit access to the template, as Accept does (the model call costs money).
 * 503 ImportNotConfigured without ANTHROPIC_API_KEY. Once the request checks
 * out, the import is taken from the planner's allowance (import-quota.ts)
 * before the model is called: 429 ImportLimitReached when it is used up.
 */
export const POST = withVenueAccess('write', byTemplateId, async (req: NextRequest, _ctx: IdContext, { templateId, viewer }) => {
  if (!importConfigured()) {
    const reply: ImportNotConfigured = { error: 'not_configured', message: IMPORT_NOT_CONFIGURED_MESSAGE }
    return json(reply, 503)
  }
  const body = await readBody(req, floorplanImportBody)
  if (!body.ok) return body.response
  const db = getDb()
  const venueName = await liveTemplateName(db, templateId)
  if (venueName === null) return notFound()
  const { imageId, imageWidth, imageHeight, segments, labels, doorHints } = body.data
  const image = await getTemplateImage(db, templateId, imageId)
  if (!image) return invalid('imageId: That image was not uploaded to this venue')
  if (image.width !== imageWidth || image.height !== imageHeight) {
    return invalid(`imageWidth: The stored image is ${image.width} by ${image.height} pixels`)
  }
  if (!fitsModel(image.width, image.height)) {
    return invalid('imageId: The image is larger than the AI model reads at full size. Upload the plan again so the app can shrink it')
  }
  const reserved = await reserveAiImport(db, viewer, templateId)
  if (!reserved.ok) {
    const reply: ImportLimitReached = { error: 'import_limit', message: importLimitMessage(reserved.used, reserved.limit), used: reserved.used, limit: reserved.limit }
    return json(reply, 429)
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
