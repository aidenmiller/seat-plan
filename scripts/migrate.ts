/**
 * Applies the SQL migrations in ./drizzle. Uses the direct (unpooled) URL when
 * there is one, since migrations should bypass the connection pooler.
 */
import { loadEnvConfig } from '@next/env'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { createPool, requireDatabaseUrl } from '../src/server/db/connection'

async function main() {
  loadEnvConfig(process.cwd())
  const pool = createPool(requireDatabaseUrl('direct'), { max: 1 })
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder: 'drizzle' })
    console.log('Migrations applied.')
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
