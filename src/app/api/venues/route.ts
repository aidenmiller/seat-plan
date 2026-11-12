import type { NextRequest } from 'next/server'
import { createVenueBody, uuid } from '@/shared/api'
import { json, notFound, readBody, refuseUnstorableText } from '@/server/api-route'
import { runAfterResponse } from '@/server/after-response'
import { weddingAccess } from '@/server/auth/access'
import { withVenueAccess } from '@/server/auth/guards'
import { getDb } from '@/server/db/client'
import { editorOf } from '@/server/editor-name'
import { recordEvent } from '@/server/repo/activity'
import { createTemplate, listVenues } from '@/server/repo/venues'

/**
 * VenueSummary[]: the templates the caller may pick from (readableTemplateSql
 * in src/server/auth/venue-access.ts), by name.
 *
 * With ?weddingId=: the venues for that wedding's picker: the library, the
 * caller's own, and any template a live layout of that wedding uses. The
 * caller must belong to the wedding (or be an admin, which is logged as
 * admin_access, once a day); anyone else, a deleted wedding, or an id that is
 * not a uuid gets 404, as for any wedding they cannot open.
 *
 * Without it: the library, the caller's own, and the templates used in any
 * wedding the caller belongs to. An admin gets no extras either way.
 */
export const GET = withVenueAccess('list', null, async (req: NextRequest, _ctx: unknown, { user, viewer }) => {
  const asked = req.nextUrl.searchParams.get('weddingId')
  if (asked === null) return json(await listVenues(getDb(), viewer))
  if (!uuid.safeParse(asked).success) return notFound()
  const db = getDb()
  const access = await weddingAccess(db, user, asked.toLowerCase())
  if (!access) return notFound()
  if (access.viaAdmin) {
    const day = new Date().toISOString().slice(0, 10)
    await runAfterResponse(() =>
      recordEvent(getDb(), {
        kind: 'admin_access',
        userId: user.id,
        weddingId: access.weddingId,
        detail: { method: 'GET', path: req.nextUrl.pathname.slice(0, 200), resolver: 'weddingIdQuery', write: false },
        dedupeKey: `admin_access:${user.id}:${access.weddingId}:${day}`,
      }),
    )
  }
  return json(await listVenues(db, viewer, { weddingId: access.weddingId }))
})

/**
 * 201 VenueDetail: a new, empty template, owned by the caller and private. A
 * retry with the same id gives the same template back; an id someone else's
 * template holds is 409 { error: 'id_taken' }.
 */
export const POST = withVenueAccess('create', null, async (req: NextRequest, _ctx: unknown, { user, viewer }) => {
  const body = await readBody(req, createVenueBody)
  if (!body.ok) return body.response
  const write = await refuseUnstorableText(() => createTemplate(getDb(), body.data, viewer, editorOf(user)))
  if (!write.ok) return write.response
  const result = write.value
  if (result.status === 'id-taken') return json({ error: 'id_taken' }, 409)
  return json(result.venue, 201)
})
