import type { NextRequest } from 'next/server'
import { attachmentDisposition, idParam, notFound, type IdContext } from '@/server/api-route'
import { withSiteAuth } from '@/server/auth/require'
import { backupStream } from '@/server/backup'
import { getDb } from '@/server/db/client'

/**
 * The whole wedding as one JSON file, as a download (spec section 11). It is
 * streamed, so a file with large floor plan images is never held whole.
 */
export const GET = withSiteAuth(async (_req: NextRequest, ctx: IdContext) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const backup = await backupStream(getDb(), id)
  if (!backup) return notFound()
  return new Response(backup.stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': attachmentDisposition(backup.fileName, 'wedding backup.json'),
      'Cache-Control': 'no-store',
    },
  })
})
