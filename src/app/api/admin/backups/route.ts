import { ADMIN_BACKUP_LIST_LIMIT, type AdminBackupsReply } from '@/shared/backups-api'
import { json } from '@/server/api-route'
import { withAdmin } from '@/server/auth/guards'
import { NIGHTLY_RESERVE_30_DAYS, UPLOAD_BUDGET_30_DAYS } from '@/server/backups/runner'
import { getBackupStore } from '@/server/backups/store'
import { getDb } from '@/server/db/client'
import { cronRunTimes, listAllBackups, listRuns, manualUploadsLast30Days, storageUsed, uploadsLast30Days } from '@/server/repo/backups'

/**
 * The admin's view of backups: whether a store is set up, every stored
 * backup (deleted weddings' too) newest first, the recent runs with their
 * failures (a wedding that did not fit the backup format, one skipped for
 * the upload limit, a backup the self-check found unreadable, a nightly run
 * that could not start), storage used, the uploads of the last 30 days
 * against the job's limit and against the share backups by hand may use, and
 * when the nightly run last succeeded. Admins only (404 to anyone else).
 */
export const GET = withAdmin(async () => {
  const db = getDb()
  const store = getBackupStore()
  const [{ backups, total }, runs, storage, cron, uploads, manualUploads] = await Promise.all([
    listAllBackups(db, ADMIN_BACKUP_LIST_LIMIT, store?.id ?? null),
    listRuns(db, 30),
    storageUsed(db, store?.id ?? null),
    cronRunTimes(db),
    uploadsLast30Days(db),
    manualUploadsLast30Days(db),
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
    manualUploadsLast30Days: manualUploads,
    manualUploadLimit30Days: UPLOAD_BUDGET_30_DAYS - NIGHTLY_RESERVE_30_DAYS,
  }
  return json(reply)
})
