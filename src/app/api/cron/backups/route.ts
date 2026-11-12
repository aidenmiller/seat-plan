import type { CronBackupsReply } from '@/shared/backups-api'
import { json } from '@/server/api-route'
import { withCronSecret } from '@/server/auth/guards'
import { CRON_LEASE_POLL_MS, CRON_LEASE_WAIT_MS, notConfigured, RUN_BUDGET_MS, runCounts } from '@/server/backups/http'
import { runBackups } from '@/server/backups/runner'
import { getBackupStore } from '@/server/backups/store'
import { getDb } from '@/server/db/client'

/** The whole run may take Vercel's Hobby maximum; it stops starting weddings at 240 s. */
export const maxDuration = 300
/** Never cached: every call runs. */
export const dynamic = 'force-dynamic'

/**
 * The nightly backup (vercel.json "crons", 08:00 UTC). Vercel Cron calls it
 * with GET; Vercel Schedules, which may replace Cron Jobs, call with POST, so
 * both run the same handler. Only a request carrying the cron secret gets
 * past withCronSecret (401 otherwise, before the database is touched).
 *
 * Vercel never calls a cron again, so when another full run holds the lease
 * (an admin's Run now, or a second delivery of this call) it waits for it,
 * looking again every CRON_LEASE_POLL_MS for up to CRON_LEASE_WAIT_MS, out of
 * its own 240 s. An owner's Back up now never holds the lease, so it never
 * makes the nightly run wait.
 *
 * Replies with counts only. 200 when every wedding was backed up or found
 * unchanged, or when the run stopped at its deadline with nothing failed
 * (the next run picks up the rest). 409 when the other run was still going
 * after the wait: nothing was backed up, and the run is recorded as failed,
 * so the admin page shows it. 500 when any wedding failed, the self-check
 * found a backup unreadable, pruning failed or the run itself did, so
 * Vercel's cron log shows it. 503 when this deployment has no backup store.
 */
const run = withCronSecret(async () => {
  const store = getBackupStore()
  if (!store) return notConfigured()
  const summary = await runBackups(getDb(), store, {
    trigger: 'cron',
    deadline: Date.now() + RUN_BUDGET_MS,
    leaseWaitMs: CRON_LEASE_WAIT_MS,
    leasePollMs: CRON_LEASE_POLL_MS,
  })
  const reply: CronBackupsReply = runCounts(summary)
  if (summary.status === 'busy') return json(reply, 409)
  const troubled = summary.status === 'failed' || summary.failed > 0 || summary.failures.length > 0 || summary.error !== null
  return json(reply, troubled ? 500 : 200)
})

export const GET = run
export const POST = run
