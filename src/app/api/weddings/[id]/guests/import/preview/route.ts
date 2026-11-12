import type { NextRequest } from 'next/server'
import { importPreviewBody } from '@/shared/api'
import { json, notFound, type IdContext } from '@/server/api-route'
import { withWeddingRole } from '@/server/auth/guards'
import { byWeddingId } from '@/server/auth/resolvers'
import { getDb } from '@/server/db/client'
import { previewImport } from '@/server/repo/guest-import'
import { readRowsBody } from '../../_rows-body'

/**
 * ImportPreview: the re-import summary the server builds from the rows and
 * picks (new, changed with their fields, unchanged, needs review, missing,
 * duplicates, partner problems), plus the seats in live layouts held by
 * guests missing from the file. Saves nothing. Over 5,000 rows gives 413.
 * Any member.
 */
export const POST = withWeddingRole(byWeddingId, 'editor', async (req: NextRequest, _ctx: IdContext, access) => {
  const body = await readRowsBody(req, importPreviewBody, 'rows')
  if (!body.ok) return body.response
  const preview = await previewImport(getDb(), access.weddingId, body.data)
  return preview ? json(preview) : notFound()
})
