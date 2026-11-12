import type { NextRequest } from 'next/server'
import type { CronBackupsReply } from '@/shared/backups-api'
import { json } from '@/server/api-route'
import { withCronSecret } from '@/server/auth/guards'
import { notConfigured, RUN_BUDGET_MS, runCounts } from '@/server/backups/http'
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
 * Replies with counts only. 200 when every wedding was backed up or found
 * unchanged, when the run stopped at its deadline with nothing failed (the
 * next run picks up the rest), and when another run was already going
 * ('busy': Vercel may deliver one call twice). 500 when any wedding failed,
 * pruning failed or the run itself did, so Vercel's cron log shows it. 503
 * when this deployment has no backup store.
 */
const run = withCronSecret(async (_req: NextRequest) => {
  const store = getBackupStore()
  if (!store) return notConfigured()
  const summary = await runBackups(getDb(), store, { trigger: 'cron', deadline: Date.now() + RUN_BUDGET_MS })
  const reply: CronBackupsReply = runCounts(summary)
  const troubled = summary.status === 'failed' || summary.failed > 0 || summary.error !== null
  return json(reply, troubled ? 500 : 200)
})

export const GET = run
export const POST = run
