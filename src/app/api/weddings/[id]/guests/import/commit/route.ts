import type { NextRequest } from 'next/server'
import { importCommitBody, type ImportNeedsReview } from '@/shared/api'
import { idParam, json, notFound, refuseUnstorableText, type IdContext } from '@/server/api-route'
import { withSiteAuth } from '@/server/auth/require'
import { getDb } from '@/server/db/client'
import { commitImport } from '@/server/repo/guest-import'
import { readRowsBody } from '../../_rows-body'

/**
 * ImportCommitResult: applies the import in one transaction. The server
 * builds the plan again and never trusts one the browser holds.
 * 422 ImportNeedsReview while a needs-review row has no pick; 409
 * { error: 'stale' } when removeMissing is on and the missing guests differ
 * from missingGuestIds; 413 over 5,000 rows.
 */
export const POST = withSiteAuth(async (req: NextRequest, ctx: IdContext) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const body = await readRowsBody(req, importCommitBody, 'rows')
  if (!body.ok) return body.response
  const write = await refuseUnstorableText(() => commitImport(getDb(), id, body.data))
  if (!write.ok) return write.response
  const result = write.value
  switch (result.status) {
    case 'done':
      return json(result.result)
    case 'needs-review': {
      const reply: ImportNeedsReview = {
        error: 'needs_review',
        issues: result.items.map((i) => `Row ${i.rowNumber}: pick which guest this is, or add as new (${i.message})`),
        rowNumbers: result.items.map((i) => i.rowNumber),
      }
      return json(reply, 422)
    }
    case 'stale':
      return json(
        {
          error: 'stale',
          message: 'The guest list changed since this summary was made. Check the summary again.',
        },
        409,
      )
    case 'not-found':
      return notFound()
  }
})
