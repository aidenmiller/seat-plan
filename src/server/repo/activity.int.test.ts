/**
 * The activity log against the test database: the once-only key, what it
 * leaves out of `detail`, and that it never breaks the caller.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestDb, truncateAll } from '../../../test/db'
import { makeUser } from '../../../test/auth'
import { activityEvents, weddings } from '../db/schema'
import { ACTIVITY_KINDS, recordEvent, scrubDetail, type ActivityKind } from './activity'

const { pool, db } = makeTestDb()

beforeEach(async () => {
  await truncateAll(pool)
})
afterAll(async () => {
  await pool.end()
})

async function events() {
  return db.select().from(activityEvents)
}

describe('recordEvent', () => {
  it('writes the event', async () => {
    const user = await makeUser(db)
    const weddingId = randomUUID()
    const subjectId = randomUUID()
    await recordEvent(db, { kind: 'member_added', userId: user.id, weddingId, subjectId, detail: { role: 'editor' } })
    const [row] = await events()
    expect(row).toMatchObject({ kind: 'member_added', userId: user.id, weddingId, subjectId, detail: { role: 'editor' }, dedupeKey: null })
  })

  it('skips a second event with the same key, but not events without one', async () => {
    await recordEvent(db, { kind: 'admin_access', dedupeKey: 'admin_access:a:w:2026-11-11' })
    await recordEvent(db, { kind: 'admin_access', dedupeKey: 'admin_access:a:w:2026-11-11' })
    await recordEvent(db, { kind: 'admin_access', dedupeKey: 'admin_access:a:w:2026-11-12' })
    await recordEvent(db, { kind: 'login' })
    await recordEvent(db, { kind: 'login' })
    expect(await events()).toHaveLength(4)
  })

  it('leaves out anything that looks like a secret', async () => {
    await recordEvent(db, {
      kind: 'reset_link_created',
      detail: { token: 'abc', resetToken: 'abc', password: 'pw', newPassword: 'pw', passwordHash: 'h', nested: { secret: 's', ok: 1 }, role: 'owner' },
    })
    const [row] = await events()
    expect(row!.detail).toEqual({ nested: { ok: 1 }, role: 'owner' })
  })

  it('replaces an oversized detail with a note', async () => {
    await recordEvent(db, { kind: 'login', detail: { blob: 'x'.repeat(5000) } })
    expect((await events())[0]!.detail).toEqual({ truncated: true })
  })

  it('never throws, and logs instead', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // No such user: the foreign key refuses the row.
    await expect(recordEvent(db, { kind: 'login', userId: randomUUID() })).resolves.toBeUndefined()
    await expect(recordEvent(db, { kind: 'not_a_kind' as ActivityKind })).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalledTimes(2)
    spy.mockRestore()
    expect(await events()).toEqual([])
  })

  it('does not spoil the caller’s transaction when its row is refused', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const [wedding] = await db.transaction(async (tx) => {
      await recordEvent(tx, { kind: 'login', userId: randomUUID() })
      await recordEvent(tx, { kind: 'wedding_created', dedupeKey: 'once' })
      await recordEvent(tx, { kind: 'wedding_created', dedupeKey: 'once' })
      return tx.insert(weddings).values({ name: 'Still saved' }).returning()
    })
    spy.mockRestore()
    expect(wedding!.name).toBe('Still saved')
    expect((await events()).map((e) => e.kind)).toEqual(['wedding_created'])
  })

  it('knows every kind', () => {
    expect(ACTIVITY_KINDS).toHaveLength(21)
    expect(new Set(ACTIVITY_KINDS).size).toBe(21)
  })
})

describe('scrubDetail', () => {
  it('drops secret-looking keys at any depth, in arrays too', () => {
    expect(scrubDetail({ a: [{ cookie: 'c', b: 2 }], sessionId: 'kept', Token: 'x' })).toEqual({ a: [{ b: 2 }], sessionId: 'kept' })
  })
})
