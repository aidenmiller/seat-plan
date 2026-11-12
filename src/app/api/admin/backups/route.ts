import type { NextRequest } from 'next/server'
import { ADMIN_BACKUP_LIST_LIMIT, type AdminBackupsReply } from '@/shared/backups-api'
import { json } from '@/server/api-route'
import { withAdmin } from '@/server/auth/guards'
import { UPLOAD_BUDGET_30_DAYS } from '@/server/backups/runner'
import { getBackupStore } from '@/server/backups/store'
import { getDb } from '@/server/db/client'
import { cronRunTimes, listAllBackups, listRuns, storageUsed, uploadsLast30Days } from '@/server/repo/backups'

/**
 * The admin's view of backups: whether a store is set up, every stored
 * backup (deleted weddings' too) newest first, the recent runs with their
 * failures, storage used, the uploads of the last 30 days against the job's
 * limit, and when the nightly run last succeeded. Admins only (404 to
 * anyone else).
 */
export const GET = withAdmin(async (_req: NextRequest) => {
  const db = getDb()
  const store = getBackupStore()
  const [{ backups, total }, runs, storage, cron, uploads] = await Promise.all([
    listAllBackups(db, ADMIN_BACKUP_LIST_LIMIT),
    listRuns(db, 30),
    storageUsed(db),
    cronRunTimes(db),
    uploadsLast30Days(db),
  ])
  const reply: AdminBackupsReply = {
    configured: store !== null,
    storeKind: store?.kind ?? null,
    backups,
    totalBackups: total,
    runs,
    storage,
    lastSuccessfulCronRunAt: cron.lastSuccessAt?.toISOString() ?? null,
    lastCronRun: cron.last ? { startedAt: cron.last.startedAt.toISOString(), status: cron.last.status } : null,
    uploadsLast30Days: uploads,
    uploadLimit30Days: UPLOAD_BUDGET_30_DAYS,
  }
  return json(reply)
})
