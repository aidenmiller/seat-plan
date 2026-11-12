import { NextResponse, type NextRequest } from 'next/server'
import type { BackupNowReply, WeddingBackupsReply } from '@/shared/backups-api'
import { json, notFound, type IdContext } from '@/server/api-route'
import { withWeddingRole } from '@/server/auth/guards'
import { byWeddingId } from '@/server/auth/resolvers'
import { busy, notConfigured, RUN_BUDGET_MS } from '@/server/backups/http'
import { runBackups } from '@/server/backups/runner'
import { getBackupStore } from '@/server/backups/store'
import { getDb } from '@/server/db/client'
import { recordEvent } from '@/server/repo/activity'
import { backupSummaryById, listWeddingBackups, recentManualBackupAt } from '@/server/repo/backups'

/** Backing up a wedding with large floor plan images can take a while. */
export const maxDuration = 300

/** One "Back up now" per wedding per 5 minutes. */
const MANUAL_INTERVAL_MS = 5 * 60_000

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
 * Back up now: a 'manual' backup, through the same job and lease as the
 * nightly run. 201 with the new backup; 200 'unchanged' with the newest
 * backup when nothing changed since it (nothing is uploaded); 429 within 5
 * minutes of the last manual backup; 409 while another run is going; 500
 * with a message when the backup failed; 503 without a backup store. Owners
 * only.
 */
export const POST = withWeddingRole(byWeddingId, 'owner', async (_req: NextRequest, _ctx: IdContext, access) => {
  const store = getBackupStore()
  if (!store) return notConfigured()
  const db = getDb()
  const recent = await recentManualBackupAt(db, access.weddingId, MANUAL_INTERVAL_MS)
  if (recent) {
    const retryAfter = Math.max(1, Math.ceil((recent.getTime() + MANUAL_INTERVAL_MS - Date.now()) / 1000))
    return NextResponse.json(
      { error: 'too_soon', message: 'This wedding was backed up less than 5 minutes ago.', retryAfter },
      { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': String(retryAfter) } },
    )
  }
  const summary = await runBackups(db, store, {
    trigger: 'owner',
    userId: access.user.id,
    weddingIds: [access.weddingId],
    kind: 'manual',
    deadline: Date.now() + RUN_BUDGET_MS,
  })
  if (summary.status === 'busy') return busy()
  const result = summary.results[0]
  if (!result || result.status === 'not-found') return notFound()
  if (result.status === 'failed') return json({ error: 'backup_failed', message: result.message ?? 'The backup failed.' }, 500)
  const backup = result.backupId ? await backupSummaryById(db, result.backupId) : null
  if (!backup) return json({ error: 'backup_failed', message: 'The backup failed.' }, 500)
  if (result.status === 'created') {
    await recordEvent(db, { kind: 'backup_created', userId: access.user.id, weddingId: access.weddingId, subjectId: backup.id, detail: { kind: 'manual' } })
  }
  const reply: BackupNowReply = { status: result.status, backup }
  return json(reply, result.status === 'created' ? 201 : 200)
})
