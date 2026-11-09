import { and, eq, isNull } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { makeTestDb, truncateAll } from '../../../test/db'
import { venueTemplates } from './schema'

const { pool, db } = makeTestDb()

beforeEach(async () => {
  await truncateAll(pool)
})
afterAll(async () => {
  await pool.end()
})

describe('migrations', () => {
  it('leave exactly one empty Toronto Beach Club template', async () => {
    const rows = await db
      .select()
      .from(venueTemplates)
      .where(and(eq(venueTemplates.name, 'Toronto Beach Club'), isNull(venueTemplates.deletedAt)))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.fixedItems).toEqual([])
  })
})
