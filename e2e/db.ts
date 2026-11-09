/**
 * Straight to the end-to-end database, for setting up many guests in one
 * statement (the speed test's 400). Tests that need a few guests can also
 * use the guest routes (e2e/guest-list.ts). Local databases only.
 */
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { nameKey } from '../src/domain/names'
import { assertLocalDatabase } from '../test/db'

/** Adds guests to a wedding and returns their ids, in order. */
export async function dbAddGuests(weddingId: string, names: readonly (readonly [first: string, last: string])[]): Promise<string[]> {
  const url = process.env.E2E_DATABASE_URL
  if (!url) throw new Error('E2E_DATABASE_URL is not set; run through playwright.config.ts')
  assertLocalDatabase(url)
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    // One statement for any number of guests, with ids made here so their order is known.
    const ids = names.map(() => randomUUID())
    await client.query(
      `insert into guests (id, wedding_id, first_name, last_name, name_key)
       select id, $1, f, l, k from unnest($2::uuid[], $3::text[], $4::text[], $5::text[]) as n(id, f, l, k)`,
      [weddingId, ids, names.map((n) => n[0]), names.map((n) => n[1]), names.map(([f, l]) => nameKey(f, l))],
    )
    return ids
  } finally {
    await client.end()
  }
}
