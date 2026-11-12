import type { NextRequest } from 'next/server'
import { createGuestBody } from '@/shared/api'
import { json, notFound, readBody, refuseUnstorableText, type IdContext } from '@/server/api-route'
import { withWeddingRole } from '@/server/auth/guards'
import { byWeddingId } from '@/server/auth/resolvers'
import { getDb } from '@/server/db/client'
import { createGuest, listGuests } from '@/server/repo/guests'

/** Guest[]: the wedding's live guests with their group ids and partner id. Any member. */
export const GET = withWeddingRole(byWeddingId, 'editor', async (_req: NextRequest, _ctx: IdContext, access) => {
  const list = await listGuests(getDb(), access.weddingId)
  return list ? json(list) : notFound()
})

/** 201 Guest: one guest added by hand. A retry with the same id gives the same guest back. Any member. */
export const POST = withWeddingRole(byWeddingId, 'editor', async (req: NextRequest, _ctx: IdContext, access) => {
  const body = await readBody(req, createGuestBody)
  if (!body.ok) return body.response
  const write = await refuseUnstorableText(() => createGuest(getDb(), access.weddingId, body.data))
  if (!write.ok) return write.response
  const result = write.value
  switch (result.status) {
    case 'created':
      return json(result.guest, 201)
    case 'id-taken':
      return json({ error: 'id_taken' }, 409)
    case 'not-found':
      return notFound()
  }
})
