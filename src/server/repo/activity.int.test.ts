/**
 * The activity log against the test database: the once-only key, what it
 * leaves out of `detail`, and that it never breaks the caller; the hourly
 * usage counters; and clearing old rows.
 */
import { randomUUID } from 'node:crypto'
import { like } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WriteKind } from '@/domain/activity'
import { makeTestDb, truncateAll } from '../../../test/db'
import { makeUser } from '../../../test/auth'
import { activityEvents, weddings } from '../db/schema'
import { ACTIVITY_KINDS, countWrite, pruneActivity, pruneActivityDaily, recordEvent, scrubDetail, type ActivityKind } from './activity'

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
    expect(ACTIVITY_KINDS).toHaveLength(35)
    expect(new Set(ACTIVITY_KINDS).size).toBe(35)
  })
})

describe('countWrite (the hourly usage counters)', () => {
  const at = (iso: string) => new Date(iso)
  const counters = async () =>
    (await db.select().from(activityEvents).where(like(activityEvents.kind, 'write.%')).orderBy(activityEvents.dedupeKey)).map((e) => ({
      kind: e.kind,
      userId: e.userId,
      weddingId: e.weddingId,
      count: (e.detail as { count: number }).count,
      occurredAt: e.occurredAt.toISOString(),
    }))

  it('adds to one row per hour, and keeps the time of the latest change', async () => {
    const user = await makeUser(db)
    const weddingId = randomUUID()
    await countWrite(db, { userId: user.id, weddingId, kind: 'write.layout', at: at('2026-11-11T14:05:00Z') })
    await countWrite(db, { userId: user.id, weddingId, kind: 'write.layout', at: at('2026-11-11T14:50:00Z') })
    // Out of order (a slow request): the count goes up, the time stays the latest.
    await countWrite(db, { userId: user.id, weddingId, kind: 'write.layout', at: at('2026-11-11T14:20:00Z') })
    expect(await counters()).toEqual([{ kind: 'write.layout', userId: user.id, weddingId, count: 3, occurredAt: '2026-11-11T14:50:00.000Z' }])
  })

  it('makes a new row for another hour, person, wedding or kind, and one for no wedding', async () => {
    const [ann, ben] = [await makeUser(db), await makeUser(db)]
    const [w1, w2] = [randomUUID(), randomUUID()]
    const base = { userId: ann.id, weddingId: w1, kind: 'write.layout' as const, at: at('2026-11-11T14:05:00Z') }
    await countWrite(db, base)
    await countWrite(db, { ...base, at: at('2026-11-11T15:00:00Z') })
    await countWrite(db, { ...base, userId: ben.id })
    await countWrite(db, { ...base, weddingId: w2 })
    await countWrite(db, { ...base, kind: 'write.guests' })
    await countWrite(db, { ...base, weddingId: null, kind: 'write.venue' })
    const rows = await counters()
    expect(rows).toHaveLength(6)
    expect(rows.every((r) => r.count === 1)).toBe(true)
    expect(rows.find((r) => r.kind === 'write.venue')).toMatchObject({ weddingId: null })
  })

  it('counts every one of many changes at once', async () => {
    const user = await makeUser(db)
    const weddingId = randomUUID()
    const when = at('2026-11-11T09:30:00Z')
    await Promise.all(Array.from({ length: 25 }, () => countWrite(db, { userId: user.id, weddingId, kind: 'write.layout', at: when })))
    expect(await counters()).toEqual([{ kind: 'write.layout', userId: user.id, weddingId, count: 25, occurredAt: when.toISOString() }])
  })

  it('never throws, and logs instead', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // No such user: the foreign key refuses the row.
    await expect(countWrite(db, { userId: randomUUID(), weddingId: null, kind: 'write.layout' })).resolves.toBeUndefined()
    await expect(countWrite(db, { userId: randomUUID(), weddingId: null, kind: 'login' as WriteKind })).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalledTimes(2)
    spy.mockRestore()
    expect(await events()).toEqual([])
  })
})

describe('pruning old activity', () => {
  const now = new Date('2026-11-11T12:00:00Z')
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000)

  it('deletes counters, admin reads and prune markers older than 400 days, and keeps everything else', async () => {
    const user = await makeUser(db)
    const old = daysAgo(401)
    const recent = daysAgo(399)
    await countWrite(db, { userId: user.id, weddingId: null, kind: 'write.venue', at: old })
    await countWrite(db, { userId: user.id, weddingId: null, kind: 'write.venue', at: recent })
    const insert = (kind: string, occurredAt: Date, detail: Record<string, unknown> = {}) => db.insert(activityEvents).values({ kind, occurredAt, detail })
    await insert('admin_access', old, { write: false })
    await insert('admin_access', old, { write: true })
    await insert('admin_access', recent, { write: false })
    await insert('activity_pruned', old)
    await insert('login', old)
    await insert('venue.ai_import', old)
    await insert('wedding_deleted', old)

    expect(await pruneActivity(db, now)).toBe(3)
    const left = (await events()).map((e) => `${e.kind}${e.kind === 'admin_access' ? `:${String((e.detail as { write: boolean }).write)}` : ''}@${e.occurredAt < daysAgo(400) ? 'old' : 'recent'}`)
    expect(left.sort()).toEqual(
      ['write.venue@recent', 'admin_access:true@old', 'admin_access:false@recent', 'login@old', 'venue.ai_import@old', 'wedding_deleted@old'].sort(),
    )
  })

  it('runs at most once a day', async () => {
    const user = await makeUser(db)
    await countWrite(db, { userId: user.id, weddingId: null, kind: 'write.venue', at: daysAgo(500) })
    await pruneActivityDaily(db, now)
    await countWrite(db, { userId: user.id, weddingId: null, kind: 'write.layout', at: daysAgo(500) })
    // Later the same UTC day: the marker is there, so nothing is pruned.
    await pruneActivityDaily(db, new Date(now.getTime() + 3_600_000))
    const kinds = (await events()).map((e) => e.kind).sort()
    expect(kinds).toEqual(['activity_pruned', 'write.layout'])
    const [marker] = (await events()).filter((e) => e.kind === 'activity_pruned')
    expect(marker!.detail).toEqual({ deleted: 1 })
    // The next day it runs again.
    await pruneActivityDaily(db, new Date(now.getTime() + 86_400_000))
    expect((await events()).map((e) => e.kind).sort()).toEqual(['activity_pruned', 'activity_pruned'])
  })
})

describe('scrubDetail', () => {
  it('drops secret-looking keys at any depth, in arrays too', () => {
    expect(scrubDetail({ a: [{ cookie: 'c', b: 2 }], sessionId: 'kept', Token: 'x' })).toEqual({ a: [{ b: 2 }], sessionId: 'kept' })
  })
})
