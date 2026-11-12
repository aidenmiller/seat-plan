import type { NextRequest } from 'next/server'
import { attachmentDisposition, json, notFound, type IdContext } from '@/server/api-route'
import { withWeddingRole } from '@/server/auth/guards'
import { byWeddingId } from '@/server/auth/resolvers'
import { backupStream } from '@/server/backup'
import { getDb } from '@/server/db/client'

/**
 * The whole wedding as one JSON file, as a download (spec section 11). Owners
 * only: the file holds every guest and the member list. It is streamed, so a
 * file with large floor plan images is never held whole.
 *
 * The file is checked against the backup format first, as every stored
 * backup is: a wedding that does not fit answers 500 { error: 'unrestorable' }
 * naming the field (never its value), rather than hand over a file that
 * Restore from file would refuse.
 */
export const GET = withWeddingRole(byWeddingId, 'owner', async (_req: NextRequest, _ctx: IdContext, access) => {
  const backup = await backupStream(getDb(), access.weddingId)
  if (!backup) return notFound()
  if (!backup.ok) {
    return json({ error: 'unrestorable', message: `This wedding cannot be saved as a backup file: ${backup.problem}.` }, 500)
  }
  return new Response(backup.stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': attachmentDisposition(backup.fileName, 'wedding backup.json'),
      'Cache-Control': 'no-store',
    },
  })
})
