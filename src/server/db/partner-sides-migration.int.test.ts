/**
 * Migration 0007 names every wedding so far Noa and Aiden, and turns each
 * guest's side into its place ('Noa' -> partner1, 'Aiden' -> partner2,
 * 'Both' -> both), without touching updated_at. The side check still takes the
 * old words for one release, so an older deployment keeps working during a build.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { makeTestDb, truncateAll } from '../../../test/db'
import { guests, weddings } from './schema'

const { pool, db } = makeTestDb()
const migration = readFileSync(path.resolve(process.cwd(), 'drizzle/0007_partner_names.sql'), 'utf8')
// Only the UPDATE statements are replayed: the test database already has the columns and checks.
const updates = migration
  .split('--> statement-breakpoint')
  .map((s) => s.trim())
  .filter((s) => /^(--[^\n]*\n)*\s*UPDATE /i.test(s))

async function runBackfill() {
  for (const statement of updates) await pool.query(statement)
}

const OLD = new Date('2026-01-01T00:00:00Z')

/** Rows as the app wrote them before 0007: no partner names, sides as names. Raw SQL, since the schema's types only know the codes. */
async function seed() {
  const [old] = await db.insert(weddings).values({ name: 'Noa & Aiden', updatedAt: OLD }).returning({ id: weddings.id })
  const [named] = await db
    .insert(weddings)
    .values({ name: 'Sam & Alex', partner1Name: 'Sam', partner2Name: 'Alex', updatedAt: OLD })
    .returning({ id: weddings.id })
  const guest = async (weddingId: string, first: string, side: string) => {
    const { rows } = await pool.query<{ id: string }>(
      `insert into guests (wedding_id, first_name, last_name, name_key, side, updated_at) values ($1, $2, 'Lee', $3, $4, $5) returning id`,
      [weddingId, first, `${first.toLowerCase()}|lee`, side, OLD],
    )
    return rows[0]!.id
  }
  return {
    old: old!.id,
    named: named!.id,
    noa: await guest(old!.id, 'Ann', 'Noa'),
    aiden: await guest(old!.id, 'Ben', 'Aiden'),
    both: await guest(old!.id, 'Cy', 'Both'),
    code: await guest(named!.id, 'Dee', 'partner2'),
  }
}

const sideOf = async (id: string) => (await db.select({ side: guests.side, updatedAt: guests.updatedAt }).from(guests).where(eq(guests.id, id)))[0]!
const weddingOf = async (id: string) => (await db.select().from(weddings).where(eq(weddings.id, id)))[0]!

beforeEach(async () => {
  await truncateAll(pool)
})
afterAll(async () => {
  await pool.end()
})

describe('migration 0007: partner names and guest sides', () => {
  it('still takes the old side words, so a deployment from before keeps working', async () => {
    const rows = await seed()
    expect((await sideOf(rows.noa)).side).toBe('Noa')
    await expect(pool.query(`update guests set side = 'Bride' where id = $1`, [rows.noa])).rejects.toThrow(/guests_side_valid/)
  })

  it('names the weddings without names Noa and Aiden, and leaves named ones alone', async () => {
    const rows = await seed()
    await runBackfill()
    expect(await weddingOf(rows.old)).toMatchObject({ partner1Name: 'Noa', partner2Name: 'Aiden' })
    expect(await weddingOf(rows.named)).toMatchObject({ partner1Name: 'Sam', partner2Name: 'Alex' })
  })

  it('turns sides into places: Noa partner 1, Aiden partner 2, Both both', async () => {
    const rows = await seed()
    await runBackfill()
    expect((await sideOf(rows.noa)).side).toBe('partner1')
    expect((await sideOf(rows.aiden)).side).toBe('partner2')
    expect((await sideOf(rows.both)).side).toBe('both')
    expect((await sideOf(rows.code)).side).toBe('partner2')
  })

  it('leaves updated_at alone', async () => {
    const rows = await seed()
    await runBackfill()
    for (const id of [rows.noa, rows.aiden, rows.both, rows.code]) expect((await sideOf(id)).updatedAt).toEqual(OLD)
    expect((await weddingOf(rows.old)).updatedAt).toEqual(OLD)
  })

  it('changes nothing the second time, and never overwrites names set since', async () => {
    const rows = await seed()
    await runBackfill()
    await db.update(weddings).set({ partner1Name: 'Noah', partner2Name: null, updatedAt: OLD }).where(eq(weddings.id, rows.old))
    const snapshot = async () => ({
      weddings: (await pool.query(`select id, partner1_name, partner2_name, updated_at from weddings order by id`)).rows,
      guests: (await pool.query(`select id, side, updated_at from guests order by id`)).rows,
    })
    const first = await snapshot()
    await runBackfill()
    expect(await snapshot()).toEqual(first)
    expect(await weddingOf(rows.old)).toMatchObject({ partner1Name: 'Noah', partner2Name: null })
  })

  it('makes both the default side for a new guest', async () => {
    const rows = await seed()
    const { rows: made } = await pool.query<{ side: string }>(
      `insert into guests (wedding_id, first_name, last_name, name_key) values ($1, 'Eve', 'Lee', 'eve|lee') returning side`,
      [rows.named],
    )
    expect(made[0]!.side).toBe('both')
  })

  it('refuses a blank or over-long partner name', async () => {
    const rows = await seed()
    await expect(pool.query(`update weddings set partner1_name = '  ' where id = $1`, [rows.named])).rejects.toThrow(/weddings_partner1_name_valid/)
    await expect(pool.query(`update weddings set partner2_name = $2 where id = $1`, [rows.named, 'x'.repeat(61)])).rejects.toThrow(
      /weddings_partner2_name_valid/,
    )
  })

  it('has the statements it is meant to replay', () => {
    expect(updates).toHaveLength(2)
  })
})
