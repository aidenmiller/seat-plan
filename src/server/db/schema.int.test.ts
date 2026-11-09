/**
 * Checks that the database itself enforces the rules PLAN.md section 4 relies on.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { makeTestDb, truncateAll } from '../../../test/db'
import { emptyCanvas } from '../../domain/canvas-schema'
import { groupMembers, groups, guests, layoutSeats, layouts, weddings } from './schema'

const { pool, db } = makeTestDb()

beforeEach(async () => {
  await truncateAll(pool)
})
afterAll(async () => {
  await pool.end()
})

async function wedding(name = 'W') {
  const [row] = await db.insert(weddings).values({ name }).returning()
  return row!
}

async function guest(weddingId: string, first = 'Ann') {
  const [row] = await db.insert(guests).values({ weddingId, firstName: first, lastName: 'Lee', nameKey: `${first}|lee` }).returning()
  return row!
}

/** Postgres error code for a failed query, looking through drizzle's wrapper. */
async function pgError(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } }
    return e.code ?? e.cause?.code
  }
  return undefined
}

describe('schema constraints', () => {
  it('refuses blank names', async () => {
    expect(await pgError(db.insert(weddings).values({ name: '   ' }))).toBe('23514')
  })

  it('refuses a partner from another wedding, and a guest as their own partner', async () => {
    const a = await wedding('A')
    const b = await wedding('B')
    const ga = await guest(a.id)
    const gb = await guest(b.id)
    const { eq } = await import('drizzle-orm')
    expect(await pgError(db.update(guests).set({ partnerId: gb.id }).where(eq(guests.id, ga.id)))).toBe('23503')
    expect(await pgError(db.update(guests).set({ partnerId: ga.id }).where(eq(guests.id, ga.id)))).toBe('23514')
  })

  it('allows a partner to be linked once only', async () => {
    const w = await wedding()
    const [g1, g2, g3] = [await guest(w.id, 'A'), await guest(w.id, 'B'), await guest(w.id, 'C')]
    const { eq } = await import('drizzle-orm')
    await db.update(guests).set({ partnerId: g2.id }).where(eq(guests.id, g1.id))
    expect(await pgError(db.update(guests).set({ partnerId: g2.id }).where(eq(guests.id, g3.id)))).toBe('23505')
  })

  it('refuses a group member from another wedding', async () => {
    const a = await wedding('A')
    const b = await wedding('B')
    const [grp] = await db.insert(groups).values({ weddingId: a.id, name: 'Friends', color: '#336699' }).returning()
    const gb = await guest(b.id)
    expect(await pgError(db.insert(groupMembers).values({ weddingId: a.id, groupId: grp!.id, guestId: gb.id }))).toBe(
      '23503',
    )
  })

  it('treats group names that differ only in case as the same', async () => {
    const w = await wedding()
    await db.insert(groups).values({ weddingId: w.id, name: 'Noa Family', color: '#336699' })
    expect(await pgError(db.insert(groups).values({ weddingId: w.id, name: 'noa family', color: '#336699' }))).toBe(
      '23505',
    )
  })

  it('refuses a guest in two seats of one layout, and two guests in one seat', async () => {
    const w = await wedding()
    const g1 = await guest(w.id, 'A')
    const g2 = await guest(w.id, 'B')
    const [layout] = await db
      .insert(layouts)
      .values({ weddingId: w.id, name: 'Plan A', kind: 'reception', canvas: emptyCanvas() })
      .returning()
    const seat = { weddingId: w.id, layoutId: layout!.id, itemLabel: 'Table 1' }
    await db.insert(layoutSeats).values({ ...seat, guestId: g1.id, itemId: 't1', seatIndex: 0 })
    expect(await pgError(db.insert(layoutSeats).values({ ...seat, guestId: g1.id, itemId: 't2', seatIndex: 0 }))).toBe(
      '23505',
    )
    expect(await pgError(db.insert(layoutSeats).values({ ...seat, guestId: g2.id, itemId: 't1', seatIndex: 0 }))).toBe(
      '23505',
    )
  })

  it('refuses a seat for a guest of another wedding', async () => {
    const a = await wedding('A')
    const b = await wedding('B')
    const gb = await guest(b.id)
    const [layout] = await db
      .insert(layouts)
      .values({ weddingId: a.id, name: 'Plan A', kind: 'reception', canvas: emptyCanvas() })
      .returning()
    expect(
      await pgError(
        db
          .insert(layoutSeats)
          .values({ weddingId: a.id, layoutId: layout!.id, guestId: gb.id, itemId: 't1', itemLabel: 'T', seatIndex: 0 }),
      ),
    ).toBe('23503')
  })

  it('accepts ids made by the app', async () => {
    const id = randomUUID()
    const [row] = await db.insert(weddings).values({ id, name: 'With my id' }).returning()
    expect(row!.id).toBe(id)
  })
})
