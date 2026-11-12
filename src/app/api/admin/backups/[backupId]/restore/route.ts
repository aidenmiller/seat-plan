import type { NextRequest } from 'next/server'
import { restoreBackupBody } from '@/shared/backups-api'
import { notFound, readBody } from '@/server/api-route'
import { withAdmin } from '@/server/auth/guards'
import { backupIdParam, notConfigured, restoreReply, type BackupIdContext } from '@/server/backups/http'
import { restoreStoredBackup } from '@/server/backups/restore'
import { getBackupStore } from '@/server/backups/store'
import { getDb } from '@/server/db/client'
import { getBackup } from '@/server/repo/backups'

/** A restore runs every step on the server and may take a while. */
export const maxDuration = 300

/**
 * Restores any stored backup, a deleted wedding's included, as a new wedding
 * "<name> (restored)" owned by the admin; when the source wedding still
 * exists and the admin is not one of its owners, its owners become owners of
 * the restored wedding too (backups/restore.ts). Body { jobId }, as for the
 * owner's restore. Admins only (404 to anyone else).
 */
export const POST = withAdmin(async (req: NextRequest, ctx: BackupIdContext, user) => {
  const backupId = await backupIdParam(ctx)
  if (!backupId) return notFound()
  const body = await readBody(req, restoreBackupBody)
  if (!body.ok) return body.response
  const db = getDb()
  const backup = await getBackup(db, backupId)
  if (!backup) return notFound()
  const store = getBackupStore()
  if (!store) return notConfigured()
  const result = await restoreStoredBackup(db, store, backup.id, { jobId: body.data.jobId, actor: { userId: user.id, isAdmin: true } })
  return restoreReply(body.data.jobId, result)
})
