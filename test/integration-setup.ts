import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { createPool } from '../src/server/db/connection'
import { TEST_DATABASE_URL, assertLocalDatabase } from './db'

/** Brings the test database up to the latest migration before any integration test runs. */
export default async function setup() {
  assertLocalDatabase(TEST_DATABASE_URL)
  const pool = createPool(TEST_DATABASE_URL, { max: 1 })
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder: 'drizzle' })
  } finally {
    await pool.end()
  }
}
