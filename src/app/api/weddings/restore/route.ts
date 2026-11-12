import { randomUUID } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { restoreStartSchema } from '@/domain/backup/schema'
import type { RestoreStarted } from '@/shared/api'
import { json, readBody } from '@/server/api-route'
import { withUser } from '@/server/auth/guards'
import { startRestore } from '@/server/backup'
import { getDb } from '@/server/db/client'

/**
 * Restore step 1: the backup's wedding, guests, groups, members, rules and
 * rule guests become a new wedding under new ids, with the caller as its
 * owner and only member. 201 RestoreStarted; 200 when the same job id was
 * sent before by someone who belongs to that wedding; 409 { error:
 * 'id_taken' } for anyone else. The later steps go to
 * /api/weddings/restore/<jobId>/templates and /layouts, owners of the new
 * wedding only.
 */
export const POST = withUser(async (req: NextRequest, _ctx: unknown, user) => {
  const body = await readBody(req, restoreStartSchema)
  if (!body.ok) return body.response
  const result = await startRestore(getDb(), body.data, body.data.jobId ?? randomUUID(), user.id)
  if (result.status === 'id-taken') return json({ error: 'id_taken' }, 409)
  const reply: RestoreStarted = { jobId: result.jobId, weddingId: result.weddingId, weddingName: result.weddingName }
  return json(reply, result.existed ? 200 : 201)
})
