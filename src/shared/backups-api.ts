/**
 * The contract for stored backups (automatic nightly backups, "Back up now",
 * downloads and restores of stored backups, the admin's backup page): request
 * bodies (Zod, checked on the server) and reply shapes. Dates travel as ISO
 * strings; sizes are bytes.
 */
import { z } from 'zod'
import { uuid } from './api'

export type BackupKind = 'nightly' | 'manual' | 'final'

/** One stored backup. */
export type BackupSummary = {
  id: string
  weddingId: string
  /** The wedding's name when the backup was made. */
  weddingName: string
  /** nightly: the nightly run; manual: "Back up now"; final: the last copy of a deleted wedding. */
  kind: BackupKind
  createdAt: string
  /** The last time a run found the wedding unchanged since this backup (createdAt until then). */
  checkedAt: string
  /** Size as stored (gzipped, without the floor plan images, which are stored once each). */
  byteSize: number
  guestCount: number
  layoutCount: number
  /** Who asked for it, by display name: null for the nightly run, or an account that is gone. */
  createdByName: string | null
}

/** GET /api/weddings/:id/backups. `configured` is false when this deployment has no backup store. */
export type WeddingBackupsReply = { configured: boolean; backups: BackupSummary[] }

/** POST /api/weddings/:id/backups: 201 created, or 200 unchanged (the newest backup already holds everything). */
export type BackupNowReply = { status: 'created' | 'unchanged'; backup: BackupSummary }

/** POST .../backups/:backupId/restore. The browser picks the job id, so a retry after a lost reply finishes the same wedding. */
export const restoreBackupBody = z.object({ jobId: uuid.overwrite((v) => v.toLowerCase()) })
export type RestoreBackupBody = z.input<typeof restoreBackupBody>

/** 201 when the wedding was made now, 200 when the same job id was sent before. */
export type RestoredBackupReply = {
  jobId: string
  weddingId: string
  weddingName: string
  /** Seats left empty because their guest was not in the backup. */
  droppedSeats: number
  /** How many of the source wedding's owners were added (an admin's restore of someone else's wedding). */
  ownersAdded: number
}

/**
 * Counts from one run of the backup job. 'busy': another run was going, so
 * this one did nothing. `skipped`: weddings deleted during the run, or being
 * backed up by someone else at the time.
 */
export type BackupRunCounts = {
  status: 'ok' | 'partial' | 'failed' | 'busy'
  backedUp: number
  unchanged: number
  failed: number
  skipped: number
  remaining: number
  pruned: number
}

/** GET/POST /api/cron/backups: counts only. */
export type CronBackupsReply = BackupRunCounts

export type BackupFailureInfo = { weddingId: string; weddingName: string | null; message: string }

/** POST /api/admin/backups/run. */
export type RunBackupsReply = BackupRunCounts & { runId: string | null; failures: BackupFailureInfo[]; error: string | null }

export type BackupRunInfo = {
  id: string
  trigger: 'cron' | 'admin' | 'owner'
  startedByName: string | null
  startedAt: string
  heartbeatAt: string
  finishedAt: string | null
  status: 'running' | 'ok' | 'partial' | 'failed'
  backedUp: number
  unchanged: number
  failed: number
  remaining: number
  failures: BackupFailureInfo[]
  error: string | null
}

/**
 * A backup on the admin's list, with whether its wedding is still there, and
 * whether it is in the store this deployment uses (one in a store replaced
 * since cannot be downloaded or restored).
 */
export type AdminBackupSummary = BackupSummary & { weddingState: 'live' | 'deleted' | 'gone'; inThisStore: boolean }

export type BackupStorageUsage = { backupCount: number; backupBytes: number; imageCount: number; imageBytes: number; totalBytes: number }

/** GET /api/admin/backups. */
export type AdminBackupsReply = {
  configured: boolean
  storeKind: 'vercel-blob' | 'filesystem' | 'memory' | null
  /** Newest first, at most ADMIN_BACKUP_LIST_LIMIT. */
  backups: AdminBackupSummary[]
  totalBackups: number
  runs: BackupRunInfo[]
  storage: BackupStorageUsage
  lastSuccessfulCronRunAt: string | null
  lastCronRun: { startedAt: string; status: BackupRunInfo['status'] } | null
  /** Uploads (backup files and images) in the last 30 days, against the job's limit. */
  uploadsLast30Days: number
  uploadLimit30Days: number
  /** Of those, the uploads of backups made by hand ("Back up now"), against the share they may use (the rest is kept for the nightly run). */
  manualUploadsLast30Days: number
  manualUploadLimit30Days: number
}

export const ADMIN_BACKUP_LIST_LIMIT = 1000
