import type { NextRequest } from 'next/server'
import { notFound } from '@/server/api-route'
import { withSiteAuth } from '@/server/auth/require'
import { getDb } from '@/server/db/client'
import { getTemplateImage, templateImageHash } from '@/server/repo/venues'
import { uuidParam } from '../../../_venue-route'

type Context = { params: Promise<{ id: string; imageId: string }> }

/**
 * The stored image, behind the site cookie (PLAN section 4: images are served
 * only through an authenticated route). The browser may keep a copy but must
 * ask again on every view (no-cache), so a signed-out device or an old cookie
 * after a password change never shows it from its cache. The ETag is the
 * image's sha256, so a repeat view after the cookie check is a 304 with no
 * body, and the bytes are read from the database only when they are sent.
 */
export const GET = withSiteAuth(async (req: NextRequest, ctx: Context) => {
  const params = await ctx.params
  const id = uuidParam(params.id)
  const imageId = uuidParam(params.imageId)
  if (!id || !imageId) return notFound()
  const caching = { 'Cache-Control': 'private, no-cache', 'X-Content-Type-Options': 'nosniff' }

  const asked = req.headers.get('if-none-match')
  if (asked) {
    const hash = await templateImageHash(getDb(), id, imageId)
    if (!hash) return notFound()
    const etag = `"${hash}"`
    if (asked.split(',').some((tag) => tag.trim().replace(/^W\//, '') === etag)) {
      return new Response(null, { status: 304, headers: { ...caching, ETag: etag } })
    }
  }

  const image = await getTemplateImage(getDb(), id, imageId)
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
