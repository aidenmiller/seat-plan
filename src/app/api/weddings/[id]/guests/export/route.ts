import type { NextRequest } from 'next/server'
import { guestsCsvFileName, guestsToCsv } from '@/domain/csv/export'
import { idParam, notFound, type IdContext } from '@/server/api-route'
import { withSiteAuth } from '@/server/auth/require'
import { getDb } from '@/server/db/client'
import { listGroups } from '@/server/repo/groups'
import { listGuests } from '@/server/repo/guests'
import { getWedding } from '@/server/repo/weddings'

/** RFC 6266: a plain ASCII name for old browsers, and the full name in UTF-8. */
function contentDisposition(fileName: string): string {
  const ascii = fileName.normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/["\\%]/g, '').trim() || 'guests.csv'
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

/**
 * The guest list as CSV (the sample file's columns plus guest_id), as a
 * download. A re-import of this file reports no changes.
 */
export const GET = withSiteAuth(async (_req: NextRequest, ctx: IdContext) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const db = getDb()
  const wedding = await getWedding(db, id)
  if (!wedding) return notFound()
  const [guestList, groupList] = await Promise.all([listGuests(db, id), listGroups(db, id)])
  if (!guestList || !groupList) return notFound()
  const csv = guestsToCsv(guestList, groupList)
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': contentDisposition(guestsCsvFileName(wedding.name)),
      'Cache-Control': 'no-store',
    },
  })
})
