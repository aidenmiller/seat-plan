/**
 * Demo data so every feature can be tried without real guests (spec section 12).
 * Made-up names only, from a fixed seed, so every run gives the same data.
 * Safe to run twice: it skips anything that already exists.
 *
 * This first version makes the demo wedding. Each milestone adds what it needs:
 * guests, groups, couples and rules (milestone 4 onward), layouts (2 onward),
 * ceremony rows (8) and notes (9). The Toronto Beach Club template comes from a
 * migration, so production has it too.
 */
import { loadEnvConfig } from '@next/env'
import { and, eq, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { createPool, requireDatabaseUrl } from '../src/server/db/connection'
import * as schema from '../src/server/db/schema'

export const DEMO_WEDDING_NAME = 'Demo wedding'

async function main() {
  loadEnvConfig(process.cwd())
  const pool = createPool(requireDatabaseUrl('direct'), { max: 1 })
  const db = drizzle({ client: pool, schema, casing: 'snake_case' })
  try {
    const existing = await db
      .select({ id: schema.weddings.id })
      .from(schema.weddings)
      .where(and(eq(schema.weddings.name, DEMO_WEDDING_NAME), isNull(schema.weddings.deletedAt)))
    if (existing.length > 0) {
      console.log(`"${DEMO_WEDDING_NAME}" already exists; nothing to do.`)
      return
    }
    await db.insert(schema.weddings).values({ name: DEMO_WEDDING_NAME, date: '2027-06-19', unit: 'ft' })
    console.log(`Made "${DEMO_WEDDING_NAME}".`)
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
