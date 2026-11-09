import type { NextRequest } from 'next/server'
import { importPreviewBody } from '@/shared/api'
import { idParam, json, notFound, type IdContext } from '@/server/api-route'
import { withSiteAuth } from '@/server/auth/require'
import { getDb } from '@/server/db/client'
import { previewImport } from '@/server/repo/guest-import'
import { readRowsBody } from '../../_rows-body'

/**
 * ImportPreview: the re-import summary the server builds from the rows and
 * picks (new, changed with their fields, unchanged, needs review, missing,
 * duplicates, partner problems), plus the seats in live layouts held by
 * guests missing from the file. Saves nothing. Over 5,000 rows gives 413.
 */
export const POST = withSiteAuth(async (req: NextRequest, ctx: IdContext) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const body = await readRowsBody(req, importPreviewBody, 'rows')
  if (!body.ok) return body.response
  const preview = await previewImport(getDb(), id, body.data)
  return preview ? json(preview) : notFound()
})
