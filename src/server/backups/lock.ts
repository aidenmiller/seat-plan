import 'server-only'
import { sql } from 'drizzle-orm'
import type { Db } from '../locks'

/**
 * One wedding's backup lock: whoever backs a wedding up holds it, so the
 * nightly run and an owner's "Back up now" never back up the same wedding at
 * once, while each goes on with every other wedding. (Before, Back up now
 * took the whole job's lease, and one pressed at 08:00 UTC made the nightly
 * run skip every wedding.)
 *
 * An advisory lock held by a transaction, as locks.ts's weddingLock is, so it
 * works through Neon's pooler and is let go however the work ends. It has
 * its own key ('backup:wedding:<id>', not weddingLock's 'wedding:<id>'), so a
 * backup never holds up a save. The transaction only holds the lock: the work
 * runs on other connections of the pool, as it would without it.
 *
 * Never waits: when someone else holds the lock, it answers { locked: false }
 * at once and does nothing.
 */
export async function withWeddingBackupLock<T>(
  db: Db,
  weddingId: string,
  work: () => Promise<T>,
): Promise<{ locked: true; value: T } | { locked: false }> {
  const key = `backup:wedding:${weddingId.toLowerCase()}`
  const box: { done?: { value: T } } = {}
  try {
    const got = await db.transaction(async (tx) => {
      const result = await tx.execute<{ ok: boolean }>(sql`select pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) as ok`)
      if (result.rows[0]?.ok !== true) return false
      box.done = { value: await work() }
      return true
    })
    if (!got || !box.done) return { locked: false }
    return { locked: true, value: box.done.value }
  } catch (err) {
    // The work finished and only ending the lock's transaction failed (its connection dropped): the work stands.
    if (box.done) return { locked: true, value: box.done.value }
    throw err
  }
}
