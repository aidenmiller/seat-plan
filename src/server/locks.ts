import 'server-only'
import { sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type * as schema from './db/schema'

/** The app's database (getDb()) or the test database; both are built the same way. */
export type Db = NodePgDatabase<typeof schema>
/** The handle inside db.transaction(). */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/**
 * The per-wedding lock (PLAN section 5, "Saving layouts"), held until the
 * transaction ends. Canvas writes take it shared, so saves to different
 * layouts run side by side. Guest removal, CSV import and partner changes take
 * it exclusive, so a save and a removal never interleave. A transaction that
 * already holds it exclusive can also take it shared: Postgres never makes a
 * transaction wait for its own lock.
 */
export async function weddingLock(tx: Tx, weddingId: string, mode: 'shared' | 'exclusive'): Promise<void> {
  const key = `wedding:${weddingId}`
  if (mode === 'shared') {
    await tx.execute(sql`select pg_advisory_xact_lock_shared(hashtextextended(${key}, 0))`)
  } else {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`)
  }
}
