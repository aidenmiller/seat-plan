import type { NextRequest } from 'next/server'
import { notFound } from '@/server/api-route'
import { withVenueAccess } from '@/server/auth/guards'
import { byTemplateId } from '@/server/auth/resolvers'
import { getDb } from '@/server/db/client'
import { getTemplateImage, templateImageHash } from '@/server/repo/venues'
import { uuidParam } from '../../../_venue-route'

type Context = { params: Promise<{ id: string; imageId: string }> }

/**
 * The stored image, to anyone who may read the template (PLAN section 4:
 * images are served only through an authenticated route). The browser may
 * keep a copy but must ask again on every view (no-cache), so a signed-out
 * device never shows it from its cache. The ETag is the image's sha256, so a
 * repeat view after the checks is a 304 with no body, and the bytes are read
 * from the database only when they are sent.
 */
export const GET = withVenueAccess<Context>('read', byTemplateId, async (req: NextRequest, ctx: Context, { templateId }) => {
  const imageId = uuidParam((await ctx.params).imageId)
  if (!imageId) return notFound()
  const caching = { 'Cache-Control': 'private, no-cache', 'X-Content-Type-Options': 'nosniff' }

  const asked = req.headers.get('if-none-match')
  if (asked) {
    const hash = await templateImageHash(getDb(), templateId, imageId)
    if (!hash) return notFound()
    const etag = `"${hash}"`
    if (asked.split(',').some((tag) => tag.trim().replace(/^W\//, '') === etag)) {
      return new Response(null, { status: 304, headers: { ...caching, ETag: etag } })
    }
  }

  const image = await getTemplateImage(getDb(), templateId, imageId)
  if (!image) return notFound()
  return new Response(new Uint8Array(image.bytes), {
    status: 200,
    headers: {
      ...caching,
      'Content-Type': image.contentType,
      'Content-Length': String(image.bytes.byteLength),
      ETag: `"${image.sha256}"`,
      'Content-Disposition': 'inline',
    },
  })
})
