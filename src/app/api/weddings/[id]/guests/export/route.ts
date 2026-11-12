import type { NextRequest } from 'next/server'
import { guestsCsvFileName, guestsToCsv } from '@/domain/csv/export'
import { partnersOf } from '@/domain/partners'
import { attachmentDisposition, notFound, type IdContext } from '@/server/api-route'
import { withWeddingRole } from '@/server/auth/guards'
import { byWeddingId } from '@/server/auth/resolvers'
import { getDb } from '@/server/db/client'
import { listGroups } from '@/server/repo/groups'
import { listGuests } from '@/server/repo/guests'
import { getWedding } from '@/server/repo/weddings'

/**
 * The guest list as CSV (the sample file's columns plus guest_id), as a
 * download. A re-import of this file reports no changes. Any member.
 */
export const GET = withWeddingRole(byWeddingId, 'editor', async (_req: NextRequest, _ctx: IdContext, access) => {
  const id = access.weddingId
  const db = getDb()
  const wedding = await getWedding(db, id)
  if (!wedding) return notFound()
  const [guestList, groupList] = await Promise.all([listGuests(db, id), listGroups(db, id)])
  if (!guestList || !groupList) return notFound()
  const csv = guestsToCsv(guestList, groupList, partnersOf(wedding))
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': attachmentDisposition(guestsCsvFileName(wedding.name), 'guests.csv'),
      'Cache-Control': 'no-store',
    },
  })
})
