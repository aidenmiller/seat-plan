import type { NextRequest } from 'next/server'
import { restoreBackupBody } from '@/shared/backups-api'
import { notFound, readBody } from '@/server/api-route'
import { withWeddingRole } from '@/server/auth/guards'
import { byWeddingId } from '@/server/auth/resolvers'
import { backupIdParam, notConfigured, restoreReply } from '@/server/backups/http'
import { restoreStoredBackup } from '@/server/backups/restore'
import { getBackupStore } from '@/server/backups/store'
import { getDb } from '@/server/db/client'
import { getWeddingBackup } from '@/server/repo/backups'

type Context = { params: Promise<{ id: string; backupId: string }> }

/** A restore runs every step on the server and may take a while. */
export const maxDuration = 300

/**
 * Restores one of this wedding's stored backups as a new wedding, "<name>
 * (restored)", owned by the caller (backups/restore.ts). Body { jobId }: the
 * same job id again finishes the same wedding (200) instead of making a
 * second (201). Another wedding's backup id answers 404; someone else's job
 * id 409; a backup that fails its checks 500 { error: 'corrupt' } with
 * nothing made. Owners only.
 */
export const POST = withWeddingRole<Context>(byWeddingId, 'owner', async (req: NextRequest, ctx: Context, access) => {
  const backupId = await backupIdParam(ctx)
  if (!backupId) return notFound()
  const body = await readBody(req, restoreBackupBody)
  if (!body.ok) return body.response
  const store = getBackupStore()
  if (!store) return notConfigured()
  const db = getDb()
  const backup = await getWeddingBackup(db, access.weddingId, backupId, store.id)
  if (!backup) return notFound()
  const result = await restoreStoredBackup(db, store, backup.id, {
    jobId: body.data.jobId,
    actor: { userId: access.user.id, isAdmin: access.user.isAdmin },
  })
  return restoreReply(body.data.jobId, result)
})
