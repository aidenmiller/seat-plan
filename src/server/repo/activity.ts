import 'server-only'
import { PgTransaction } from 'drizzle-orm/pg-core'
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
  'wedding_created',
  'wedding_deleted',
  'wedding_restored',
  'admin_access',
  'backup_created',
  'backup_restored',
  'backup_run',
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
