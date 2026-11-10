import type { NextRequest } from 'next/server'
import { deleteBody, renameVenueBody, saveVenueBody, type VenueInUse } from '@/shared/api'
import { idParam, json, notFound, readBody, refuseUnstorableText, type IdContext } from '@/server/api-route'
import { withSiteAuth } from '@/server/auth/require'
import { getDb } from '@/server/db/client'
import { getTemplate, renameTemplate, saveTemplate, softDeleteTemplate } from '@/server/repo/venues'
import { saveReply } from '../_venue-route'

/** VenueDetail: the template's fixed items, reference meta and reference image. */
export const GET = withSiteAuth(async (_req: NextRequest, ctx: IdContext) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const venue = await getTemplate(getDb(), id)
  return venue ? json(venue) : notFound()
})

/**
 * The template editor's save: fixed items and reference meta (DECISIONS 28).
 * 200 SaveVenueOk, 409 SaveVenueConflict, 410 { error: 'gone' }, 422 { error: 'invalid', issues }.
 */
export const PUT = withSiteAuth(async (req: NextRequest, ctx: IdContext) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const body = await readBody(req, saveVenueBody)
  if (!body.ok) return body.response
  const write = await refuseUnstorableText(() => saveTemplate(getDb(), id, body.data))
  return write.ok ? saveReply(write.value) : write.response
})

/** Rename. The version stays as it is. Replies with the VenueDetail. */
export const PATCH = withSiteAuth(async (req: NextRequest, ctx: IdContext) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const body = await readBody(req, renameVenueBody)
  if (!body.ok) return body.response
  const write = await refuseUnstorableText(() => renameTemplate(getDb(), id, body.data.name))
  if (!write.ok) return write.response
  return write.value ? json(write.value) : notFound()
})

/**
 * Needs { confirm: "delete" }. Refused with 409 VenueInUse while live layouts
 * in live weddings use the template (spec section 5).
 */
export const DELETE = withSiteAuth(async (req: NextRequest, ctx: IdContext) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const body = await readBody(req, deleteBody)
  if (!body.ok) return body.response
  const result = await softDeleteTemplate(getDb(), id)
  switch (result.status) {
    case 'deleted':
      return json({ ok: true })
    case 'not-found':
      return notFound()
    case 'in-use': {
      const n = result.layouts.length
      const reply: VenueInUse = {
        error: 'in_use',
        message: `${n === 1 ? 'One layout uses' : `${n} layouts use`} this venue. Pick another venue for ${n === 1 ? 'it' : 'them'} first.`,
        layouts: result.layouts,
      }
      return json(reply, 409)
    }
  }
})
