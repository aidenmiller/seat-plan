/**
 * writeCanvas() and the layout save against the test database (PLAN section 5,
 * "Saving layouts"): version check, saved-twice protection (recent saves),
 * seat cleanup, the layout_seats copy, and the layout row lock.
 */
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { makeTestDb } from '../../test/db'
import { makeUser } from '../../test/auth'
import { MAX_RECENT_SAVES, writeCanvas } from './canvas-write'
import { guests, layouts, venueTemplates, weddings } from './db/schema'
import { saveLayout, updateLayout } from './repo/layouts'
import {
  canvasOf,
  canvasSeats,
  chairRow,
  layoutRow,
  makeGuest,
  makeLayout,
  makeTemplate,
  makeWedding,
  roundTable,
  seatRows,
} from './repo/test-fixtures'

const { pool, db } = makeTestDb()
afterAll(async () => {
  await pool.end()
})

async function save(layoutId: string, baseVersion: number, canvas: unknown, extra: { saveId?: string; editedBy?: 'Noa' | 'Aiden' } = {}) {
  // The wedding a route's guard resolves from the layout; any wedding for a layout nobody made.
  const [row] = await db.select({ weddingId: layouts.weddingId }).from(layouts).where(eq(layouts.id, layoutId))
  return saveLayout(db, row?.weddingId ?? randomUUID(), layoutId, {
    baseVersion,
    saveId: extra.saveId ?? randomUUID(),
    editedBy: extra.editedBy ?? 'Noa',
    tabId: 'tab-1',
    canvas: canvas as never,
  })
}

describe('saving a layout', () => {
  it('lands with the right base version, raises the version and rebuilds layout_seats', async () => {
    const w = await makeWedding(db)
    const [ann, ben, cy] = [await makeGuest(db, w, 'Ann'), await makeGuest(db, w, 'Ben'), await makeGuest(db, w, 'Cy')]
    const layoutId = await makeLayout(db, w, canvasOf(roundTable('t1', 1, [ann, null])))
    expect(await seatRows(db, layoutId)).toEqual([{ guestId: ann, itemId: 't1', itemLabel: 'Table 1', seatIndex: 0 }])

    const saveId = randomUUID()
    const canvas = canvasOf(roundTable('t1', 3, [null, ben], 'Family'), chairRow('r1', 2, [ann, cy], "Noa's side"))
    const result = await save(layoutId, 1, canvas, { saveId, editedBy: 'Aiden' })
    expect(result).toMatchObject({ status: 'saved', version: 2, editedBy: 'Aiden', dropped: [] })

    const row = await layoutRow(db, layoutId)
    expect(row.version).toBe(2)
    expect(row.lastSaveId).toBe(saveId)
    expect(row.editedBy).toBe('Aiden')
    expect(row.canvas).toEqual(canvas)
    expect(row.thumbSvg).toMatch(/^<svg /)
    expect(await seatRows(db, layoutId)).toEqual([
      { guestId: ann, itemId: 'r1', itemLabel: "Noa's side, Row 2", seatIndex: 0 },
      { guestId: cy, itemId: 'r1', itemLabel: "Noa's side, Row 2", seatIndex: 1 },
      { guestId: ben, itemId: 't1', itemLabel: 'Family (table 3)', seatIndex: 1 },
    ])
  })

  it('answers a stale base version with a conflict naming the other editor', async () => {
    const w = await makeWedding(db)
    const layoutId = await makeLayout(db, w)
    const theirs = randomUUID()
    expect((await save(layoutId, 1, canvasOf(roundTable('t1', 1, [null])), { saveId: theirs, editedBy: 'Aiden' })).status).toBe(
      'saved',
    )

    const mine = await save(layoutId, 1, canvasOf(roundTable('t9', 9, [null])), { editedBy: 'Noa' })
    expect(mine).toMatchObject({ status: 'conflict', version: 2, editedBy: 'Aiden', lastSaveId: theirs })
    if (mine.status !== 'conflict') throw new Error('expected a conflict')
    expect(mine.updatedAt).toBeInstanceOf(Date)
    // Nothing of mine landed.
    const row = await layoutRow(db, layoutId)
    expect(row.version).toBe(2)
    expect(row.canvas.items.map((i) => i.id)).toEqual(['t1'])
  })

  it('answers a retry of a save that already landed with already-saved, without saving twice', async () => {
    const w = await makeWedding(db)
    const gone = await makeGuest(db, w, 'Gone')
    const layoutId = await makeLayout(db, w)
    const saveId = randomUUID()
    const canvas = canvasOf(roundTable('t1', 1, [gone]))
    await db.update(guests).set({ deletedAt: new Date() }).where(eq(guests.id, gone))

    const first = await save(layoutId, 1, canvas, { saveId })
    expect(first).toMatchObject({ status: 'saved', version: 2 })
    const retry = await save(layoutId, 1, canvas, { saveId })
    expect(retry).toMatchObject({ status: 'already-saved', version: 2, editedBy: 'Noa' })
    // The retry still names the seat the first save emptied, since its reply was lost.
    if (retry.status !== 'already-saved') throw new Error('expected already-saved')
    expect(retry.dropped.map((d) => d.guestId)).toEqual([gone])
    expect((await layoutRow(db, layoutId)).version).toBe(2)

    // A later save from the same tab starts from version 2 and lands.
    expect(await save(layoutId, 2, canvas)).toMatchObject({ status: 'saved', version: 3 })
  })

  it('drops and reports seats of removed, unknown and doubly seated guests', async () => {
    const w = await makeWedding(db)
    const other = await makeWedding(db, 'Another wedding')
    const live = await makeGuest(db, w, 'Live')
    const removed = await makeGuest(db, w, 'Removed')
    const foreign = await makeGuest(db, other, 'Foreign')
    const neverSaved = randomUUID()
    await db.update(guests).set({ deletedAt: new Date() }).where(eq(guests.id, removed))
    const layoutId = await makeLayout(db, w)

    const canvas = canvasOf(
      roundTable('t1', 1, [live, removed, neverSaved]),
      roundTable('t2', 2, [foreign, live]),
      chairRow('r1', 1, [live]),
    )
    const result = await save(layoutId, 1, canvas)
    if (result.status !== 'saved') throw new Error(`expected saved, got ${result.status}`)
    expect(result.dropped).toEqual([
      { itemId: 't1', seatIndex: 1, guestId: removed, reason: 'removed-guest', itemLabel: 'Table 1' },
      { itemId: 't1', seatIndex: 2, guestId: neverSaved, reason: 'unknown-guest', itemLabel: 'Table 1' },
      { itemId: 't2', seatIndex: 0, guestId: foreign, reason: 'unknown-guest', itemLabel: 'Table 2' },
      { itemId: 't2', seatIndex: 1, guestId: live, reason: 'second-seat', itemLabel: 'Table 2' },
      { itemId: 'r1', seatIndex: 0, guestId: live, reason: 'second-seat', itemLabel: 'Row 1' },
    ])
    const row = await layoutRow(db, layoutId)
    expect(canvasSeats(row.canvas)).toEqual([{ guestId: live, itemId: 't1', seatIndex: 0 }])
    expect(await seatRows(db, layoutId)).toEqual([{ guestId: live, itemId: 't1', itemLabel: 'Table 1', seatIndex: 0 }])
  })

  it('refuses a canvas that fails the schema, and changes nothing', async () => {
    const w = await makeWedding(db)
    const layoutId = await makeLayout(db, w)
    const bad = canvasOf({ ...roundTable('t1', 1, [null, null]), seatCount: 3 })
    const result = await save(layoutId, 1, bad)
    expect(result.status).toBe('invalid')
    if (result.status !== 'invalid') throw new Error('expected invalid')
    expect(result.issues.join('\n')).toMatch(/seatCount/)
    expect((await layoutRow(db, layoutId)).version).toBe(1)
  })

  it('answers gone for a deleted layout, a deleted wedding and an unknown layout', async () => {
    const w = await makeWedding(db)
    const deletedLayout = await makeLayout(db, w)
    await db.update(layouts).set({ deletedAt: new Date() }).where(eq(layouts.id, deletedLayout))
    expect((await save(deletedLayout, 1, canvasOf())).status).toBe('gone')

    const w2 = await makeWedding(db)
    const layoutInDeletedWedding = await makeLayout(db, w2)
    await db.update(weddings).set({ deletedAt: new Date() }).where(eq(weddings.id, w2))
    expect((await save(layoutInDeletedWedding, 1, canvasOf())).status).toBe('gone')
    expect((await layoutRow(db, layoutInDeletedWedding)).version).toBe(1)

    expect((await save(randomUUID(), 1, canvasOf())).status).toBe('gone')
  })

  it('two saves from the same base version: one lands, the other gets a conflict', async () => {
    const w = await makeWedding(db)
    const layoutId = await makeLayout(db, w)
    const results = await Promise.all([
      save(layoutId, 1, canvasOf(roundTable('a', 1, [null])), { editedBy: 'Noa' }),
      save(layoutId, 1, canvasOf(roundTable('b', 2, [null])), { editedBy: 'Aiden' }),
    ])
    expect(results.map((r) => r.status).sort()).toEqual(['conflict', 'saved'])
    expect((await layoutRow(db, layoutId)).version).toBe(2)
  })
})

describe('recent saves', () => {
  it('a retry of an older save, after another save landed, answers already-saved with its own version', async () => {
    const w = await makeWedding(db)
    const layoutId = await makeLayout(db, w)
    const mine = randomUUID()
    const theirs = randomUUID()
    const canvas = canvasOf(roundTable('t1', 1, [null]))
    expect(await save(layoutId, 1, canvas, { saveId: mine })).toMatchObject({ status: 'saved', version: 2 })
    expect(await save(layoutId, 2, canvas, { saveId: theirs, editedBy: 'Aiden' })).toMatchObject({ status: 'saved', version: 3 })

    expect(await save(layoutId, 1, canvas, { saveId: mine })).toMatchObject({ status: 'already-saved', version: 2, editedBy: 'Noa' })
    expect(await save(layoutId, 2, canvas, { saveId: theirs, editedBy: 'Aiden' })).toMatchObject({
      status: 'already-saved',
      version: 3,
      editedBy: 'Aiden',
    })
    // Nothing landed twice.
    const row = await layoutRow(db, layoutId)
    expect(row.version).toBe(3)
    expect(row.recentSaves).toEqual([
      { saveId: theirs, version: 3 },
      { saveId: mine, version: 2 },
    ])
    // An id that never landed is still a conflict, naming the recent saves.
    expect(await save(layoutId, 2, canvas)).toMatchObject({ status: 'conflict', version: 3, recentSaveIds: [theirs, mine] })
  })

  it(`keeps only the newest ${MAX_RECENT_SAVES}, newest first`, async () => {
    const w = await makeWedding(db)
    const layoutId = await makeLayout(db, w)
    expect((await layoutRow(db, layoutId)).recentSaves).toEqual([])
    const ids: string[] = []
    for (let version = 1; version <= MAX_RECENT_SAVES + 5; version++) {
      const saveId = randomUUID()
      ids.push(saveId)
      expect((await save(layoutId, version, canvasOf(), { saveId })).status).toBe('saved')
      expect((await layoutRow(db, layoutId)).recentSaves.length).toBe(Math.min(version, MAX_RECENT_SAVES))
    }
    const row = await layoutRow(db, layoutId)
    expect(row.version).toBe(MAX_RECENT_SAVES + 6)
    expect(row.recentSaves).toEqual(
      ids
        .map((saveId, i) => ({ saveId, version: i + 2 }))
        .reverse()
        .slice(0, MAX_RECENT_SAVES),
    )
    // The oldest five fell off: a retry of one now meets a conflict, the oldest kept one does not.
    expect((await save(layoutId, 1, canvasOf(), { saveId: ids[4]! })).status).toBe('conflict')
    expect(await save(layoutId, 6, canvasOf(), { saveId: ids[5]! })).toMatchObject({ status: 'already-saved', version: 7 })
  })

  it('a layout saved before recent saves existed still answers its last save id', async () => {
    const w = await makeWedding(db)
    const layoutId = await makeLayout(db, w)
    const saveId = randomUUID()
    await save(layoutId, 1, canvasOf(), { saveId })
    await db.update(layouts).set({ recentSaves: [] }).where(eq(layouts.id, layoutId))
    expect(await save(layoutId, 1, canvasOf(), { saveId })).toMatchObject({ status: 'already-saved', version: 2 })
  })
})

describe('the layout row lock', () => {
  /** Waits until some other session is blocked on a lock (the save under test). */
  async function waitForLockWait() {
    for (let i = 0; i < 200; i++) {
      const { rows } = await pool.query<{ n: number }>(
        `select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`,
      )
      if (rows[0]!.n > 0) return
      await new Promise((r) => setTimeout(r, 10))
    }
    throw new Error('the save never waited for the lock')
  }

  it('a save waits for a template change in progress, then draws the new template in the thumbnail', async () => {
    const w = await makeWedding(db)
    const t = await makeTemplate(db)
    const layoutId = await makeLayout(db, w, canvasOf(roundTable('t1', 1, [null])))
    expect((await layoutRow(db, layoutId)).thumbSvg).not.toContain('<polyline')

    // Another transaction holds the layout row, as updateLayout does while it changes the template.
    const other = await pool.connect()
    try {
      await other.query('begin')
      await other.query('select 1 from layouts where id = $1 for update', [layoutId])
      const saving = save(layoutId, 1, canvasOf(roundTable('t1', 1, [null])))
      await waitForLockWait()
      await other.query('update layouts set venue_template_id = $1 where id = $2', [t, layoutId])
      await other.query('commit')
      expect(await saving).toMatchObject({ status: 'saved', version: 2 })
    } finally {
      other.release()
    }
    const row = await layoutRow(db, layoutId)
    expect(row.venueTemplateId).toBe(t)
    // The wall from the template: the save read the template after the change.
    expect(row.thumbSvg).toContain('<polyline')
  })

  it('saves racing template changes always leave a thumbnail that matches the final template', async () => {
    const w = await makeWedding(db)
    const t = await makeTemplate(db)
    // The template's owner changes the venue, so the layout may use it.
    const owner = { userId: (await makeUser(db)).id, isAdmin: false }
    await db.update(venueTemplates).set({ ownerUserId: owner.userId }).where(eq(venueTemplates.id, t))
    const layoutId = await makeLayout(db, w, canvasOf(roundTable('t1', 1, [null])))
    let version = 1
    for (let round = 0; round < 10; round++) {
      const target = round % 2 === 0 ? t : null
      const [saved] = await Promise.all([
        save(layoutId, version, canvasOf(roundTable('t1', 1, [null]))),
        updateLayout(db, w, layoutId, { venueTemplateId: target }, owner),
      ])
      if (saved.status !== 'saved') throw new Error(saved.status)
      version = saved.version
      const row = await layoutRow(db, layoutId)
      expect(row.venueTemplateId).toBe(target)
      expect(row.thumbSvg.includes('<polyline')).toBe(target !== null)
    }
  })
})

describe('writeCanvas modes', () => {
  it('rewrite keeps version, last save id, recent saves, editor and last edited time', async () => {
    const w = await makeWedding(db)
    const ann = await makeGuest(db, w, 'Ann')
    const layoutId = await makeLayout(db, w)
    await save(layoutId, 1, canvasOf(roundTable('t1', 1, [ann])), { editedBy: 'Aiden' })
    const before = await layoutRow(db, layoutId)

    await db.update(guests).set({ deletedAt: new Date() }).where(eq(guests.id, ann))
    const result = await db.transaction((tx) =>
      writeCanvas(tx, { mode: 'rewrite', weddingId: w, layoutId, canvas: before.canvas }),
    )
    expect(result).toMatchObject({ status: 'rewritten', dropped: [{ guestId: ann, reason: 'removed-guest' }] })
    const after = await layoutRow(db, layoutId)
    expect(after.version).toBe(before.version)
    expect(after.lastSaveId).toBe(before.lastSaveId)
    expect(before.recentSaves).toHaveLength(1)
    expect(after.recentSaves).toEqual(before.recentSaves)
    expect(after.editedBy).toBe('Aiden')
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime())
    expect(canvasSeats(after.canvas)).toEqual([])
    expect(await seatRows(db, layoutId)).toEqual([])
  })

  it('insert is safe to retry with the same id, and refuses an id from another wedding', async () => {
    const w = await makeWedding(db)
    const other = await makeWedding(db)
    const layoutId = await makeLayout(db, w)
    const insert = (weddingId: string) =>
      db.transaction((tx) =>
        writeCanvas(tx, {
          mode: 'insert',
          weddingId,
          layoutId,
          canvas: canvasOf(),
          name: 'Again',
          kind: 'reception',
          venueTemplateId: null,
          editedBy: 'Noa',
        }),
      )
    expect(await insert(w)).toEqual({ status: 'created', dropped: [], existed: true })
    expect(await insert(other)).toEqual({ status: 'id-taken' })
    expect((await layoutRow(db, layoutId)).name).toBe('Reception')
  })

  it('insert into a deleted wedding is gone', async () => {
    const w = await makeWedding(db)
    await db.update(weddings).set({ deletedAt: new Date() }).where(eq(weddings.id, w))
    await expect(makeLayout(db, w)).rejects.toThrow(/gone/)
  })
})
