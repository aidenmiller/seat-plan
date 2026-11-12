import type { NextRequest } from 'next/server'
import { bulkGuestsBody } from '@/shared/api'
import { json, notFound, refuseUnstorableText, type IdContext } from '@/server/api-route'
import { withWeddingRole } from '@/server/auth/guards'
import { byWeddingId } from '@/server/auth/resolvers'
import { getDb } from '@/server/db/client'
import { addGuestsBulk } from '@/server/repo/guests'
import { readRowsBody } from '../_rows-body'

/**
 * 201 Guest[]: pasted names, added in one transaction (all or nothing), in
 * the order sent. Over 5,000 names gives 413. Any member.
 */
export const POST = withWeddingRole(byWeddingId, 'editor', async (req: NextRequest, _ctx: IdContext, access) => {
  const body = await readRowsBody(req, bulkGuestsBody, 'guests')
  if (!body.ok) return body.response
  const write = await refuseUnstorableText(() => addGuestsBulk(getDb(), access.weddingId, body.data.guests))
  if (!write.ok) return write.response
  const result = write.value
  switch (result.status) {
    case 'created':
      return json(result.guests, 201)
    case 'id-taken':
      return json({ error: 'id_taken' }, 409)
    case 'not-found':
      return notFound()
  }
})
