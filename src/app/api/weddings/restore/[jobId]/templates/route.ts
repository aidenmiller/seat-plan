import type { NextRequest } from 'next/server'
import { backupTemplateSchema } from '@/domain/backup/schema'
import type { RestoredTemplate } from '@/shared/api'
import { json, notFound, readBody } from '@/server/api-route'
import { withWeddingRole } from '@/server/auth/guards'
import { byRestoreJob } from '@/server/auth/resolvers'
import { restoreTemplate } from '@/server/backup'
import { getDb } from '@/server/db/client'
import { uuidOrNull, type JobContext } from '../../_job'

/**
 * Restore step 2, once per venue template in the file (PLAN change 5): reuse
 * the template if it is still here with the same walls and is in the library
 * or the caller's own, else make a private "<name> (restored)" owned by the
 * caller. Owners of the job's wedding only. Replies RestoredTemplate.
 */
export const POST = withWeddingRole<JobContext>(byRestoreJob, 'owner', async (req: NextRequest, ctx: JobContext, access) => {
  const jobId = uuidOrNull((await ctx.params).jobId)
  if (!jobId) return notFound()
  const body = await readBody(req, backupTemplateSchema)
  if (!body.ok) return body.response
  const result = await restoreTemplate(getDb(), jobId, body.data, access.user.id)
  if (result.status === 'not-found') return notFound()
  const reply: RestoredTemplate = { templateId: result.templateId, reused: result.reused, needsImage: result.needsImage }
  return json(reply)
})
