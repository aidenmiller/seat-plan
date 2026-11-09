import type { NextRequest } from 'next/server'
import { updateGuestBody, type DeleteGuestReply, type GuestConflict, type UpdateGuestReply } from '@/shared/api'
import { idParam, json, notFound, readBody, refuseUnstorableText, type IdContext } from '@/server/api-route'
import { withSiteAuth } from '@/server/auth/require'
import { getDb } from '@/server/db/client'
import { deleteGuest, updateGuest } from '@/server/repo/guests'

/**
 * UpdateGuestReply: saves only the fields sent (PLAN section 5). A partner
 * change links both ways and clears earlier partners; 409 GuestConflict when
 * a link changed since the browser last saw it, or the partner is gone.
 */
export const PATCH = withSiteAuth(async (req: NextRequest, ctx: IdContext) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const body = await readBody(req, updateGuestBody)
  if (!body.ok) return body.response
  const write = await refuseUnstorableText(() => updateGuest(getDb(), id, body.data))
  if (!write.ok) return write.response
  const result = write.value
  switch (result.status) {
    case 'updated': {
      const reply: UpdateGuestReply = { guest: result.guest, alsoChanged: result.alsoChanged }
      return json(reply)
    }
    case 'conflict': {
      const reply: GuestConflict = { error: 'conflict', message: result.message, guests: result.guests }
      return json(reply, 409)
    }
    case 'self-partner':
      return json({ error: 'invalid', issues: ['partnerId: A guest cannot be their own partner'] }, 422)
    case 'not-found':
      return notFound()
  }
})

/**
 * DeleteGuestReply: removes the guest (PLAN change 7). Their seats are
 * cleared in every layout without changing layout versions, and their
 * partner link is cleared on both sides.
 */
export const DELETE = withSiteAuth(async (_req: NextRequest, ctx: IdContext) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const result = await deleteGuest(getDb(), id)
  if (!result) return notFound()
  const reply: DeleteGuestReply = { ok: true, clearedSeats: result.clearedSeats }
  return json(reply)
})
