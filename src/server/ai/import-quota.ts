import 'server-only'
import { sql } from 'drizzle-orm'
import { activityEvents } from '../db/schema'
import type { Viewer } from '../auth/venue-access'
import type { Db } from '../locks'

/**
 * A cap on AI floor plan imports per planner, because each one calls the
 * Anthropic API on the site owner's key. Each import is a venue.ai_import
 * event (activity_events); a planner may start AI_IMPORT_MONTHLY_LIMIT of them
 * in any 30 days (default 10; 0 lets only admins import). Admins are never
 * capped, but their imports are logged too, so the admin pages count them.
 *
 * An import counts when it starts, whatever happens to the model call after:
 * a call that fails part way may still have been paid for.
 */

export const DEFAULT_AI_IMPORT_MONTHLY_LIMIT = 10
export const AI_IMPORT_WINDOW_DAYS = 30

/** The cap from AI_IMPORT_MONTHLY_LIMIT: a whole number 0 or more, else the default. */
export function aiImportMonthlyLimit(raw: string | undefined = process.env.AI_IMPORT_MONTHLY_LIMIT): number {
  const text = raw?.trim() ?? ''
  if (!/^\d{1,9}$/.test(text)) return DEFAULT_AI_IMPORT_MONTHLY_LIMIT
  return Number(text)
}

/** What the import dialog says when the cap is reached. */
export function importLimitMessage(used: number, limit: number): string {
  if (limit === 0) return 'AI floor plan imports are turned off for planners on this site. Ask the admin, or trace the plan by hand.'
  const imports = limit === 1 ? '1 AI floor plan import' : `${limit} AI floor plan imports`
  return `You have used your ${imports} for the last ${AI_IMPORT_WINDOW_DAYS} days (${used} so far). Ask the admin, or trace the plan by hand.`
}

export type ImportReservation = { ok: true } | { ok: false; used: number; limit: number }

/**
 * Takes one import from the viewer's allowance, or says it is used up. In one
 * transaction: a per-person advisory lock (so two imports started at once
 * queue up and cannot both take the last one), the count of their imports in
 * the last 30 days, and, when under the cap, the new venue.ai_import event.
 * Throws when the database fails: no reservation, no model call.
 */
export async function reserveAiImport(db: Db, viewer: Viewer, templateId: string, limit = aiImportMonthlyLimit()): Promise<ImportReservation> {
  return db.transaction(async (tx): Promise<ImportReservation> => {
    if (!viewer.isAdmin) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`ai-import:${viewer.userId}`}, 0))`)
      const counted = await tx.execute<{ used: number }>(sql`
        select count(*)::int as used from "activity_events"
        where "user_id" = ${viewer.userId} and "kind" = 'venue.ai_import'
          and "occurred_at" > now() - make_interval(days => ${AI_IMPORT_WINDOW_DAYS})
      `)
      const used = Number(counted.rows[0]?.used ?? 0)
      if (used >= limit) return { ok: false, used, limit }
    }
    await tx.insert(activityEvents).values({ kind: 'venue.ai_import', userId: viewer.userId, subjectId: templateId })
    return { ok: true }
  })
}
