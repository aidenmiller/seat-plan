import type { NextRequest } from 'next/server'
import { deleteBody, renameVenueBody, saveVenueBody, type VenueInUse } from '@/shared/api'
import { json, notFound, readBody, refuseUnstorableText, type IdContext } from '@/server/api-route'
import { withVenueAccess } from '@/server/auth/guards'
import { byTemplateId } from '@/server/auth/resolvers'
import { getDb } from '@/server/db/client'
import { editorOf } from '@/server/editor-name'
import { getTemplate, renameTemplate, saveTemplate, softDeleteTemplate } from '@/server/repo/venues'
import { saveReply } from '../_venue-route'

/*
 * Reading needs read access to the template (src/server/auth/venue-access.ts:
 * the library, the caller's own, or one a wedding they belong to uses);
 * changing it needs edit access (their own; the library and other people's
 * only for an admin). Without read access the answer is 404, with read but
 * not edit access 403.
 */

/** VenueDetail: the template's fixed items, reference meta and reference image. */
export const GET = withVenueAccess('read', byTemplateId, async (_req: NextRequest, _ctx: IdContext, { templateId, viewer }) => {
  const venue = await getTemplate(getDb(), templateId, viewer)
  return venue ? json(venue) : notFound()
})

/**
 * The template editor's save: fixed items and reference meta (DECISIONS 28), as the signed-in user.
 * 200 SaveVenueOk, 409 SaveVenueConflict, 410 { error: 'gone' }, 422 { error: 'invalid', issues }.
 */
export const PUT = withVenueAccess('write', byTemplateId, async (req: NextRequest, _ctx: IdContext, { user, templateId }) => {
  const body = await readBody(req, saveVenueBody)
  if (!body.ok) return body.response
  const write = await refuseUnstorableText(() => saveTemplate(getDb(), templateId, body.data, editorOf(user)))
  return write.ok ? saveReply(write.value) : write.response
})

/** Rename. The version stays as it is. Replies with the VenueDetail. */
export const PATCH = withVenueAccess('write', byTemplateId, async (req: NextRequest, _ctx: IdContext, { templateId, viewer }) => {
  const body = await readBody(req, renameVenueBody)
  if (!body.ok) return body.response
  const write = await refuseUnstorableText(() => renameTemplate(getDb(), templateId, body.data.name, viewer))
  if (!write.ok) return write.response
  return write.value ? json(write.value) : notFound()
})

/** The sentence a refused delete shows. Layouts in weddings the caller is not part of are counted, never named. */
function inUseMessage(listed: number, hidden: number): string {
  const n = listed + hidden
  const uses = n === 1 ? 'One layout uses' : `${n} layouts use`
  if (hidden === 0) return `${uses} this venue. Pick another venue for ${n === 1 ? 'it' : 'them'} first.`
  const where = hidden === n ? (n === 1 ? 'in a wedding' : 'in weddings') : `${hidden} of them in ${hidden === 1 ? 'a wedding' : 'weddings'}`
  return `${uses} this venue, ${where} you are not part of. It cannot be deleted while it is in use.`
}

/**
 * Needs { confirm: "delete" }. Refused with 409 VenueInUse while live layouts
 * in live weddings use the template, in any wedding (spec section 5). The
 * reply names only layouts in weddings the caller belongs to and counts the rest.
 */
export const DELETE = withVenueAccess('write', byTemplateId, async (req: NextRequest, _ctx: IdContext, { templateId, viewer }) => {
  const body = await readBody(req, deleteBody)
  if (!body.ok) return body.response
  const result = await softDeleteTemplate(getDb(), templateId, viewer)
  switch (result.status) {
    case 'deleted':
      return json({ ok: true })
    case 'not-found':
      return notFound()
    case 'in-use': {
      const reply: VenueInUse = {
        error: 'in_use',
        message: inUseMessage(result.layouts.length, result.hiddenLayouts),
        layouts: result.layouts,
        hiddenLayouts: result.hiddenLayouts,
      }
      return json(reply, 409)
    }
  }
})
