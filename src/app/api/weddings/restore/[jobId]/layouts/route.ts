import type { NextRequest } from 'next/server'
import { backupLayoutSchema } from '@/domain/backup/schema'
import type { RestoredLayout } from '@/shared/api'
import { json, notFound, readBody, refuseUnstorableText } from '@/server/api-route'
import { withWeddingRole } from '@/server/auth/guards'
import { byRestoreJob } from '@/server/auth/resolvers'
import { restoreLayout } from '@/server/backup'
import { getDb } from '@/server/db/client'
import { uuidOrNull, type JobContext } from '../../_job'

/**
 * Restore step 4, once per layout: the layout under its new id, with its seats
 * pointing at the restored guests. Its venue must be one the caller may use
 * in the restored wedding; otherwise it gets a blank canvas. Owners of the
 * job's wedding only. 201 RestoredLayout; 200 when sent before.
 */
export const POST = withWeddingRole<JobContext>(byRestoreJob, 'owner', async (req: NextRequest, ctx: JobContext, access) => {
  const jobId = uuidOrNull((await ctx.params).jobId)
  if (!jobId) return notFound()
  const body = await readBody(req, backupLayoutSchema)
  if (!body.ok) return body.response
  const viewer = { userId: access.user.id, isAdmin: access.user.isAdmin }
  const written = await refuseUnstorableText(() => restoreLayout(getDb(), jobId, body.data, viewer))
  if (!written.ok) return written.response
  const result = written.value
  switch (result.status) {
    case 'created': {
      const reply: RestoredLayout = { layoutId: result.layoutId, droppedSeats: result.droppedSeats }
      return json(reply, result.existed ? 200 : 201)
    }
    case 'invalid':
      return json({ error: 'invalid', issues: result.issues }, 422)
    case 'id-taken':
      return json({ error: 'id_taken' }, 409)
    case 'not-found':
      return notFound()
  }
})
