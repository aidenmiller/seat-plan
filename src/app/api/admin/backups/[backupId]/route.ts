import type { NextRequest } from 'next/server'
import { notFound } from '@/server/api-route'
import { withAdmin } from '@/server/auth/guards'
import { backupIdParam, notConfigured, storedBackupDownload, type BackupIdContext } from '@/server/backups/http'
import { getBackupStore } from '@/server/backups/store'
import { getDb } from '@/server/db/client'
import { getBackup } from '@/server/repo/backups'

/**
 * Any stored backup, a deleted wedding's included, as a normal backup file
 * (the same format and file name as Download backup, with the backup's
 * date). Admins only (404 to anyone else).
 */
export const GET = withAdmin(async (_req: NextRequest, ctx: BackupIdContext) => {
  const backupId = await backupIdParam(ctx)
  if (!backupId) return notFound()
  const store = getBackupStore()
  if (!store) return notConfigured()
  const backup = await getBackup(getDb(), backupId, store.id)
  if (!backup) return notFound()
  return storedBackupDownload(store, backup)
})
