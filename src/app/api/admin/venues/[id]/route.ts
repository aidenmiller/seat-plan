import { idParam, json, notFound, readBody, type IdContext } from '@/server/api-route'
import { withAdmin } from '@/server/auth/guards'
import { getDb } from '@/server/db/client'
import { recordEvent } from '@/server/repo/activity'
import { changeVenueForAdmin, getVenueForAdmin } from '@/server/repo/admin-venues'
import { adminVenuePatchBody } from '@/shared/admin-api'

/**
 * Admins: puts a venue in the shared library or takes it out, and changes
 * its owner (changeVenueForAdmin). Replies with the AdminVenue. 409
 * needs_owner when it would be left outside the library with no owner; 409
 * user_disabled for an owner whose account is off; 422 for an id with no
 * account. Each change is logged.
 */
export const PATCH = withAdmin(async (req, ctx: IdContext, admin) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const body = await readBody(req, adminVenuePatchBody)
  if (!body.ok) return body.response
  const ownerUserId = body.data.ownerUserId?.toLowerCase() ?? body.data.ownerUserId
  const db = getDb()
  const result = await changeVenueForAdmin(db, id, { library: body.data.library, ownerUserId })
  switch (result.status) {
    case 'not-found':
      return notFound()
    case 'needs-owner':
      return json({ error: 'needs_owner', message: 'A venue outside the library needs an owner. Pick one first.' }, 409)
    case 'user-disabled':
      return json({ error: 'user_disabled', message: 'That account is turned off. Turn it on first.' }, 409)
    case 'no-user':
      return json({ error: 'invalid', issues: ['ownerUserId: There is no account with that id'] }, 422)
  }
  const { library, owner } = result.changed
  if (library) await recordEvent(db, { kind: 'venue_library_changed', userId: admin.id, subjectId: id, detail: { library: library.to } })
  if (owner) await recordEvent(db, { kind: 'venue_owner_changed', userId: admin.id, subjectId: id, detail: { from: owner.from, to: owner.to } })
  const venue = await getVenueForAdmin(db, id)
  return venue ? json(venue) : notFound()
})
