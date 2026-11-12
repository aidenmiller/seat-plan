import type { NextRequest } from 'next/server'
import type { RunBackupsReply } from '@/shared/backups-api'
import { json } from '@/server/api-route'
import { withAdmin } from '@/server/auth/guards'
import { busy, notConfigured, RUN_BUDGET_MS, runCounts } from '@/server/backups/http'
import { runBackups } from '@/server/backups/runner'
import { getBackupStore } from '@/server/backups/store'
import { getDb } from '@/server/db/client'
import { recordEvent } from '@/server/repo/activity'
import { namedFailures } from '@/server/repo/backups'

/** The run may take Vercel's Hobby maximum; it stops starting weddings at 240 s. */
export const maxDuration = 300

/**
 * Runs the nightly backup now, and waits for it: the same job, lease and
 * pruning as the cron, its backups of kind 'nightly'. 200 with the counts and
 * each failure; 409 while another run is going; 503 without a backup store.
 * Admins only (404 to anyone else). Logged as backup_run.
 */
export const POST = withAdmin(async (_req: NextRequest, _ctx: unknown, user) => {
  const store = getBackupStore()
  if (!store) return notConfigured()
  const db = getDb()
  const summary = await runBackups(db, store, { trigger: 'admin', userId: user.id, deadline: Date.now() + RUN_BUDGET_MS })
  if (summary.status === 'busy') return busy()
  await recordEvent(db, {
    kind: 'backup_run',
    userId: user.id,
    subjectId: summary.runId,
    detail: { status: summary.status, backedUp: summary.backedUp, unchanged: summary.unchanged, failed: summary.failed },
  })
  const reply: RunBackupsReply = {
    ...runCounts(summary),
    runId: summary.runId,
    failures: await namedFailures(db, summary.failures),
    error: summary.error,
  }
  return json(reply)
})
