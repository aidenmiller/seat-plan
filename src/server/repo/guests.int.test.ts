/**
 * Guest removal across layouts (PLAN change 7, section 5 "Removing a guest"),
 * against the test database, including a save racing the removal.
 */
import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { makeTestDb } from '../../../test/db'
import { guests, layoutSeats, layouts, weddings } from '../db/schema'
import { removeGuests } from './guests'
import { saveLayout } from './layouts'
import {
  canvasOf,
  canvasSeats,
  chairRow,
  layoutRow,
  makeGuest,
  makeLayout,
  makeWedding,
  roundTable,
  seatRows,
} from './test-fixtures'

const { pool, db } = makeTestDb()
afterAll(async () => {
  await pool.end()
})

async function guestRow(id: string) {
  const [row] = await db.select().from(guests).where(eq(guests.id, id))
  return row!
}

async function link(a: string, b: string) {
  await db.update(guests).set({ partnerId: b, coupleRuleEnabled: false }).where(eq(guests.id, a))
  await db.update(guests).set({ partnerId: a, coupleRuleEnabled: false }).where(eq(guests.id, b))
}

function save(layoutId: string, baseVersion: number, canvas: ReturnType<typeof canvasOf>) {
  return saveLayout(db, layoutId, { baseVersion, saveId: randomUUID(), editedBy: 'Aiden', tabId: 'tab', canvas })
}

describe('removeGuests', () => {
  it('clears seats in every layout without changing versions, lists only live layouts, and unlinks partners', async () => {
    const w = await makeWedding(db)
    const [ann, ben, cy] = [await makeGuest(db, w, 'Ann'), await makeGuest(db, w, 'Ben'), await makeGuest(db, w, 'Cy')]
    await link(ann, ben)
    const l1 = await makeLayout(db, w, canvasOf(roundTable('t1', 1, [ann, cy])), { name: 'Dinner' })
    const l2 = await makeLayout(db, w, canvasOf(chairRow('r1', 1, [null, ann], 'Left')), { name: 'Ceremony', kind: 'ceremony' })
    const l3 = await makeLayout(db, w, canvasOf(roundTable('t1', 4, [ann], 'Head')), { name: 'Old idea' })
    const untouched = await makeLayout(db, w, canvasOf(roundTable('t1', 1, [cy])), { name: 'Other' })
    // Layout 1 has been saved a few times, so its version is above 1.
    await save(l1, 1, canvasOf(roundTable('t1', 1, [ann, cy])))
    await db.update(layouts).set({ deletedAt: new Date() }).where(eq(layouts.id, l3))
    const before = await Promise.all([l1, l2, l3, untouched].map((id) => layoutRow(db, id)))

    const result = await removeGuests(db, w, [ann])
    expect(result).not.toBeNull()
    expect(result!.removed).toEqual([ann])
    // The deleted layout (Old idea) is rewritten below but not listed: nobody can see it.
    expect(result!.clearedSeats.sort((a, b) => a.layoutName.localeCompare(b.layoutName))).toEqual([
      { layoutId: l2, layoutName: 'Ceremony', itemLabel: 'Left, Row 1', guestId: ann },
      { layoutId: l1, layoutName: 'Dinner', itemLabel: 'Table 1', guestId: ann },
    ])

    const after = await Promise.all([l1, l2, l3, untouched].map((id) => layoutRow(db, id)))
    after.forEach((row, i) => {
      expect(row.version).toBe(before[i]!.version)
      expect(row.lastSaveId).toBe(before[i]!.lastSaveId)
      expect(row.updatedAt.getTime()).toBe(before[i]!.updatedAt.getTime())
      expect(canvasSeats(row.canvas).map((s) => s.guestId)).not.toContain(ann)
    })
    expect(after[0]!.version).toBe(2)
    expect(canvasSeats(after[0]!.canvas)).toEqual([{ guestId: cy, itemId: 't1', seatIndex: 1 }])
    expect(after[3]!.canvas).toEqual(before[3]!.canvas)
    // The deleted layout was still rewritten, so restoring it never brings the seat back.
    expect(canvasSeats(before[2]!.canvas).map((s) => s.guestId)).toEqual([ann])
    expect(canvasSeats(after[2]!.canvas)).toEqual([])
    expect(await seatRows(db, l3)).toEqual([])
    const leftover = await db.select().from(layoutSeats).where(eq(layoutSeats.guestId, ann))
    expect(leftover).toEqual([])
    expect(await seatRows(db, l1)).toEqual([{ guestId: cy, itemId: 't1', itemLabel: 'Table 1', seatIndex: 1 }])

    const [annRow, benRow] = [await guestRow(ann), await guestRow(ben)]
    expect(annRow.deletedAt).not.toBeNull()
    expect(annRow.partnerId).toBeNull()
    expect(benRow.deletedAt).toBeNull()
    expect(benRow.partnerId).toBeNull()
    expect(benRow.coupleRuleEnabled).toBe(true)
  })

  it('lets an editor holding the old canvas still save; the save drops the seat', async () => {
    const w = await makeWedding(db)
    const [ann, ben] = [await makeGuest(db, w, 'Ann'), await makeGuest(db, w, 'Ben')]
    const old = canvasOf(roundTable('t1', 1, [ann, ben]))
    const layoutId = await makeLayout(db, w, old)

    await removeGuests(db, w, [ann])
    const edited = canvasOf(roundTable('t1', 1, [ann, ben]), roundTable('t2', 2, [null]))
    const result = await save(layoutId, 1, edited)
    expect(result).toMatchObject({
      status: 'saved',
      version: 2,
      dropped: [{ itemId: 't1', seatIndex: 0, guestId: ann, reason: 'removed-guest' }],
    })
    const row = await layoutRow(db, layoutId)
    expect(row.canvas.items.map((i) => i.id)).toEqual(['t1', 't2'])
    expect(canvasSeats(row.canvas)).toEqual([{ guestId: ben, itemId: 't1', seatIndex: 1 }])
    expect((await seatRows(db, layoutId)).map((s) => s.guestId)).toEqual([ben])
  })

  it('removes two partners together, skips unknown ids and ids already removed', async () => {
    const w = await makeWedding(db)
    const [ann, ben, cy] = [await makeGuest(db, w, 'Ann'), await makeGuest(db, w, 'Ben'), await makeGuest(db, w, 'Cy')]
    await link(ann, ben)
    const first = await removeGuests(db, w, [ann, ben, randomUUID()])
    expect(first!.removed.sort()).toEqual([ann, ben].sort())
    expect((await guestRow(ann)).partnerId).toBeNull()
    expect((await guestRow(ben)).partnerId).toBeNull()
    expect((await removeGuests(db, w, [ann]))!.removed).toEqual([])
    expect((await guestRow(cy)).deletedAt).toBeNull()
  })

  it('touches nothing in another wedding, and answers null for a deleted wedding', async () => {
    const w = await makeWedding(db)
    const other = await makeWedding(db)
    const stranger = await makeGuest(db, other, 'Stranger')
    expect(await removeGuests(db, w, [stranger])).toEqual({ removed: [], clearedSeats: [] })
    expect((await guestRow(stranger)).deletedAt).toBeNull()

    await db.update(weddings).set({ deletedAt: new Date() }).where(eq(weddings.id, other))
    expect(await removeGuests(db, other, [stranger])).toBeNull()
    expect((await guestRow(stranger)).deletedAt).toBeNull()
  })

  it('a save racing the removal never leaves a live seat for the removed guest (20 rounds)', async () => {
    const w = await makeWedding(db)
    const keeper = await makeGuest(db, w, 'Keeper')
    const layoutId = await makeLayout(db, w)
    let version = 1
    const orders = new Set<string>()

    for (let round = 0; round < 20; round++) {
      const doomed = await makeGuest(db, w, `Doomed${round}`)
      // The guest sits in the stored layout, and the editor's next save still seats them.
      const seated = canvasOf(roundTable('t1', 1, [keeper, doomed]), roundTable(`extra${round}`, 2 + round, [null]))
      const landed = await save(layoutId, version, seated)
      if (landed.status !== 'saved') throw new Error(`setup save: ${landed.status}`)
      version = landed.version

      const [saved, removal] = await Promise.all([save(layoutId, version, seated), removeGuests(db, w, [doomed])])
      expect(removal!.removed).toEqual([doomed])
      expect(saved.status).toBe('saved')
      if (saved.status !== 'saved') continue
      version = saved.version
      // Whichever ran first, the seat is gone: cleared by the removal, or dropped by the save.
      orders.add(saved.dropped.length > 0 ? 'removal first' : 'save first')

      const row = await layoutRow(db, layoutId)
      expect(canvasSeats(row.canvas)).toEqual([{ guestId: keeper, itemId: 't1', seatIndex: 0 }])
      const seats = await db
        .select()
        .from(layoutSeats)
        .where(and(eq(layoutSeats.layoutId, layoutId), inArray(layoutSeats.guestId, [doomed])))
      expect(seats).toEqual([])
      expect((await seatRows(db, layoutId)).map((s) => s.guestId)).toEqual([keeper])
    }
    // Not asserted, since timing decides it, but useful when reading a failure.
    expect(orders.size).toBeGreaterThan(0)
  })
})
