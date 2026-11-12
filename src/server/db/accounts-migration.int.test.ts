/**
 * Migration 0006 copies the old "Noa" / "Aiden" labels into edited_by_name and
 * puts the Toronto Beach Club in the shared library, without touching updated_at.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { makeTestDb, truncateAll } from '../../../test/db'
import { layouts, venueTemplates, weddings } from './schema'

const { pool, db } = makeTestDb()
const migration = readFileSync(path.resolve(process.cwd(), 'drizzle/0006_accounts_backfill.sql'), 'utf8')
// Only the UPDATE statements are replayed. The trigger statements (CREATE FUNCTION, CREATE CONSTRAINT TRIGGER)
// are not safe to run twice, and the test database already has them from the real migration.
const updates = migration
  .split('--> statement-breakpoint')
  .map((s) => s.trim())
  .filter((s) => /^(--[^\n]*\n)*\s*UPDATE /i.test(s))

async function runBackfill() {
  for (const statement of updates) await pool.query(statement)
}

const OLD = new Date('2026-01-01T00:00:00Z')

async function seed() {
  const [wedding] = await db.insert(weddings).values({ name: 'W' }).returning()
  const canvas = {} as never
  const [byNoa] = await db.insert(layouts).values({ weddingId: wedding!.id, name: 'A', kind: 'reception', canvas, editedBy: 'Noa', updatedAt: OLD }).returning()
  const [byAiden] = await db.insert(layouts).values({ weddingId: wedding!.id, name: 'B', kind: 'reception', canvas, editedBy: 'Aiden', updatedAt: OLD }).returning()
  const [byNobody] = await db.insert(layouts).values({ weddingId: wedding!.id, name: 'C', kind: 'reception', canvas, updatedAt: OLD }).returning()
  const [template] = await db.insert(venueTemplates).values({ name: 'Mine', editedBy: 'Aiden', updatedAt: OLD }).returning()
  return { byNoa: byNoa!, byAiden: byAiden!, byNobody: byNobody!, template: template! }
}

async function beachClub() {
  const [row] = await db.select().from(venueTemplates).where(eq(venueTemplates.name, 'Toronto Beach Club'))
  return row!
}

beforeEach(async () => {
  await truncateAll(pool) // leaves the Beach Club template, already in the library
  await pool.query(`update venue_templates set is_library = false where name = 'Toronto Beach Club'`)
})
afterAll(async () => {
  await pool.end()
})

describe('migration 0006: accounts backfill', () => {
  it('copies the old editor labels into the new name columns', async () => {
    const rows = await seed()
    await runBackfill()
    const get = async (id: string) => (await db.select().from(layouts).where(eq(layouts.id, id)))[0]!
    expect((await get(rows.byNoa.id)).editedByName).toBe('Noa')
    expect((await get(rows.byAiden.id)).editedByName).toBe('Aiden')
    expect((await get(rows.byNobody.id)).editedByName).toBeNull()
    const [template] = await db.select().from(venueTemplates).where(eq(venueTemplates.id, rows.template.id))
    expect(template!.editedByName).toBe('Aiden')
  })

  it('leaves updated_at alone and keeps the old columns', async () => {
    const rows = await seed()
    await runBackfill()
    const [layout] = await db.select().from(layouts).where(eq(layouts.id, rows.byNoa.id))
    expect(layout!.updatedAt).toEqual(OLD)
    expect(layout!.editedBy).toBe('Noa')
    const [template] = await db.select().from(venueTemplates).where(eq(venueTemplates.id, rows.template.id))
    expect(template!.updatedAt).toEqual(OLD)
    expect(template!.editedBy).toBe('Aiden')
  })

  it('puts only the Toronto Beach Club in the library', async () => {
    const rows = await seed()
    expect((await beachClub()).isLibrary).toBe(false)
    await runBackfill()
    expect((await beachClub()).isLibrary).toBe(true)
    const [mine] = await db.select().from(venueTemplates).where(eq(venueTemplates.id, rows.template.id))
    expect(mine!.isLibrary).toBe(false)
    expect(mine!.ownerUserId).toBeNull()
  })

  it('changes nothing the second time, and never overwrites a name set since', async () => {
    const rows = await seed()
    await runBackfill()
    await db.update(layouts).set({ editedByName: 'Renamed Person', updatedAt: OLD }).where(eq(layouts.id, rows.byNoa.id))
    const snapshot = async () => ({
      layouts: (await pool.query(`select id, edited_by_name, updated_at from layouts order by id`)).rows,
      templates: (await pool.query(`select id, edited_by_name, is_library, updated_at from venue_templates order by id`)).rows,
    })
    const first = await snapshot()
    await runBackfill()
    expect(await snapshot()).toEqual(first)
    expect(first.layouts.find((l) => l.id === rows.byNoa.id)!.edited_by_name).toBe('Renamed Person')
  })

  it('has the statements it is meant to replay', () => {
    expect(updates).toHaveLength(3)
  })
})
