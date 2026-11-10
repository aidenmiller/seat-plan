/**
 * Migration 0004 fills the empty Toronto Beach Club template with the traced
 * venue. It must fill it once, leave an "undo" point, never overwrite edits,
 * and hold only items the app's schema accepts.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { and, eq, isNull } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { makeTestDb, truncateAll } from '../../../test/db'
import { fixedItemsSchema } from '../../domain/venue-schema'
import { venueTemplateRevisions, venueTemplates } from './schema'

const { pool, db } = makeTestDb()
const migration = readFileSync(path.resolve(process.cwd(), 'drizzle/0004_toronto_beach_club_fixed_items.sql'), 'utf8')
const statements = migration.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean)

async function runMigration() {
  for (const statement of statements) await pool.query(statement)
}

async function template() {
  const [row] = await db
    .select()
    .from(venueTemplates)
    .where(and(eq(venueTemplates.name, 'Toronto Beach Club'), isNull(venueTemplates.deletedAt)))
  return row!
}

beforeEach(async () => {
  await truncateAll(pool) // leaves the empty template from migration 0001
})
afterAll(async () => {
  await pool.end()
})

describe('migration 0004: Toronto Beach Club', () => {
  it('fills the empty template with items the app accepts', async () => {
    await runMigration()
    const row = await template()
    expect(fixedItemsSchema.safeParse(row.fixedItems).success).toBe(true)
    expect(row.fixedItems.length).toBeGreaterThan(100)
    expect(row.importedBy).toBe('ai')
    const zones = row.fixedItems.filter((i) => i.type === 'zone').map((i) => i.name)
    expect(zones).toEqual(expect.arrayContaining(['Mediterranean Room', 'Sunset Suite', 'Beachside Patio', 'Louis XIII Salon']))
  })

  it('leaves an empty revision before the import, so Undo import can go back', async () => {
    await runMigration()
    const row = await template()
    const revisions = await db
      .select()
      .from(venueTemplateRevisions)
      .where(eq(venueTemplateRevisions.templateId, row.id))
      .orderBy(venueTemplateRevisions.createdAt)
    expect(revisions.map((r) => r.reason)).toEqual(['save', 'import'])
    expect(revisions[0]!.fixedItems).toEqual([])
  })

  it('does nothing the second time, or when the template was already edited', async () => {
    await runMigration()
    const first = await template()
    await runMigration()
    const second = await template()
    expect(second.version).toBe(first.version)
    const revisions = await db.select().from(venueTemplateRevisions).where(eq(venueTemplateRevisions.templateId, first.id))
    expect(revisions).toHaveLength(2)

    await truncateAll(pool)
    const edited = await template()
    const mine = [{ id: 'w1', type: 'wall', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], thickness: 15, unsure: false, unsureNote: '' }]
    await db.update(venueTemplates).set({ fixedItems: mine as never }).where(eq(venueTemplates.id, edited.id))
    await runMigration()
    expect((await template()).fixedItems).toEqual(mine)
  })
})
