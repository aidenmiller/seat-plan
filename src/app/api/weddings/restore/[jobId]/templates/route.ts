import type { NextRequest } from 'next/server'
import { backupTemplateSchema } from '@/domain/backup/schema'
import type { RestoredTemplate } from '@/shared/api'
import { json, notFound, readBody } from '@/server/api-route'
import { withSiteAuth } from '@/server/auth/require'
import { restoreTemplate } from '@/server/backup'
import { getDb } from '@/server/db/client'
import { uuidOrNull, type JobContext } from '../../_job'

/**
 * Restore step 2, once per venue template in the file (PLAN change 5): reuse
 * the template if it is still here with the same walls, else make
 * "<name> (restored)". Replies RestoredTemplate.
 */
export const POST = withSiteAuth(async (req: NextRequest, ctx: JobContext) => {
  const jobId = uuidOrNull((await ctx.params).jobId)
  if (!jobId) return notFound()
  const body = await readBody(req, backupTemplateSchema)
  if (!body.ok) return body.response
  const result = await restoreTemplate(getDb(), jobId, body.data)
  if (result.status === 'not-found') return notFound()
  const reply: RestoredTemplate = { templateId: result.templateId, reused: result.reused, needsImage: result.needsImage }
  return json(reply)
})
