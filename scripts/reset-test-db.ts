/**
 * Migrates and empties a local test database. Refuses anything that is not on
 * this machine. Uses E2E_DATABASE_URL, else TEST_DATABASE_URL.
 */
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { createPool } from '../src/server/db/connection'
import { assertLocalDatabase, truncateAll } from '../test/db'

export async function resetDatabase(url: string): Promise<void> {
  assertLocalDatabase(url)
  const pool = createPool(url, { max: 1 })
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder: 'drizzle' })
    await truncateAll(pool)
  } finally {
    await pool.end()
  }
}

if (process.argv[1]?.endsWith('reset-test-db.ts')) {
  const url = process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL
  if (!url) {
    console.error('Set E2E_DATABASE_URL or TEST_DATABASE_URL.')
    process.exit(1)
  }
  resetDatabase(url)
    .then(() => console.log('Test database reset.'))
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
