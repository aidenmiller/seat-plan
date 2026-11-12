/**
 * Migration 0008 adds the approximate Liberty Grand Governor's Room to the
 * shared library. It must add it once, without an owner, never touch a
 * planner's own venue of the same name, hold only items the app accepts, and
 * match scripts/venue-templates/liberty-grand-governors-room.json.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { and, eq, isNull } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { makeTestDb, truncateAll } from '../../../test/db'
import { boxOfPoints, distanceToSegment } from '../../domain/geometry'
import { fixedItemsSchema, type FixedItem } from '../../domain/venue-schema'
import { venueTemplateRevisions, venueTemplates } from './schema'

const { pool, db } = makeTestDb()
const root = process.cwd()
const migration = readFileSync(path.resolve(root, 'drizzle/0008_liberty_grand_governors_room.sql'), 'utf8')
const statements = migration.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean)
const spec = JSON.parse(readFileSync(path.resolve(root, 'scripts/venue-templates/liberty-grand-governors-room.json'), 'utf8')) as {
  id: string
  name: string
  fixedItems: unknown[]
}
const NAME = "Liberty Grand – Governor's Room (approximate)"

async function runMigration() {
  for (const statement of statements) await pool.query(statement)
}

async function templates() {
  return db
    .select()
    .from(venueTemplates)
    .where(and(eq(venueTemplates.name, NAME), isNull(venueTemplates.deletedAt)))
}

async function template() {
  const rows = await templates()
  expect(rows).toHaveLength(1)
  return rows[0]!
}

beforeEach(async () => {
  await truncateAll(pool) // the migration is not replayed here, so start without the template
})
afterAll(async () => {
  await pool.end()
})

describe('migration 0008: Liberty Grand Governor\'s Room', () => {
  it('adds one library template with no owner and items the app accepts', async () => {
    expect(await templates()).toHaveLength(0)
    await runMigration()
    const row = await template()
    expect(row.id).toBe(spec.id)
    expect(row.isLibrary).toBe(true)
    expect(row.ownerUserId).toBeNull()
    expect(row.importedBy).toBe('hand')
    expect(row.version).toBe(1)
    expect(fixedItemsSchema.safeParse(row.fixedItems).success).toBe(true)
  })

  it('leaves exactly one save revision, and a second run changes nothing', async () => {
    await runMigration()
    const first = await template()
    await runMigration()
    const second = await template()
    expect(second).toEqual(first)
    const revisions = await db.select().from(venueTemplateRevisions).where(eq(venueTemplateRevisions.templateId, first.id))
    expect(revisions).toHaveLength(1)
    expect(revisions[0]!.reason).toBe('save')
    expect(revisions[0]!.fixedItems).toEqual(first.fixedItems)
  })

  it('adds nothing when a live template with the same name exists', async () => {
    const [mine] = await db.insert(venueTemplates).values({ name: NAME }).returning()
    await runMigration()
    const rows = await templates()
    expect(rows.map((r) => r.id)).toEqual([mine!.id])
    expect(rows[0]!.fixedItems).toEqual([])
    const revisions = await db.select().from(venueTemplateRevisions)
    expect(revisions).toHaveLength(0)
  })

  it('is added even when a deleted template has the same name', async () => {
    await db.insert(venueTemplates).values({ name: NAME, deletedAt: new Date() })
    await runMigration()
    expect(await templates()).toHaveLength(1)
  })

  it('matches the JSON file it was built from', async () => {
    await runMigration()
    expect((await template()).fixedItems).toEqual(spec.fixedItems)
  })

  describe('geometry', () => {
    async function items(): Promise<FixedItem[]> {
      await runMigration()
      return (await template()).fixedItems
    }
    const byId = (list: FixedItem[], id: string) => list.find((i) => i.id === id)!

    it('has a room 5243 x 1859 cm', async () => {
      const room = byId(await items(), 'room')
      if (room.type !== 'room') throw new Error('room is not a room')
      const box = boxOfPoints(room.points)!
      expect(Math.abs(box.maxX - box.minX - 5243)).toBeLessThanOrEqual(1)
      expect(Math.abs(box.maxY - box.minY - 1859)).toBeLessThanOrEqual(1)
    })

    it('puts the stairs and the bar inside the room', async () => {
      const list = await items()
      const room = byId(list, 'room')
      if (room.type !== 'room') throw new Error('room is not a room')
      const box = boxOfPoints(room.points)!
      for (const id of ['st-oak', 'bar-back']) {
        const item = byId(list, id)
        if (item.type !== 'stairs' && item.type !== 'bar') throw new Error(`${id} is not a box item`)
        expect(item.rotation).toBe(0)
        expect(item.x - item.width / 2).toBeGreaterThanOrEqual(box.minX)
        expect(item.x + item.width / 2).toBeLessThanOrEqual(box.maxX)
        expect(item.y - item.height / 2).toBeGreaterThanOrEqual(box.minY)
        expect(item.y + item.height / 2).toBeLessThanOrEqual(box.maxY)
      }
    })

    it('puts every door and window on its wall', async () => {
      const list = await items()
      const openings = list.filter((i) => i.type === 'door' || i.type === 'window')
      expect(openings.length).toBeGreaterThan(0)
      for (const o of openings) {
        if (o.type !== 'door' && o.type !== 'window') continue
        expect(o.wallId, o.id).not.toBeNull()
        const wall = list.find((i) => i.id === o.wallId)
        if (!wall || wall.type !== 'wall') throw new Error(`${o.id} has no wall ${o.wallId}`)
        const [a, b] = wall.points
        expect(distanceToSegment({ x: o.x, y: o.y }, a!, b!), o.id).toBeLessThanOrEqual(1)
      }
    })

    it('marks no item as unsure', async () => {
      const list = await items()
      expect(list.filter((i) => i.unsure).map((i) => i.id)).toEqual([])
      expect(list.filter((i) => i.unsureNote.trim().length > 0).map((i) => i.id)).toEqual([])
    })
  })
})
