/** The home page's list of weddings, against the test database: only the user's own, only live ones. */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { makeMember, makeUser } from '../../../test/auth'
import { makeTestDb, truncateAll } from '../../../test/db'
import { makeGuest, makeWedding } from './test-fixtures'
import { listWeddings, listWeddingsForUser, softDeleteWedding } from './weddings'

const { pool, db } = makeTestDb()

beforeEach(async () => {
  await truncateAll(pool)
})
afterAll(async () => {
  await pool.end()
})

describe('listWeddingsForUser', () => {
  it('lists the weddings the user belongs to, in the order listWeddings uses, with the same fields', async () => {
    const pat = await makeUser(db)
    const first = await makeWedding(db, 'First')
    const other = await makeWedding(db, 'Not Pat')
    const second = await makeWedding(db, 'Second')
    await makeMember(db, first, pat.id, 'owner')
    await makeMember(db, second, pat.id, 'editor')
    await makeGuest(db, first)

    const mine = await listWeddingsForUser(db, pat.id)
    expect(mine.map((w) => w.name)).toEqual(['First', 'Second'])
    expect(mine[0]!.guestCount).toBe(1)
    const all = await listWeddings(db)
    expect(all.map((w) => w.id)).toContain(other)
    expect(mine).toEqual(all.filter((w) => w.id !== other))
  })

  it("leaves out other users' weddings, even for an admin", async () => {
    const admin = await makeUser(db, { isAdmin: true })
    const sam = await makeUser(db)
    const wedding = await makeWedding(db, 'Sam only')
    await makeMember(db, wedding, sam.id, 'owner')
    expect(await listWeddingsForUser(db, admin.id)).toEqual([])
    expect((await listWeddingsForUser(db, sam.id)).map((w) => w.id)).toEqual([wedding])
  })

  it('leaves out deleted weddings', async () => {
    const pat = await makeUser(db)
    const kept = await makeWedding(db, 'Kept')
    const gone = await makeWedding(db, 'Gone')
    await makeMember(db, kept, pat.id, 'owner')
    await makeMember(db, gone, pat.id, 'owner')
    await softDeleteWedding(db, gone)
    expect((await listWeddingsForUser(db, pat.id)).map((w) => w.name)).toEqual(['Kept'])
  })

  it('is empty for someone with no weddings', async () => {
    const pat = await makeUser(db)
    await makeWedding(db)
    expect(await listWeddingsForUser(db, pat.id)).toEqual([])
  })
})
