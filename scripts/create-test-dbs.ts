/**
 * Creates local test databases (and applies migrations), connecting as the
 * test role through TEST_DATABASE_URL. Pass a suffix to make a second set, for
 * running two checkouts side by side:
 *
 *   npx tsx scripts/create-test-dbs.ts          -> seating_test, seating_e2e
 *   npx tsx scripts/create-test-dbs.ts b        -> seating_test_b, seating_e2e_b
 *
 * Then point that checkout at them with TEST_DATABASE_URL, E2E_DATABASE_URL
 * and E2E_PORT. Refuses any server that is not on this machine.
 */
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { createPool } from '../src/server/db/connection'
import { TEST_DATABASE_URL, assertLocalDatabase } from '../test/db'

async function main() {
  const suffix = process.argv[2] ? `_${process.argv[2].replace(/[^a-z0-9]/gi, '').toLowerCase()}` : ''
  assertLocalDatabase(TEST_DATABASE_URL)
  const admin = createPool(TEST_DATABASE_URL, { max: 1 })
  const names = [`seating_test${suffix}`, `seating_e2e${suffix}`]
  try {
    for (const name of names) {
      const exists = await admin.query('select 1 from pg_database where datname = $1', [name])
      if (exists.rowCount === 0) {
        await admin.query(`create database "${name}"`)
        console.log(`Made ${name}.`)
      } else {
        console.log(`${name} already exists.`)
      }
    }
  } finally {
    await admin.end()
  }
  for (const name of names) {
    const url = new URL(TEST_DATABASE_URL)
    url.pathname = `/${name}`
    const pool = createPool(url.toString(), { max: 1 })
    try {
      await migrate(drizzle({ client: pool }), { migrationsFolder: 'drizzle' })
    } finally {
      await pool.end()
    }
  }
  console.log('Migrations applied.')
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
