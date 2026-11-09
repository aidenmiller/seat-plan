import type { NextRequest } from 'next/server'
import { createGuestBody } from '@/shared/api'
import { idParam, json, notFound, readBody, refuseUnstorableText, type IdContext } from '@/server/api-route'
import { withSiteAuth } from '@/server/auth/require'
import { getDb } from '@/server/db/client'
import { createGuest, listGuests } from '@/server/repo/guests'

/** Guest[]: the wedding's live guests with their group ids and partner id. */
export const GET = withSiteAuth(async (_req: NextRequest, ctx: IdContext) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const list = await listGuests(getDb(), id)
  return list ? json(list) : notFound()
})

/** 201 Guest: one guest added by hand. A retry with the same id gives the same guest back. */
export const POST = withSiteAuth(async (req: NextRequest, ctx: IdContext) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const body = await readBody(req, createGuestBody)
  if (!body.ok) return body.response
  const write = await refuseUnstorableText(() => createGuest(getDb(), id, body.data))
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
