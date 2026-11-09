import 'server-only'
import { attachDatabasePool } from '@vercel/functions'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Pool } from 'pg'
import { createPool, requireDatabaseUrl } from './connection'
import * as schema from './schema'

export type Db = ReturnType<typeof makeDb>

function makeDb(pool: Pool) {
  return drizzle({ client: pool, schema, casing: 'snake_case' })
}

const cache = globalThis as unknown as { seatPlanPool?: Pool; seatPlanDb?: Db }

/**
 * One pool per server instance, made on first use so builds without a
 * database still work. On Vercel, attachDatabasePool keeps the instance alive
 * just long enough to close idle connections cleanly.
 */
export function getDb(): Db {
  if (!cache.seatPlanDb) {
    const pool = createPool(requireDatabaseUrl('pooled'))
    attachDatabasePool(pool)
    cache.seatPlanPool = pool
    cache.seatPlanDb = makeDb(pool)
  }
  return cache.seatPlanDb
}
