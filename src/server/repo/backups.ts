import 'server-only'
import { and, count, desc, eq, gt, inArray, sql, sum } from 'drizzle-orm'
import type {
  AdminBackupSummary,
  BackupFailureInfo,
  BackupRunInfo,
  BackupStorageUsage,
  BackupSummary,
} from '@/shared/backups-api'
import { backupImages, backupRuns, backups, users, weddings, type BackupFailure } from '../db/schema'
import type { Db } from '../locks'

/**
 * Reads of the stored-backup tables for the routes (src/server/backups is
 * the job that writes them). A wedding's own backups are always looked up
 * with its id, so a backup id from another wedding reads as missing.
 */

export type BackupRow = typeof backups.$inferSelect

const summaryColumns = {
  id: backups.id,
  weddingId: backups.weddingId,
  weddingName: backups.weddingName,
  kind: backups.kind,
  createdAt: backups.createdAt,
  checkedAt: backups.checkedAt,
  byteSize: backups.byteSize,
  guestCount: backups.guestCount,
  layoutCount: backups.layoutCount,
  createdByName: users.displayName,
}

type SummaryRow = { [K in keyof typeof summaryColumns]: K extends 'createdByName' ? string | null : BackupRow[K & keyof BackupRow] }

function toSummary(row: SummaryRow): BackupSummary {
  return {
    id: row.id,
    weddingId: row.weddingId,
    weddingName: row.weddingName,
    kind: row.kind,
    createdAt: row.createdAt.toISOString(),
    checkedAt: row.checkedAt.toISOString(),
    byteSize: Number(row.byteSize),
    guestCount: row.guestCount,
    layoutCount: row.layoutCount,
    createdByName: row.createdByName ?? null,
  }
}

/** A wedding's backups, newest first. */
export async function listWeddingBackups(db: Db, weddingId: string): Promise<BackupSummary[]> {
  const rows = await db
    .select(summaryColumns)
    .from(backups)
    .leftJoin(users, eq(users.id, backups.createdBy))
    .where(eq(backups.weddingId, weddingId))
    .orderBy(desc(backups.createdAt), desc(backups.id))
  return rows.map(toSummary)
}

/** One backup by id, as a summary. */
export async function backupSummaryById(db: Db, backupId: string): Promise<BackupSummary | null> {
  const [row] = await db.select(summaryColumns).from(backups).leftJoin(users, eq(users.id, backups.createdBy)).where(eq(backups.id, backupId))
  return row ? toSummary(row) : null
}

/** The backup, only when it belongs to this wedding. */
export async function getWeddingBackup(db: Db, weddingId: string, backupId: string): Promise<BackupRow | null> {
  const [row] = await db
    .select()
    .from(backups)
    .where(and(eq(backups.id, backupId), eq(backups.weddingId, weddingId)))
  return row ?? null
}

/** Any backup, for the admin. */
export async function getBackup(db: Db, backupId: string): Promise<BackupRow | null> {
  const [row] = await db.select().from(backups).where(eq(backups.id, backupId))
  return row ?? null
}

/** When the newest manual backup of this wedding younger than `withinMs` was made, or null. */
export async function recentManualBackupAt(db: Db, weddingId: string, withinMs: number): Promise<Date | null> {
  const [row] = await db
    .select({ createdAt: backups.createdAt })
    .from(backups)
    .where(
      and(
        eq(backups.weddingId, weddingId),
        eq(backups.kind, 'manual'),
        gt(backups.createdAt, sql`now() - make_interval(secs => ${withinMs / 1000})`),
      ),
    )
    .orderBy(desc(backups.createdAt))
    .limit(1)
  return row?.createdAt ?? null
}

/** Every backup, newest first, with whether its wedding is live, deleted, or gone altogether. */
export async function listAllBackups(db: Db, limit: number): Promise<{ backups: AdminBackupSummary[]; total: number }> {
  const rows = await db
    .select({ ...summaryColumns, weddingDeletedAt: weddings.deletedAt, weddingExists: weddings.id })
    .from(backups)
    .leftJoin(users, eq(users.id, backups.createdBy))
    .leftJoin(weddings, eq(weddings.id, backups.weddingId))
    .orderBy(desc(backups.createdAt), desc(backups.id))
    .limit(limit)
  const [total] = await db.select({ n: count() }).from(backups)
  return {
    backups: rows.map((r) => ({
      ...toSummary(r),
      weddingState: r.weddingExists === null ? 'gone' : r.weddingDeletedAt === null ? 'live' : 'deleted',
    })),
    total: total?.n ?? 0,
  }
}

async function weddingNames(db: Db, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const rows = await db.select({ id: weddings.id, name: weddings.name }).from(weddings).where(inArray(weddings.id, ids))
  return new Map(rows.map((r) => [r.id, r.name]))
}

/** Failures with each wedding's current name (null when the wedding is gone). */
export async function namedFailures(db: Db, failures: readonly BackupFailure[]): Promise<BackupFailureInfo[]> {
  const names = await weddingNames(db, [...new Set(failures.map((f) => f.weddingId))])
  return failures.map((f) => ({ weddingId: f.weddingId, weddingName: names.get(f.weddingId) ?? null, message: f.message }))
}

/** The newest runs, newest first. */
export async function listRuns(db: Db, limit: number): Promise<BackupRunInfo[]> {
  const rows = await db
    .select({
      id: backupRuns.id,
      trigger: backupRuns.trigger,
      startedByName: users.displayName,
      startedAt: backupRuns.startedAt,
      heartbeatAt: backupRuns.heartbeatAt,
      finishedAt: backupRuns.finishedAt,
      status: backupRuns.status,
      backedUp: backupRuns.backedUp,
      unchanged: backupRuns.unchanged,
      failed: backupRuns.failed,
      remaining: backupRuns.remaining,
      failures: backupRuns.failures,
      error: backupRuns.error,
    })
    .from(backupRuns)
    .leftJoin(users, eq(users.id, backupRuns.startedBy))
    .orderBy(desc(backupRuns.startedAt), desc(backupRuns.id))
    .limit(limit)
  const names = await weddingNames(db, [...new Set(rows.flatMap((r) => r.failures.map((f) => f.weddingId)))])
  return rows.map((r) => ({
    ...r,
    startedByName: r.startedByName ?? null,
    startedAt: r.startedAt.toISOString(),
    heartbeatAt: r.heartbeatAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    failures: r.failures.map((f) => ({ weddingId: f.weddingId, weddingName: names.get(f.weddingId) ?? null, message: f.message })),
  }))
}

/** What the store holds, by the database's count: backup files and images, and their sizes. */
export async function storageUsed(db: Db): Promise<BackupStorageUsage> {
  const [files] = await db.select({ n: count(), bytes: sum(backups.byteSize) }).from(backups)
  const [images] = await db.select({ n: count(), bytes: sum(backupImages.byteSize) }).from(backupImages)
  const backupBytes = Number(files?.bytes ?? 0)
  const imageBytes = Number(images?.bytes ?? 0)
  return { backupCount: files?.n ?? 0, backupBytes, imageCount: images?.n ?? 0, imageBytes, totalBytes: backupBytes + imageBytes }
}

/** The start of the newest cron run that finished 'ok', and the newest cron run of any outcome. */
export async function cronRunTimes(db: Db): Promise<{ lastSuccessAt: Date | null; last: { startedAt: Date; status: BackupRunInfo['status'] } | null }> {
  const [success] = await db
    .select({ startedAt: backupRuns.startedAt })
    .from(backupRuns)
    .where(and(eq(backupRuns.trigger, 'cron'), eq(backupRuns.status, 'ok')))
    .orderBy(desc(backupRuns.startedAt))
    .limit(1)
  const [last] = await db
    .select({ startedAt: backupRuns.startedAt, status: backupRuns.status })
    .from(backupRuns)
    .where(eq(backupRuns.trigger, 'cron'))
    .orderBy(desc(backupRuns.startedAt))
    .limit(1)
  return { lastSuccessAt: success?.startedAt ?? null, last: last ?? null }
}

/** Uploads to the store in the last 30 days (what the upload limit counts, runner.ts). */
export async function uploadsLast30Days(db: Db): Promise<number> {
  const result = await db.execute<{ n: string }>(sql`
    select (select count(*) from backups where created_at > now() - interval '30 days')
         + (select count(*) from backup_images where created_at > now() - interval '30 days') as n
  `)
  return Number(result.rows[0]?.n ?? 0)
}
