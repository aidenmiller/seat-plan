import type { NextRequest } from 'next/server'
import type { BackupNowReply, WeddingBackupsReply } from '@/shared/backups-api'
import { json, notFound, type IdContext } from '@/server/api-route'
import { withWeddingRole } from '@/server/auth/guards'
import { byWeddingId } from '@/server/auth/resolvers'
import { MANUAL_BACKUPS_PER_DAY, MANUAL_INTERVAL_MS, notConfigured, RUN_BUDGET_MS, tooMany, weddingBusy } from '@/server/backups/http'
import { runBackups } from '@/server/backups/runner'
import { getBackupStore } from '@/server/backups/store'
import { getDb } from '@/server/db/client'
import { recordEvent } from '@/server/repo/activity'
import { backupSummaryById, listWeddingBackups, manualBackupsBy, recentManualBackupAt } from '@/server/repo/backups'

/** Backing up a wedding with large floor plan images can take a while. */
export const maxDuration = 300

const DAY_MS = 86_400_000

/** The wedding's stored backups, newest first, and whether this deployment stores backups at all. Owners only. */
export const GET = withWeddingRole(byWeddingId, 'owner', async (_req: NextRequest, _ctx: IdContext, access) => {
  const store = getBackupStore()
  const reply: WeddingBackupsReply = {
    configured: store !== null,
    backups: store ? await listWeddingBackups(getDb(), access.weddingId, store.id) : [],
  }
  return json(reply)
})

/**
 * Back up now: a 'manual' backup of this wedding, through the same job as the
 * nightly run but under the wedding's own backup lock, never the job's lease,
 * so it runs beside a nightly run and never makes it skip a wedding
 * (backups/runner.ts). 201 with the new backup; 200 'unchanged' with the
 * newest backup when nothing changed since it (nothing is uploaded); 429
 * within 5 minutes of the last manual backup of this wedding, after
 * MANUAL_BACKUPS_PER_DAY manual backups by this person in 24 hours, or when
 * backups by hand have used their share of the upload limit (the rest is
 * kept for the nightly run); 409 while the nightly run is backing up this
 * wedding; 500 with a message when the backup failed; 503 without a backup
 * store. Owners only.
 */
export const POST = withWeddingRole(byWeddingId, 'owner', async (_req: NextRequest, _ctx: IdContext, access) => {
  const store = getBackupStore()
  if (!store) return notConfigured()
  const db = getDb()
  const recent = await recentManualBackupAt(db, access.weddingId, MANUAL_INTERVAL_MS)
  if (recent) {
    const retryAfter = Math.max(1, Math.ceil((recent.getTime() + MANUAL_INTERVAL_MS - Date.now()) / 1000))
    return tooMany('too_soon', 'This wedding was backed up less than 5 minutes ago.', retryAfter)
  }
  const mine = await manualBackupsBy(db, access.user.id, DAY_MS)
  if (mine.count >= MANUAL_BACKUPS_PER_DAY) {
    const retryAfter = mine.oldestAt ? Math.max(1, Math.ceil((mine.oldestAt.getTime() + DAY_MS - Date.now()) / 1000)) : null
    return tooMany(
      'daily_limit',
      `You have made ${MANUAL_BACKUPS_PER_DAY} backups by hand in the last 24 hours, the most allowed. The nightly backup still runs; try Back up now again tomorrow.`,
      retryAfter,
    )
  }
  const summary = await runBackups(db, store, {
    trigger: 'owner',
    userId: access.user.id,
    weddingIds: [access.weddingId],
    kind: 'manual',
    deadline: Date.now() + RUN_BUDGET_MS,
  })
  if (summary.status === 'busy') return weddingBusy()
  const result = summary.results[0]
  if (!result || result.status === 'not-found') return notFound()
  if (result.status === 'failed') {
    // Backups by hand have used their share of the upload limit: a pause, not a broken backup.
    if (summary.failures[0]?.reason === 'budget') return tooMany('upload_limit', result.message ?? 'Back up now is paused.', null)
    return json({ error: 'backup_failed', message: result.message ?? 'The backup failed.' }, 500)
  }
  const backup = result.backupId ? await backupSummaryById(db, result.backupId) : null
  if (!backup || (result.status !== 'created' && result.status !== 'unchanged')) return json({ error: 'backup_failed', message: 'The backup failed.' }, 500)
  if (result.status === 'created') {
    await recordEvent(db, { kind: 'backup_created', userId: access.user.id, weddingId: access.weddingId, subjectId: backup.id, detail: { kind: 'manual' } })
  }
  const reply: BackupNowReply = { status: result.status, backup }
  return json(reply, result.status === 'created' ? 201 : 200)
})
