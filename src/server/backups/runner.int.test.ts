/**
 * The backup job against the test database and a memory store: what a run
 * backs up and skips, how one failure stays one failure, the deadline, the
 * lease, final backups of deleted weddings, images stored once, pruning, and
 * a database failure after the upload.
 *
 * runBackups looks at every wedding in the database, so each test starts from
 * empty tables.
 */
import { randomUUID } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import { and, asc, eq, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { makeTestDb, truncateAll } from '../../../test/db'
import { makeUser, type TestUser } from '../../../test/auth'
import { storedBackupHeadSchema } from '@/domain/backup/schema'
import { makeGridPng } from '@/domain/floorplan/__fixtures__/plans'
import { backupImages, backupRuns, backups, guests, rules, weddings } from '../db/schema'
import { buildBackup } from './build'
import { sha256Hex } from './hash'
import { restoreStoredBackup } from './restore'
import { backupPathname, BackupStoreError, type BackupStore } from './store'
import { createMemoryStore, type MemoryStore } from './store-memory'
import { backupOneWedding, pruneBackups, runBackups, type RunOptions } from './runner'
import { makeBackupWedding, type BackupWedding } from './test-wedding'

const { pool, db } = makeTestDb()
let owner: TestUser
let store: MemoryStore

// Emptying every table can take more than the default 10 s on a busy machine; a timed-out hook would leave its
// TRUNCATE running into the next test's.
beforeEach(async () => {
  await truncateAll(pool)
  owner = await makeUser(db, { displayName: 'Olive' })
  store = createMemoryStore()
}, 120_000)
afterAll(async () => {
  await pool.end()
})

const LATER = () => Date.now() + 60_000
const run = (s: BackupStore = store, opts: Partial<RunOptions> = {}) => runBackups(db, s, { trigger: 'cron', deadline: LATER(), ...opts })

/** A store that runs `before` ahead of each put, and can be told to fail. */
function hooked(inner: BackupStore, before: (pathname: string) => void | Promise<void>): BackupStore {
  return {
    kind: inner.kind,
    id: inner.id,
    put: async (pathname, bytes, contentType, opts) => {
      await before(pathname)
      return inner.put(pathname, bytes, contentType, opts)
    },
    get: (pathname) => inner.get(pathname),
    delete: (pathnames) => inner.delete(pathnames),
  }
}

async function backupRows(weddingId?: string) {
  return db
    .select()
    .from(backups)
    .where(weddingId ? eq(backups.weddingId, weddingId) : sql`true`)
    .orderBy(asc(backups.createdAt), asc(backups.id))
}

async function runRow(runId: string) {
  const [row] = await db.select().from(backupRuns).where(eq(backupRuns.id, runId))
  return row!
}

const files = (s: MemoryStore) => s.pathnames().filter((p) => p.endsWith('.json.gz'))
const images = (s: MemoryStore) => s.pathnames().filter((p) => p.startsWith('backups/images/'))

async function three(): Promise<[BackupWedding, BackupWedding, BackupWedding]> {
  return [await makeBackupWedding(db, owner.id), await makeBackupWedding(db, owner.id), await makeBackupWedding(db, owner.id)]
}

describe('runBackups', () => {
  it('backs up every wedding once, then finds them all unchanged', async () => {
    const ws = await three()
    const first = await run()
    expect(first).toMatchObject({ status: 'ok', backedUp: 3, unchanged: 0, failed: 0, remaining: 0, failures: [] })
    const rows = await backupRows()
    expect(rows.map((r) => r.weddingId).sort()).toEqual(ws.map((w) => w.weddingId).sort())
    expect(rows.every((r) => r.kind === 'nightly' && r.runId === first.runId && r.createdBy === null)).toBe(true)
    expect(files(store)).toHaveLength(3)
    // The run's row says what happened.
    expect(await runRow(first.runId!)).toMatchObject({ trigger: 'cron', status: 'ok', backedUp: 3, unchanged: 0, failed: 0, failures: [], remaining: 0, finishedAt: expect.any(Date) })

    // Each stored file is the gzipped head, with the counts and hashes its row records.
    const row = rows.find((r) => r.weddingId === ws[0].weddingId)!
    const head = storedBackupHeadSchema.parse(JSON.parse(gunzipSync((await store.get(row.pathname))!).toString('utf8')))
    expect(head.guests).toHaveLength(row.guestCount)
    expect(head.layouts).toHaveLength(row.layoutCount)
    expect(row.imageSha256s).toEqual(head.images.map((i) => i.sha256))
    expect(store.contentTypeOf(row.pathname)).toBe('application/gzip')

    const puts = store.calls.put
    const second = await run()
    expect(second).toMatchObject({ status: 'ok', backedUp: 0, unchanged: 3, failed: 0 })
    expect(store.calls.put).toBe(puts)
    expect(await backupRows()).toHaveLength(3)
    // Found unchanged: checked_at moved on, created_at did not.
    const after = await backupRows()
    for (const r of after) {
      const before = rows.find((x) => x.id === r.id)!
      expect(r.createdAt).toEqual(before.createdAt)
      expect(r.checkedAt.getTime()).toBeGreaterThan(before.checkedAt.getTime())
    }
  })

  it('backs up exactly the wedding that changed', async () => {
    const [a, b, c] = await three()
    await run()
    await db.update(guests).set({ notes: 'Changed' }).where(eq(guests.id, b.guestIds.ann))
    const summary = await run()
    expect(summary).toMatchObject({ backedUp: 1, unchanged: 2 })
    expect(summary.results.find((r) => r.status === 'created')!.weddingId).toBe(b.weddingId)
    expect((await backupRows(b.weddingId)).length).toBe(2)
    expect((await backupRows(a.weddingId)).length).toBe(1)
    expect((await backupRows(c.weddingId)).length).toBe(1)
  })

  it('keeps going when the store fails for one wedding, and records the failure without guest data', async () => {
    const [a, b, c] = await three()
    const failing = hooked(store, (pathname) => {
      if (pathname.includes(b.weddingId)) throw new BackupStoreError('Vercel Blob upload failed (BlobServiceNotAvailable)')
    })
    const summary = await run(failing)
    expect(summary).toMatchObject({ status: 'partial', backedUp: 2, failed: 1 })
    expect(summary.failures).toEqual([{ weddingId: b.weddingId, message: 'Vercel Blob upload failed (BlobServiceNotAvailable)' }])
    expect((await backupRows()).map((r) => r.weddingId).sort()).toEqual([a.weddingId, c.weddingId].sort())
    const row = await runRow(summary.runId!)
    expect(row).toMatchObject({ status: 'partial', failed: 1, backedUp: 2, failures: summary.failures })

    // A failure that is not ours (here a database error quoting a guest's name) is recorded by its code only.
    await db.execute(sql`create or replace function backups_test_fail() returns trigger language plpgsql as $$ begin raise exception 'Ann Lee sits at table 1'; end $$`)
    await db.execute(sql`create trigger backups_test_fail before insert on backups for each row execute function backups_test_fail()`)
    try {
      await db.update(guests).set({ notes: 'Changed again' }).where(eq(guests.id, a.guestIds.ann))
      const failed = await run()
      // a (changed) and b (never backed up) both reach the insert; c is unchanged.
      expect(failed.failures).toContainEqual({ weddingId: a.weddingId, message: 'Database error (code P0001)' })
      expect(failed.failures.every((f) => f.message === 'Database error (code P0001)')).toBe(true)
      expect(JSON.stringify(await runRow(failed.runId!))).not.toContain('Ann')
    } finally {
      await db.execute(sql`drop trigger if exists backups_test_fail on backups`)
      await db.execute(sql`drop function if exists backups_test_fail()`)
    }
  })

  it('fails a run outright when every wedding fails', async () => {
    await three()
    const broken = hooked(store, () => {
      throw new BackupStoreError('Vercel Blob upload failed (BlobStoreSuspendedError)')
    })
    const summary = await run(broken)
    expect(summary).toMatchObject({ status: 'failed', backedUp: 0, failed: 3 })
    expect((await runRow(summary.runId!)).status).toBe('failed')
  })

  it('stops at the deadline as partial, counting what is left, and the next run starts with those', async () => {
    const [a, b, c] = await three()
    // Past the deadline already: nothing starts.
    const none = await run(store, { deadline: Date.now() - 1 })
    expect(none).toMatchObject({ status: 'partial', backedUp: 0, remaining: 3 })
    expect((await runRow(none.runId!)).remaining).toBe(3)

    // The first wedding's upload takes the run past its deadline.
    const deadline = Date.now() + 300
    const slow = hooked(store, async (pathname) => {
      if (pathname.endsWith('.json.gz')) while (Date.now() <= deadline) await new Promise((r) => setTimeout(r, 20))
    })
    const partial = await run(slow, { deadline })
    expect(partial).toMatchObject({ status: 'partial', backedUp: 1, remaining: 2 })
    const done = partial.results[0]!.weddingId

    // The next run takes the two it missed first, then finds the first unchanged.
    const next = await run()
    expect(next.results.map((r) => r.status)).toEqual(['created', 'created', 'unchanged'])
    expect(next.results[2]!.weddingId).toBe(done)
    expect(new Set(next.results.map((r) => r.weddingId))).toEqual(new Set([a.weddingId, b.weddingId, c.weddingId]))
  })

  it('takes the wedding checked longest ago first, and one that failed in the last full run last', async () => {
    const [a, b, c] = await three()
    await run()
    const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000)
    await db.update(backups).set({ checkedAt: at(5) }).where(eq(backups.weddingId, a.weddingId))
    await db.update(backups).set({ checkedAt: at(30) }).where(eq(backups.weddingId, b.weddingId))
    await db.update(backups).set({ checkedAt: at(20) }).where(eq(backups.weddingId, c.weddingId))
    const ordered = await run()
    expect(ordered.results.map((r) => r.weddingId)).toEqual([b.weddingId, c.weddingId, a.weddingId])

    // A new wedding that fails: next time it goes last, though never backed up (which would put it first).
    const d = await makeBackupWedding(db, owner.id)
    const failing = hooked(store, (pathname) => {
      if (pathname.includes(d.weddingId)) throw new BackupStoreError('Vercel Blob upload failed (BlobUnknownError)')
    })
    const failedRun = await run(failing)
    expect(failedRun.results[0]!.weddingId).toBe(d.weddingId)
    const after = await run()
    expect(after.results.at(-1)).toMatchObject({ weddingId: d.weddingId, status: 'created' })

    // An owner's one-wedding run is not a full run: its failure does not send the wedding last.
    await db.update(guests).set({ notes: 'Changed' }).where(eq(guests.id, a.guestIds.ann))
    const ownerFails = hooked(store, (pathname) => {
      if (pathname.includes(a.weddingId)) throw new BackupStoreError('Vercel Blob upload failed (BlobUnknownError)')
    })
    const ownerRun = await run(ownerFails, { trigger: 'owner', userId: owner.id, weddingIds: [a.weddingId], kind: 'manual' })
    expect(ownerRun).toMatchObject({ status: 'failed', failed: 1 })
    await db.update(backups).set({ checkedAt: at(90) }).where(eq(backups.weddingId, a.weddingId))
    const full = await run()
    expect(full.results[0]).toMatchObject({ weddingId: a.weddingId, status: 'created' })
  })

  it('answers busy while another run is alive, and takes over one whose heartbeat stopped', async () => {
    await three()
    // A run in progress, really going: its upload waits until let go.
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    let entered!: () => void
    const inside = new Promise<void>((resolve) => (entered = resolve))
    const held = hooked(store, async () => {
      entered()
      await gate
    })
    const first = run(held)
    await inside
    const second = await run()
    const byAdmin = await run(store, { trigger: 'admin', userId: owner.id })
    release()
    expect(second).toMatchObject({ status: 'busy', backedUp: 0, error: expect.stringMatching(/^Did not run: another nightly run, started .* UTC, was still going/) })
    // A nightly run that could not start is recorded, failed, so the admin page shows it.
    expect(await runRow(second.runId!)).toMatchObject({ trigger: 'cron', status: 'failed', error: second.error, finishedAt: expect.any(Date) })
    // An admin's Run now is told at once, and nothing is recorded for it.
    expect(byAdmin).toMatchObject({ status: 'busy', runId: null })
    expect((await first).status).toBe('ok')

    // A run that died 7 minutes ago (its function stopped): the next one marks it failed and goes ahead.
    const [stale] = await db
      .insert(backupRuns)
      .values({ trigger: 'cron', startedAt: new Date(Date.now() - 8 * 60_000), heartbeatAt: new Date(Date.now() - 7 * 60_000) })
      .returning({ id: backupRuns.id })
    const takeover = await run()
    expect(takeover.status).toBe('ok')
    expect(await runRow(stale!.id)).toMatchObject({ status: 'failed', error: expect.stringMatching(/^Timed out/), finishedAt: expect.any(Date) })

    // One that beat 1 minute ago is alive: busy, and it is left alone.
    const [alive] = await db
      .insert(backupRuns)
      .values({ trigger: 'admin', heartbeatAt: new Date(Date.now() - 60_000) })
      .returning({ id: backupRuns.id })
    expect((await run()).status).toBe('busy')
    expect((await runRow(alive!.id)).status).toBe('running')
    // The database itself allows only one running row.
    await expect(db.insert(backupRuns).values({ trigger: 'cron' })).rejects.toThrow()
  })

  it('makes exactly one final backup of a deleted wedding, as it was when deleted', async () => {
    const [a, b, c] = await three()
    await run()
    await db.update(weddings).set({ deletedAt: new Date() }).where(eq(weddings.id, a.weddingId))
    // Deleted before it was ever backed up: it gets its final backup too.
    const never = await makeBackupWedding(db, owner.id)
    await db.update(weddings).set({ deletedAt: new Date() }).where(eq(weddings.id, never.weddingId))

    const summary = await run()
    expect(summary).toMatchObject({ backedUp: 2, unchanged: 2 })
    const finals = (await backupRows()).filter((r) => r.kind === 'final')
    expect(finals.map((r) => r.weddingId).sort()).toEqual([a.weddingId, never.weddingId].sort())
    const head = storedBackupHeadSchema.parse(JSON.parse(gunzipSync((await store.get(finals.find((f) => f.weddingId === a.weddingId)!.pathname))!).toString('utf8')))
    expect(head.guests.map((g) => g.firstName).sort()).toEqual(['Ann', 'Ben', 'Cat', 'Dan'])
    expect(head.layouts.map((l) => l.name)).toEqual(['Dinner', 'Ceremony'])

    // And never another: the next run looks at the live weddings only.
    const again = await run()
    expect(again.results.map((r) => r.weddingId).sort()).toEqual([b.weddingId, c.weddingId].sort())
    expect((await backupRows()).filter((r) => r.kind === 'final')).toHaveLength(2)
    // A live wedding is never given a final backup directly either.
    await expect(backupOneWedding(db, store, b.weddingId, { kind: 'final' })).rejects.toThrow(/only made of a deleted wedding/)
  })

  it('lets a wedding deleted over 12 months ago go: no new final backup, even once its old one is pruned', async () => {
    const a = await makeBackupWedding(db, owner.id)
    const old = await makeBackupWedding(db, owner.id)
    const monthsAgo = (m: number) => {
      const d = new Date()
      d.setUTCMonth(d.getUTCMonth() - m)
      return d
    }
    // Deleted 13 months ago, its final backup made the day after: past retention now.
    await db.update(weddings).set({ deletedAt: monthsAgo(13) }).where(eq(weddings.id, old.weddingId))
    const final = await backupOneWedding(db, store, old.weddingId, { kind: 'final' })
    if (final.status !== 'created') throw new Error(final.status)
    await db.update(backups).set({ createdAt: new Date(monthsAgo(13).getTime() + 86_400_000) }).where(eq(backups.id, final.backup.id))
    // Deleted 13 months ago and never backed up: too late for a final one.
    const never = await makeBackupWedding(db, owner.id)
    await db.update(weddings).set({ deletedAt: monthsAgo(13) }).where(eq(weddings.id, never.weddingId))

    const summary = await run()
    expect(summary.results.map((r) => r.weddingId)).toEqual([a.weddingId])
    expect(summary.pruned).toBe(1)
    expect(await backupRows(old.weddingId)).toEqual([])
    expect((await run()).results.map((r) => r.weddingId)).toEqual([a.weddingId])
    expect(await backupRows(old.weddingId)).toEqual([])
  })

  it('backs everything up afresh, images too, when the store is replaced, and never reads the old store’s rows', async () => {
    const [a, b] = await three()
    await run()
    const replacement = createMemoryStore()
    const summary = await run(replacement)
    expect(summary).toMatchObject({ status: 'ok', backedUp: 3, unchanged: 0 })
    expect(files(replacement)).toHaveLength(3)
    expect(images(replacement)).toHaveLength(1)
    // Each store has its own image row; the old store's rows and files are left as they were.
    expect((await db.select({ storeId: backupImages.storeId }).from(backupImages)).map((r) => r.storeId).sort()).toEqual([replacement.id, store.id].sort())
    expect(files(store)).toHaveLength(3)
    // Pruning the new store never deletes the old store's rows.
    await db.update(backups).set({ createdAt: new Date('2020-01-01T00:00:00Z') }).where(eq(backups.storeId, store.id))
    await db.update(guests).set({ notes: 'x' }).where(eq(guests.id, a.guestIds.ann))
    await run(replacement)
    expect((await backupRows()).filter((r) => r.storeId === store.id)).toHaveLength(3)
    // A wedding's newest backup in the new store is what "unchanged" compares with.
    expect((await run(replacement)).results.find((r) => r.weddingId === b.weddingId)!.status).toBe('unchanged')
  })

  it('stores each image once, across weddings and backups', async () => {
    const png = makeGridPng(80, 60)
    const a = await makeBackupWedding(db, owner.id, { png })
    const b = await makeBackupWedding(db, owner.id, { png })
    // A third wedding on a's very template.
    const c = await makeBackupWedding(db, owner.id, { templateId: a.templateId })
    const imagePuts: string[] = []
    const counting = hooked(store, (pathname) => {
      if (pathname.startsWith('backups/images/')) imagePuts.push(pathname)
    })
    await run(counting)
    expect(imagePuts).toHaveLength(1)
    expect(images(store)).toHaveLength(1)
    expect(await db.select().from(backupImages)).toHaveLength(1)
    expect((await backupRows()).every((r) => r.imageSha256s.length === 1 && r.imageSha256s[0] === (images(store)[0] ?? '').slice(15, 79))).toBe(true)
    // New backups of all three: still no new image upload.
    for (const w of [a, b, c]) await db.update(guests).set({ notes: 'New' }).where(eq(guests.id, w.guestIds.ann))
    await run(counting)
    expect(imagePuts).toHaveLength(1)
    expect(await backupRows()).toHaveLength(6)
  })

  it('keeps under the upload limit: a wedding that would pass it is skipped with a message', async () => {
    const [a] = await three()
    const summary = await run(store, { uploadBudget: 3 })
    // The first wedding needs its image and its file (2), the second its file (1, the image is shared): 3. The third would make 4.
    expect(summary).toMatchObject({ backedUp: 2, failed: 1 })
    expect(summary.failures[0]!.message).toMatch(/^Skipped: 3 uploads in the last 30 days, and the limit is 3/)
    expect(files(store)).toHaveLength(2)
    expect(summary.results[0]!.weddingId).toBe(a.weddingId)
  })

  it('deletes the stored file again when its row cannot be written', async () => {
    const [a] = await three()
    await db.execute(sql`create or replace function backups_test_fail() returns trigger language plpgsql as $$ begin raise exception 'no'; end $$`)
    await db.execute(sql`create trigger backups_test_fail before insert on backups for each row execute function backups_test_fail()`)
    try {
      await expect(backupOneWedding(db, store, a.weddingId, { kind: 'manual' })).rejects.toThrow()
    } finally {
      await db.execute(sql`drop trigger if exists backups_test_fail on backups`)
      await db.execute(sql`drop function if exists backups_test_fail()`)
    }
    expect(files(store)).toEqual([])
    expect(await backupRows()).toEqual([])
    // The image went up first and stays, recorded, for the next try (or the prune, a day on).
    expect(images(store)).toHaveLength(1)
    expect(await db.select().from(backupImages)).toHaveLength(1)
    // The next try works.
    expect((await backupOneWedding(db, store, a.weddingId, { kind: 'manual' })).status).toBe('created')
  })

  it('refuses a backup whose image record vanished before its row went in, and cleans up', async () => {
    const [a] = await three()
    const vanishing = hooked(store, async (pathname) => {
      if (pathname.endsWith('.json.gz')) await db.execute(sql`delete from backup_images where true`)
    })
    await expect(backupOneWedding(db, vanishing, a.weddingId, { kind: 'nightly' })).rejects.toThrow(/no longer in the backup store/)
    expect(files(store)).toEqual([])
    expect(await backupRows()).toEqual([])
  })
})

describe('pruneBackups', () => {
  it('keeps the newest backup of each wedding and what retention keeps, deletes the rest with their files, then unused images', async () => {
    const pngA = makeGridPng(30, 30)
    const pngB = makeGridPng(31, 31)
    const a = await makeBackupWedding(db, owner.id, { png: pngA })
    const b = await makeBackupWedding(db, owner.id, { png: pngB })
    await run()
    // b: a newer backup, after a change; then everything of b's is made old.
    await db.update(guests).set({ notes: 'x' }).where(eq(guests.id, b.guestIds.ann))
    await run()
    const old = (days: number) => new Date(Date.now() - days * 86_400_000)
    const [bOld, bNew] = await backupRows(b.weddingId)
    // Same month, long ago: only the first of the month and the newest would be kept, and the first is past 12 months.
    await db.update(backups).set({ createdAt: new Date('2024-03-05T00:00:00Z') }).where(eq(backups.id, bOld!.id))
    await db.update(backups).set({ createdAt: new Date('2024-03-09T00:00:00Z') }).where(eq(backups.id, bNew!.id))
    // a's one backup: two years old, quiet since. Kept: it is a's newest.
    const [aOnly] = await backupRows(a.weddingId)
    await db.update(backups).set({ createdAt: new Date('2024-02-01T00:00:00Z') }).where(eq(backups.id, aOnly!.id))
    // An image no backup names any more, a week old, and one only an hour old.
    const orphanSha = 'f'.repeat(64)
    const youngSha = 'e'.repeat(64)
    for (const [sha, createdAt] of [
      [orphanSha, old(7)],
      [youngSha, new Date(Date.now() - 3_600_000)],
    ] as const) {
      const pathname = `backups/images/${sha}.png`
      await store.put(pathname, new Uint8Array([1]), 'image/png')
      await db.insert(backupImages).values({ storeId: store.id, sha256: sha, pathname, contentType: 'image/png', byteSize: 1, createdAt })
    }
    // The images a and b use are old too, but named by their kept backups.
    await db.update(backupImages).set({ createdAt: old(400) }).where(sql`sha256 not in (${orphanSha}, ${youngSha})`)

    const pruned = await pruneBackups(db, store, new Date())
    expect(pruned).toBe(1)
    expect((await backupRows()).map((r) => r.id).sort()).toEqual([aOnly!.id, bNew!.id].sort())
    expect(store.pathnames()).not.toContain(bOld!.pathname)
    expect(store.pathnames()).toContain(bNew!.pathname)
    expect(store.pathnames()).toContain(aOnly!.pathname)
    const shas = (await db.select({ sha256: backupImages.sha256 }).from(backupImages)).map((r) => r.sha256).sort()
    expect(shas).not.toContain(orphanSha)
    expect(shas).toContain(youngSha)
    expect(shas).toHaveLength(3)
    expect(store.pathnames()).not.toContain(`backups/images/${orphanSha}.png`)
    expect(store.pathnames()).toContain(`backups/images/${youngSha}.png`)

    // When the last backup naming an image goes, so does the image (here: b's wedding is deleted and its final ages out).
    await db.update(weddings).set({ deletedAt: new Date('2024-03-10T00:00:00Z') }).where(eq(weddings.id, b.weddingId))
    const final = await backupOneWedding(db, store, b.weddingId, { kind: 'final' })
    if (final.status !== 'created') throw new Error(final.status)
    await db.update(backups).set({ createdAt: new Date('2024-03-11T00:00:00Z') }).where(eq(backups.id, final.backup.id))
    await db.update(backupImages).set({ createdAt: old(400) }).where(sql`true`)
    expect(await pruneBackups(db, store, new Date())).toBe(2)
    expect((await backupRows()).map((r) => r.id)).toEqual([aOnly!.id])
    expect((await db.select({ sha256: backupImages.sha256 }).from(backupImages)).map((r) => r.sha256)).toEqual(aOnly!.imageSha256s)
  })

  it('runs at the end of a full run, never on an owner’s one-wedding run', async () => {
    const a = await makeBackupWedding(db, owner.id)
    await run()
    await db.update(guests).set({ notes: 'x' }).where(eq(guests.id, a.guestIds.ann))
    await run(store, { trigger: 'owner', userId: owner.id, weddingIds: [a.weddingId], kind: 'manual' })
    // Both long ago, the nightly first: it is past 12 months and not the newest, so retention drops it.
    await db.update(backups).set({ createdAt: new Date('2023-05-01T00:00:00Z') }).where(and(eq(backups.weddingId, a.weddingId), eq(backups.kind, 'nightly')))
    await db.update(backups).set({ createdAt: new Date('2023-05-20T00:00:00Z') }).where(and(eq(backups.weddingId, a.weddingId), eq(backups.kind, 'manual')))
    const owners = await run(store, { trigger: 'owner', userId: owner.id, weddingIds: [a.weddingId], kind: 'manual' })
    expect(owners.pruned).toBe(0)
    const full = await run(store, { trigger: 'admin', userId: owner.id })
    expect(full.pruned).toBe(1)
    expect((await backupRows(a.weddingId)).map((r) => r.kind)).toEqual(['manual'])
  })

  it('stops on a store failure, with the rows it had deleted gone and their files left behind, named by nothing', async () => {
    const a = await makeBackupWedding(db, owner.id)
    await run()
    await db.update(guests).set({ notes: 'x' }).where(eq(guests.id, a.guestIds.ann))
    await run()
    const [first, second] = await backupRows(a.weddingId)
    // Both long ago: the first goes (past 12 months, not the newest), the second stays (the newest).
    await db.update(backups).set({ createdAt: new Date('2023-01-01T00:00:00Z') }).where(eq(backups.id, first!.id))
    await db.update(backups).set({ createdAt: new Date('2023-01-09T00:00:00Z') }).where(eq(backups.id, second!.id))
    const broken: BackupStore = {
      kind: 'memory',
      id: store.id,
      put: (p, b, t, o) => store.put(p, b, t, o),
      get: (p) => store.get(p),
      delete: async () => Promise.reject(new BackupStoreError('Vercel Blob delete failed')),
    }
    await expect(pruneBackups(db, broken, new Date())).rejects.toThrow(/delete failed/)
    expect((await backupRows(a.weddingId)).map((r) => r.id)).toEqual([second!.id])
    expect(store.pathnames()).toContain(first!.pathname)
    // The next prune has nothing more to do: the left-behind file is never read.
    expect(await pruneBackups(db, store, new Date())).toBe(0)
    expect(await backupRows(a.weddingId)).toHaveLength(1)
  })
})

/** A promise and the function that settles it, for holding a store call until a test lets it go. */
function gate() {
  let open!: () => void
  const shut = new Promise<void>((resolve) => (open = resolve))
  return { shut, open }
}

const marks = async (backupId: string) => {
  const result = await db.execute<{ verified_at: Date | null; unreadable_at: Date | null }>(
    sql`select verified_at, unreadable_at from backups where id = ${backupId}`,
  )
  return result.rows[0]!
}

describe('checking a backup against the format before it is uploaded', () => {
  it('records a wedding that does not fit as a failure naming the field, uploads nothing, and never calls it unchanged', async () => {
    const [a, b] = await three()
    // A rule note longer than the API accepts, written straight to the database.
    await db.update(rules).set({ note: 'n'.repeat(10_001) }).where(eq(rules.id, a.ruleId))
    const puts = store.calls.put
    const summary = await run()
    expect(summary).toMatchObject({ status: 'partial', backedUp: 2, failed: 1 })
    expect(summary.failures).toEqual([{ weddingId: a.weddingId, message: expect.stringMatching(/does not fit the backup format.*rules\.0\.note/) }])
    expect(summary.failures[0]!.message).not.toMatch(/nnn|Old feud|Ann|Lee/)
    expect(await backupRows(a.weddingId)).toEqual([])
    expect(store.pathnames().some((p) => p.includes(a.weddingId))).toBe(false)
    // Two weddings' files and their one shared image: nothing of a's.
    expect(store.calls.put - puts).toBe(3)
    expect((await runRow(summary.runId!)).failures).toEqual(summary.failures)

    // A backup of the same content stored before this check existed: the next run fails the wedding again
    // rather than finding it unchanged since that backup.
    const built = (await buildBackup(db, a.weddingId))!
    const id = randomUUID()
    const pathname = backupPathname(a.weddingId, new Date(), 'nightly', id)
    const gz = gzipSync(Buffer.from(JSON.stringify(built.head)))
    await store.put(pathname, gz, 'application/gzip')
    await db.insert(backups).values({
      id,
      storeId: store.id,
      weddingId: a.weddingId,
      weddingName: built.weddingName,
      kind: 'nightly',
      pathname,
      byteSize: gz.byteLength,
      blobSha256: sha256Hex(gz),
      contentSha256: built.contentSha256,
      imageSha256s: built.images.map((i) => i.sha256),
      formatVersion: 2,
      guestCount: built.guestCount,
      layoutCount: built.layoutCount,
    })
    const again = await run()
    expect(again.results.find((r) => r.weddingId === a.weddingId)).toMatchObject({ status: 'failed' })
    expect(again.unchanged).toBe(2)
    expect(again.results.find((r) => r.weddingId === b.weddingId)).toMatchObject({ status: 'unchanged' })

    // Put right, it backs up.
    await db.update(rules).set({ note: 'n'.repeat(10_000) }).where(eq(rules.id, a.ruleId))
    expect((await run()).results.find((r) => r.weddingId === a.weddingId)).toMatchObject({ status: 'created' })
  })
})

describe('the upload limit', () => {
  it('keeps a share for the nightly run: Back up now cannot use it, while the nightly run still can', async () => {
    const [a, b, c] = await three()
    // A limit of 6 with 3 kept for the nightly run: backups by hand may use 3.
    const budget = { uploadBudget: 6, nightlyReserve: 3 }
    const byHand = (w: BackupWedding) => run(store, { trigger: 'owner', userId: owner.id, weddingIds: [w.weddingId], kind: 'manual', ...budget })
    // a: its image and its file (2); b: its file (the image is shared) (3 in all).
    expect((await byHand(a)).results[0]).toMatchObject({ status: 'created' })
    expect((await byHand(b)).results[0]).toMatchObject({ status: 'created' })
    const refused = await byHand(c)
    expect(refused.results[0]).toMatchObject({ status: 'failed', message: expect.stringMatching(/^Back up now is paused/) })
    expect(await backupRows(c.weddingId)).toEqual([])
    // The nightly run backs c up from the share kept for it.
    const nightly = await run(store, budget)
    expect(nightly.results.find((r) => r.weddingId === c.weddingId)).toMatchObject({ status: 'created' })
  })

  it('counts only uploads made by hand against that share, so a busy nightly run does not stop Back up now', async () => {
    const [a, b] = await three()
    await run(store, { uploadBudget: 6, nightlyReserve: 3 })
    // The nightly run used 4 of 6 (an image and three files); none by hand.
    await db.update(guests).set({ notes: 'Changed' }).where(eq(guests.id, a.guestIds.ann))
    const byHand = await run(store, { trigger: 'owner', userId: owner.id, weddingIds: [a.weddingId], kind: 'manual', uploadBudget: 6, nightlyReserve: 3 })
    expect(byHand.results[0]).toMatchObject({ status: 'created' })
    // Still the whole limit counts: 5 used, so a change needing one more upload fits, a second does not.
    await db.update(guests).set({ notes: 'Changed' }).where(eq(guests.id, b.guestIds.ann))
    expect((await run(store, { trigger: 'owner', userId: owner.id, weddingIds: [b.weddingId], kind: 'manual', uploadBudget: 5, nightlyReserve: 0 })).results[0]).toMatchObject({
      status: 'failed',
      message: expect.stringMatching(/^Back up now is paused/),
    })
  })

  it('does not send a wedding skipped for lack of uploads to the back of the queue: it waits its turn by age like any other', async () => {
    const [a, b, c] = await three()
    // Room for a alone (its image and its file).
    const first = await run(store, { uploadBudget: 2 })
    expect(first.results.map((r) => [r.weddingId, r.status])).toEqual([
      [a.weddingId, 'created'],
      [b.weddingId, 'failed'],
      [c.weddingId, 'failed'],
    ])
    expect(first.failures.map((f) => f.reason)).toEqual(['budget', 'budget'])
    // The next night, with room: b and c, which have waited longest, go first.
    await db.update(guests).set({ notes: 'Changed' }).where(eq(guests.id, a.guestIds.ann))
    const next = await run()
    expect(next.results.map((r) => r.weddingId)).toEqual([b.weddingId, c.weddingId, a.weddingId])
    expect(next.results.every((r) => r.status === 'created')).toBe(true)
  })
})

describe('an owner’s Back up now and the nightly run', () => {
  it('lets the nightly run go on while an owner backs up one wedding, which it skips as in progress', async () => {
    const [a, b, c] = await three()
    const held = gate()
    const inside = gate()
    const holding = hooked(store, async (pathname) => {
      if (pathname.endsWith('.json.gz') && pathname.includes(a.weddingId)) {
        inside.open()
        await held.shut
      }
    })
    const byHand = run(holding, { trigger: 'owner', userId: owner.id, weddingIds: [a.weddingId], kind: 'manual' })
    await inside.shut
    const nightly = await run()
    expect(nightly).toMatchObject({ status: 'ok', backedUp: 2, failed: 0, skipped: 1 })
    expect(nightly.results.find((r) => r.weddingId === b.weddingId)).toMatchObject({ status: 'created' })
    expect(nightly.results.find((r) => r.weddingId === c.weddingId)).toMatchObject({ status: 'created' })
    expect(nightly.results.find((r) => r.weddingId === a.weddingId)).toMatchObject({ status: 'busy' })
    // While the nightly run holds a wedding, an owner's Back up now of that wedding answers busy.
    held.open()
    expect((await byHand).results[0]).toMatchObject({ weddingId: a.weddingId, status: 'created' })
    // The owner's run is recorded, finished, by trigger.
    const ownerRuns = await db.select().from(backupRuns).where(eq(backupRuns.trigger, 'owner'))
    expect(ownerRuns).toEqual([expect.objectContaining({ status: 'ok', backedUp: 1, startedBy: owner.id, finishedAt: expect.any(Date) })])
    expect((await backupRows(a.weddingId))[0]!.runId).toBe(ownerRuns[0]!.id)
  })

  it('comes back at the end of the run to a wedding that was being backed up by hand at its turn', async () => {
    const [a, b, c] = await three()
    const held = gate()
    const inside = gate()
    const holding = hooked(store, async (pathname) => {
      if (pathname.endsWith('.json.gz') && pathname.includes(a.weddingId)) {
        inside.open()
        await held.shut
      }
    })
    const byHand = run(holding, { trigger: 'owner', userId: owner.id, weddingIds: [a.weddingId], kind: 'manual' })
    await inside.shut
    // The nightly run lets the owner's backup finish while it uploads c, its last wedding.
    const letGo = hooked(store, async (pathname) => {
      if (pathname.endsWith('.json.gz') && pathname.includes(c.weddingId)) {
        held.open()
        await byHand
      }
    })
    const nightly = await run(letGo)
    expect(nightly.results.map((r) => [r.weddingId, r.status])).toEqual([
      [b.weddingId, 'created'],
      [c.weddingId, 'created'],
      // Tried again at the end: the owner's backup holds everything.
      [a.weddingId, 'unchanged'],
    ])
    expect(nightly).toMatchObject({ status: 'ok', skipped: 0 })
  })

  it('answers busy to Back up now while the nightly run is backing up that very wedding', async () => {
    const [a] = await three()
    const held = gate()
    const inside = gate()
    const holding = hooked(store, async (pathname) => {
      if (pathname.endsWith('.json.gz') && pathname.includes(a.weddingId)) {
        inside.open()
        await held.shut
      }
    })
    const nightly = run(holding)
    await inside.shut
    const byHand = await run(store, { trigger: 'owner', userId: owner.id, weddingIds: [a.weddingId], kind: 'manual' })
    expect(byHand.status).toBe('busy')
    held.open()
    expect((await nightly).status).toBe('ok')
  })

  it('waits for a run that holds the lease when asked to, then goes ahead; or gives up and says busy', async () => {
    await three()
    const [alive] = await db.insert(backupRuns).values({ trigger: 'admin' }).returning({ id: backupRuns.id })
    const started = Date.now()
    const busy = await run(store, { leaseWaitMs: 300, leasePollMs: 50 })
    expect(busy).toMatchObject({ status: 'busy', backedUp: 0, error: expect.stringMatching(/^Did not run: an admin’s Run now, started .* UTC, was still going after 0 s of waiting/) })
    expect(Date.now() - started).toBeGreaterThanOrEqual(250)
    expect(await runRow(busy.runId!)).toMatchObject({ trigger: 'cron', status: 'failed' })
    // The other run finishes while this one waits: it goes ahead.
    setTimeout(() => void db.update(backupRuns).set({ status: 'ok', finishedAt: new Date() }).where(eq(backupRuns.id, alive!.id)).execute(), 150)
    const after = await run(store, { leaseWaitMs: 5000, leasePollMs: 50 })
    expect(after).toMatchObject({ status: 'ok', backedUp: 3 })
  })
})

describe('the nightly self-check', () => {
  it('reads one backup back each full run, the one checked longest ago, and marks it checked', async () => {
    const [a, b] = await three()
    await run()
    const rows = await backupRows()
    expect((await Promise.all(rows.map((r) => marks(r.id)))).every((m) => m.verified_at === null)).toBe(true)
    const gets = store.calls.get
    await run()
    // One read of a backup file a night.
    expect(store.calls.get - gets).toBe(1)
    const checked = (await Promise.all(rows.map(async (r) => ({ id: r.id, ...(await marks(r.id)) })))).filter((m) => m.verified_at !== null)
    expect(checked).toHaveLength(1)
    // The next run reads another, never the same one twice before the rest.
    await run()
    await run()
    const after = await Promise.all(rows.map((r) => marks(r.id)))
    expect(after.every((m) => m.verified_at !== null && m.unreadable_at === null)).toBe(true)
    // An owner's one-wedding run reads nothing back.
    const before = store.calls.get
    await db.update(guests).set({ notes: 'Changed' }).where(eq(guests.id, a.guestIds.ann))
    await run(store, { trigger: 'owner', userId: owner.id, weddingIds: [b.weddingId], kind: 'manual' })
    expect(store.calls.get).toBe(before)
  })

  it('reads each wedding’s newest backup first, then older ones, each by when it was last known good', async () => {
    const a = await makeBackupWedding(db, owner.id)
    const b = await makeBackupWedding(db, owner.id)
    await run()
    await db.update(guests).set({ notes: 'Changed' }).where(eq(guests.id, a.guestIds.ann))
    await run()
    const [aOld, aNew] = await backupRows(a.weddingId)
    const [bOnly] = await backupRows(b.weddingId)
    const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000)
    // Written long ago, never read back since: a's older backup 60 days ago, its newest 40, b's only one 50.
    for (const [row, days] of [
      [aOld!, 60],
      [aNew!, 40],
      [bOnly!, 50],
    ] as const) {
      await db.update(backups).set({ createdAt: daysAgo(days), checkedAt: daysAgo(days), verifiedAt: null }).where(eq(backups.id, row.id))
    }
    const readBack: string[] = []
    for (let i = 0; i < 3; i++) {
      await run()
      const [latest] = await db.select({ id: backups.id }).from(backups).where(sql`verified_at is not null`).orderBy(sql`verified_at desc`).limit(1)
      readBack.push(latest!.id)
    }
    // The two newest first (b's, written longer ago, before a's), then a's older one.
    expect(readBack).toEqual([bOnly!.id, aNew!.id, aOld!.id])
  })

  for (const [what, spoil] of [
    ['missing', async (pathname: string) => store.delete([pathname])],
    ['damaged', async (pathname: string) => store.tamper(pathname, new Uint8Array([1, 2, 3]))],
  ] as const) {
    it(`finds a ${what} backup file, marks it unreadable, reports it, and the same run makes a fresh backup`, async () => {
      const a = await makeBackupWedding(db, owner.id)
      await run()
      const [bad] = await backupRows(a.weddingId)
      await spoil(bad!.pathname)
      const summary = await run()
      expect(summary.failures).toEqual([
        { weddingId: a.weddingId, message: expect.stringMatching(/^Self-check: .*(missing|checksum).*fresh backup/), reason: 'check' },
      ])
      expect(summary.status).toBe('partial')
      expect((await marks(bad!.id)).unreadable_at).not.toBeNull()
      // Unchanged since the bad backup, but that backup does not count: a fresh one is made.
      expect(summary.results).toEqual([expect.objectContaining({ weddingId: a.weddingId, status: 'created' })])
      const rows = await backupRows(a.weddingId)
      expect(rows).toHaveLength(2)
      expect((await marks(rows[1]!.id)).unreadable_at).toBeNull()
      // The run's failure is what the admin page lists.
      expect((await runRow(summary.runId!)).failures).toEqual(summary.failures)
      // The night after: the fresh backup is the one compared, so nothing more is made.
      expect((await run()).results).toEqual([expect.objectContaining({ weddingId: a.weddingId, status: 'unchanged' })])
    })
  }

  it('makes a fresh final backup when a deleted wedding’s final backup is found unreadable', async () => {
    const a = await makeBackupWedding(db, owner.id)
    await db.update(weddings).set({ deletedAt: new Date() }).where(eq(weddings.id, a.weddingId))
    await run()
    const [final] = await backupRows(a.weddingId)
    expect(final!.kind).toBe('final')
    await store.delete([final!.pathname])
    const summary = await run()
    expect(summary.results).toEqual([expect.objectContaining({ weddingId: a.weddingId, status: 'created' })])
    expect((await backupRows(a.weddingId)).map((r) => r.kind)).toEqual(['final', 'final'])
  })
})

describe('a floor plan image missing from the store', () => {
  it('is forgotten when a restore finds it gone, and the next run uploads it again, which mends the old backup too', async () => {
    const a = await makeBackupWedding(db, owner.id)
    await run()
    const [backup] = await backupRows(a.weddingId)
    const imagePath = images(store)[0]!
    // Deleted by hand in the store's dashboard.
    await store.delete([imagePath])
    const broken = await restoreStoredBackup(db, store, backup!.id, { jobId: randomUUID(), actor: { userId: owner.id, isAdmin: false } })
    expect(broken).toEqual({ status: 'corrupt', message: expect.stringMatching(/^This backup is unreadable: its floor plan image .* is missing from the backup store\. Use Back up now/) })
    expect(await db.select().from(backupImages)).toEqual([])
    // Nothing changed in the wedding, but its newest backup names an image the store lost: a fresh backup, image and all.
    const next = await run()
    expect(next.results).toEqual([expect.objectContaining({ weddingId: a.weddingId, status: 'created' })])
    expect(images(store)).toEqual([imagePath])
    expect(await restoreStoredBackup(db, store, backup!.id, { jobId: randomUUID(), actor: { userId: owner.id, isAdmin: false } })).toMatchObject({ status: 'restored' })
  })
})

describe('pruning never leaves a row naming a file that is gone', () => {
  async function twoOfOneWedding() {
    const pngA = makeGridPng(30, 30)
    const a = await makeBackupWedding(db, owner.id, { png: pngA })
    await run()
    await db.update(guests).set({ notes: 'x' }).where(eq(guests.id, a.guestIds.ann))
    await run()
    const [first, second] = await backupRows(a.weddingId)
    // Both long ago: the first goes (past 12 months, not the newest), the second stays.
    await db.update(backups).set({ createdAt: new Date('2023-01-01T00:00:00Z') }).where(eq(backups.id, first!.id))
    await db.update(backups).set({ createdAt: new Date('2023-01-09T00:00:00Z') }).where(eq(backups.id, second!.id))
    return { a, first: first!, second: second! }
  }

  /** A store whose deletes fail: as if the function stopped between the database and the store. */
  const noDeletes = (): BackupStore => ({
    kind: 'memory',
    id: store.id,
    put: (p, b, t, o) => store.put(p, b, t, o),
    get: (p) => store.get(p),
    delete: async () => Promise.reject(new BackupStoreError('Vercel Blob delete failed')),
  })

  async function dangling(): Promise<string[]> {
    const rows = await db.select({ pathname: backups.pathname }).from(backups).where(eq(backups.storeId, store.id))
    const imageRows = await db.select({ pathname: backupImages.pathname }).from(backupImages).where(eq(backupImages.storeId, store.id))
    const present = new Set(store.pathnames())
    return [...rows, ...imageRows].map((r) => r.pathname).filter((p) => !present.has(p))
  }

  it('deletes a backup’s row before its file: a store failure in between leaves a file nothing names, never a row', async () => {
    const { first } = await twoOfOneWedding()
    await expect(pruneBackups(db, noDeletes(), new Date())).rejects.toThrow(/delete failed/)
    expect((await backupRows()).map((r) => r.id)).not.toContain(first.id)
    // The file is still there, named by nothing: harmless.
    expect(store.pathnames()).toContain(first.pathname)
    expect(await dangling()).toEqual([])
  })

  it('deletes an unused image’s row before its file, the same way', async () => {
    const orphanSha = 'f'.repeat(64)
    const pathname = `backups/images/${orphanSha}.png`
    await store.put(pathname, new Uint8Array([1]), 'image/png')
    await db.insert(backupImages).values({ storeId: store.id, sha256: orphanSha, pathname, contentType: 'image/png', byteSize: 1, createdAt: new Date(Date.now() - 7 * 86_400_000) })
    await expect(pruneBackups(db, noDeletes(), new Date())).rejects.toThrow(/delete failed/)
    expect(await db.select().from(backupImages).where(eq(backupImages.sha256, orphanSha))).toEqual([])
    expect(store.pathnames()).toContain(pathname)
    expect(await dangling()).toEqual([])
  })

  it('leaves both row and file when the database delete fails', async () => {
    const { first } = await twoOfOneWedding()
    await db.execute(sql`create or replace function backups_test_fail() returns trigger language plpgsql as $$ begin raise exception 'no'; end $$`)
    await db.execute(sql`create trigger backups_test_fail before delete on backups for each row execute function backups_test_fail()`)
    try {
      await expect(pruneBackups(db, store, new Date())).rejects.toThrow()
    } finally {
      await db.execute(sql`drop trigger if exists backups_test_fail on backups`)
      await db.execute(sql`drop function if exists backups_test_fail()`)
    }
    expect((await backupRows()).map((r) => r.id)).toContain(first.id)
    expect(await dangling()).toEqual([])
  })

  it('keeps an image a backup started naming while the prune was deciding', async () => {
    // An old image no backup names, about to be pruned, which a new backup then reuses.
    const a = await makeBackupWedding(db, owner.id)
    await run()
    const [row] = await backupRows(a.weddingId)
    await db.delete(backups).where(eq(backups.id, row!.id))
    await db.update(backupImages).set({ createdAt: new Date(Date.now() - 7 * 86_400_000) })
    // The backup's row goes in while the prune holds the image row; the prune then sees it named and keeps it.
    await db.update(guests).set({ notes: 'x' }).where(eq(guests.id, a.guestIds.ann))
    const results = await Promise.allSettled([backupOneWedding(db, store, a.weddingId, { kind: 'manual' }), pruneBackups(db, store, new Date())])
    const backedUp = results[0]
    // Either the backup went in and its image stayed, or the image went first and the backup was refused: never a row without its image.
    if (backedUp.status === 'fulfilled') expect(backedUp.value.status).toBe('created')
    expect(await dangling()).toEqual([])
    const named = await db.select({ shas: backups.imageSha256s }).from(backups)
    const imageShas = new Set((await db.select({ sha256: backupImages.sha256 }).from(backupImages)).map((r) => r.sha256))
    for (const { shas } of named) for (const sha of shas) expect(imageShas.has(sha)).toBe(true)
  })
})

describe('retention and a wedding brought back', () => {
  it('keeps the only backup of a wedding undeleted after its final backup, however old', async () => {
    const a = await makeBackupWedding(db, owner.id)
    const monthsAgo = (m: number) => {
      const d = new Date()
      d.setUTCMonth(d.getUTCMonth() - m)
      return d
    }
    await db.update(weddings).set({ deletedAt: monthsAgo(13) }).where(eq(weddings.id, a.weddingId))
    const final = await backupOneWedding(db, store, a.weddingId, { kind: 'final' })
    if (final.status !== 'created') throw new Error(final.status)
    await db.update(backups).set({ createdAt: monthsAgo(13) }).where(eq(backups.id, final.backup.id))
    // An admin brings it back; nobody changes it, so every night finds it unchanged.
    await db.update(weddings).set({ deletedAt: null }).where(eq(weddings.id, a.weddingId))
    expect(await pruneBackups(db, store, new Date())).toBe(0)
    const summary = await run()
    expect(summary.results).toEqual([expect.objectContaining({ weddingId: a.weddingId, status: 'unchanged' })])
    expect(summary.pruned).toBe(0)
    expect((await backupRows(a.weddingId)).map((r) => r.id)).toEqual([final.backup.id])
  })
})

describe('backupOneWedding', () => {
  it('answers not-found for a missing wedding and for a deleted one outside a final backup', async () => {
    expect(await backupOneWedding(db, store, randomUUID(), { kind: 'nightly' })).toEqual({ status: 'not-found' })
    const a = await makeBackupWedding(db, owner.id)
    await db.update(weddings).set({ deletedAt: new Date() }).where(eq(weddings.id, a.weddingId))
    expect(await backupOneWedding(db, store, a.weddingId, { kind: 'manual' })).toEqual({ status: 'not-found' })
    expect(store.pathnames()).toEqual([])
  })

  it('records who asked and which run', async () => {
    const a = await makeBackupWedding(db, owner.id)
    const result = await backupOneWedding(db, store, a.weddingId, { kind: 'manual', userId: owner.id })
    if (result.status !== 'created') throw new Error(result.status)
    expect(result.backup).toMatchObject({ kind: 'manual', createdBy: owner.id, runId: null, weddingName: expect.stringMatching(/^Backup wedding/) })
    expect(result.backup.pathname).toMatch(new RegExp(`^backups/w/${a.weddingId}/\\d{4}/\\d{2}/\\d{8}T\\d{6}Z-manual-${result.backup.id}\\.json\\.gz$`))
  })
})
