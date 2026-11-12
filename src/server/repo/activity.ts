import 'server-only'
import { eq, sql } from 'drizzle-orm'
import { PgTransaction } from 'drizzle-orm/pg-core'
import { WRITE_KINDS, counterKey, type WriteKind } from '@/domain/activity'
import { activityEvents } from '../db/schema'
import type { Db, Tx } from '../locks'

/**
 * The activity log: who did what, for the admin page and for working out
 * what happened later. Writing to it never fails the request that caused it:
 * an error is logged and swallowed. Inside a transaction the insert runs in a
 * savepoint, so a refused row cannot spoil the caller's transaction either.
 *
 * `detail` is for small facts (an old and new role, a method and path). It
 * must never hold a token, password or hash: keys that look like one are
 * dropped before the row is written.
 */

export const ACTIVITY_KINDS = [
  'setup_completed',
  'login',
  'logout',
  'password_changed',
  'reset_link_created',
  'reset_used',
  'invite_created',
  'invite_accepted',
  'invite_revoked',
  'member_added',
  'member_role_changed',
  'member_removed',
  'user_disabled',
  'user_enabled',
  'user_admin_changed',
  'wedding_created',
  'wedding_deleted',
  'wedding_restored',
  'admin_access',
  'backup_created',
  'backup_restored',
  'backup_run',
  // The admin pages (milestone 8): usage counters, the AI import quota, and the admin's own changes.
  ...WRITE_KINDS,
  'venue.ai_import',
  'wedding_undeleted',
  'ownership_transferred',
  'venue_library_changed',
  'venue_owner_changed',
  'activity_pruned',
] as const

export type ActivityKind = (typeof ACTIVITY_KINDS)[number]

const KINDS = new Set<string>(ACTIVITY_KINDS)

export type ActivityEvent = {
  kind: ActivityKind
  userId?: string | null
  weddingId?: string | null
  subjectId?: string | null
  detail?: Record<string, unknown>
  /** A second event with the same key is skipped, so a retry or a repeat view logs once. */
  dedupeKey?: string | null
}

/** Keys that could carry a secret. Matched anywhere in the key, any case. */
const SECRET_KEY = /token|password|passwd|secret|hash|cookie/i
/** A detail bigger than this, once written out as JSON, is replaced by a note saying so. */
const MAX_DETAIL_CHARS = 2000

/** The detail without keys that look like they hold a secret, at any depth. */
export function scrubDetail(value: unknown, depth = 0): unknown {
  if (depth > 5) return null
  if (Array.isArray(value)) return value.map((v) => scrubDetail(v, depth + 1))
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) continue
      out[key] = scrubDetail(v, depth + 1)
    }
    return out
  }
  return value
}

function detailFor(detail: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!detail) return {}
  const scrubbed = scrubDetail(detail) as Record<string, unknown>
  return JSON.stringify(scrubbed).length > MAX_DETAIL_CHARS ? { truncated: true } : scrubbed
}

/** Writes one event. Never throws. */
export async function recordEvent(db: Db | Tx, event: ActivityEvent): Promise<void> {
  try {
    if (!KINDS.has(event.kind)) throw new Error(`unknown activity kind ${String(event.kind)}`)
    const insert = (conn: Db | Tx) =>
      conn
        .insert(activityEvents)
        .values({
          kind: event.kind,
          userId: event.userId ?? null,
          weddingId: event.weddingId ?? null,
          subjectId: event.subjectId ?? null,
          detail: detailFor(event.detail),
          dedupeKey: event.dedupeKey ?? null,
        })
        // The only unique key apart from the id is the partial index on dedupe_key.
        .onConflictDoNothing()
    if (db instanceof PgTransaction) {
      await db.transaction(async (savepoint) => {
        await insert(savepoint)
      })
    } else {
      await insert(db)
    }
  } catch (err) {
    console.error(`activity: could not record ${String(event.kind)}:`, err instanceof Error ? err.message : err)
  }
}

// ---------------------------------------------------------------- usage counters (the admin pages)

export type WriteCount = { userId: string; weddingId: string | null; kind: WriteKind; at?: Date }

const COUNTER_KINDS = new Set<string>(WRITE_KINDS)

/**
 * Adds one to the hourly counter for this person, wedding (or none) and kind
 * of edit (src/domain/activity.ts): one row per UTC hour, found by its
 * once-only key, holding detail { count }, its occurred_at the latest change
 * it counts. Two calls at once each add one: the second insert meets the
 * first's row on the key and Postgres adds to it under the row lock. Written
 * as SQL because the conflict target is the partial unique index on
 * dedupe_key, which needs its WHERE repeated. Never throws.
 */
export async function countWrite(db: Db, change: WriteCount): Promise<void> {
  try {
    if (!COUNTER_KINDS.has(change.kind)) throw new Error(`not a counter kind: ${String(change.kind)}`)
    const at = change.at ?? new Date()
    await db.execute(sql`
      insert into activity_events (kind, user_id, wedding_id, detail, dedupe_key, occurred_at)
      values (
        ${change.kind}, ${change.userId}, ${change.weddingId}, '{"count": 1}'::jsonb,
        ${counterKey(change.kind, change.userId, change.weddingId, at)}, ${at.toISOString()}::timestamptz
      )
      on conflict (dedupe_key) where dedupe_key is not null
      do update set
        detail = jsonb_set(activity_events.detail, '{count}', to_jsonb(coalesce((activity_events.detail ->> 'count')::int, 0) + 1)),
        occurred_at = greatest(activity_events.occurred_at, excluded.occurred_at)
    `)
  } catch (err) {
    console.error(`activity: could not count ${String(change.kind)}:`, err instanceof Error ? err.message : err)
  }
}

/** Counter rows and admin reads are kept this long; everything else is kept. */
export const ACTIVITY_KEEP_DAYS = 400

/**
 * Deletes the counter rows, the admin_access events for reads (changes made
 * through an admin's power stay) and the daily prune markers that are older
 * than ACTIVITY_KEEP_DAYS. Returns how many rows went.
 */
export async function pruneActivity(db: Db, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - ACTIVITY_KEEP_DAYS * 86_400_000)
  const result = await db.execute(sql`
    delete from activity_events
    where occurred_at < ${cutoff.toISOString()}::timestamptz
      and (
        kind like 'write.%'
        or (kind = 'admin_access' and coalesce(detail ->> 'write', 'false') <> 'true')
        or kind = 'activity_pruned'
      )
  `)
  return result.rowCount ?? 0
}

/**
 * pruneActivity at most once a UTC day: the first call of the day writes an
 * activity_pruned marker (its once-only key holds the day) and prunes; the
 * rest find the marker and stop. There is no scheduled job, so the admin
 * overview calls this after it renders. Never throws.
 */
export async function pruneActivityDaily(db: Db, now = new Date()): Promise<void> {
  try {
    const [marker] = await db
      .insert(activityEvents)
      .values({ kind: 'activity_pruned', occurredAt: now, dedupeKey: `activity_pruned:${now.toISOString().slice(0, 10)}` })
      .onConflictDoNothing()
      .returning({ id: activityEvents.id })
    if (!marker) return
    const deleted = await pruneActivity(db, now)
    await db.update(activityEvents).set({ detail: { deleted } }).where(eq(activityEvents.id, marker.id))
  } catch (err) {
    console.error('activity: could not prune:', err instanceof Error ? err.message : err)
  }
}
