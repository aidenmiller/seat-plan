import 'server-only'
import { randomUUID } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { and, asc, desc, eq, inArray, lt, ne, sql } from 'drizzle-orm'
import { BACKUP_VERSION } from '@/domain/backup/schema'
import { backupsToPrune, DEFAULT_RETENTION } from '@/domain/backup/retention'
import { backupImages, backupRuns, backups, venueImages, type BackupFailure } from '../db/schema'
import type { Db } from '../locks'
import { uploadsLast30Days } from '../repo/backups'
import { BackupIntegrityError } from './assemble'
import { buildBackup } from './build'
import { sha256Hex } from './hash'
import { backupPathname, BackupStoreError, imagePathname, type BackupStore } from './store'

/**
 * The backup job (PLAN section 7, "Automatic backups"). Run by the nightly
 * cron, by an admin ("Run backups now"), and for one wedding by its owner
 * ("Back up now"). Each run:
 *
 *  1. Takes the lease: under an advisory lock, in one short transaction, it
 *     marks a run whose heartbeat is older than 6 minutes 'failed' (timed
 *     out) and inserts its own 'running' row, unless another run is alive.
 *     Then it answers 'busy' and does nothing. A transaction lock, not a
 *     session one, so it works through Neon's pooler. Vercel can deliver one
 *     cron call twice; the second gets 'busy'.
 *  2. Lists the weddings to back up (orderedCandidates): every live wedding,
 *     and every deleted one whose deletion is newer than its last backup (it
 *     gets one 'final' backup).
 *  3. Backs each up in turn (backupOneWedding), each in its own try/catch, so
 *     one failure never stops the others; a failure is recorded by wedding id
 *     with a message that never holds guest data. Past the deadline it stops,
 *     'partial', and counts what is left; the next run starts with those.
 *  4. On a full run (cron or admin), prunes old backups (pruneBackups).
 *  5. Finishes its row: 'ok', 'partial' or 'failed'.
 */

/** A run whose heartbeat is older than this is taken to be dead (Vercel stops a function at 300 s). */
export const LEASE_STALE_MS = 6 * 60_000
/**
 * The most uploads (backup files plus images) in any 30 days. Each upload is
 * one Vercel Blob "advanced operation"; the Hobby plan includes 2,000 a month
 * and locks the store for 30 days past that. This leaves room for the
 * dashboard, which counts too.
 */
export const UPLOAD_BUDGET_30_DAYS = 1500
/** An image no backup names is deleted only once it is this old, so one uploaded for a backup still being written is never taken. */
const IMAGE_GRACE_MS = 86_400_000
const FAILURE_MESSAGE_MAX = 300
const LEASE_LOCK = sql`select pg_advisory_xact_lock(hashtextextended('seat-plan:backup-runs', 0))`

export type BackupKind = 'nightly' | 'manual' | 'final'
export type RunTrigger = 'cron' | 'admin' | 'owner'
export type BackupRow = typeof backups.$inferSelect

/** A failure whose message is written for people and safe to record. */
export class BackupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupError'
  }
}

class LeaseLostError extends BackupError {}

export type BackupOneResult = { status: 'created'; backup: BackupRow } | { status: 'unchanged'; backup: BackupRow } | { status: 'not-found' }

export type WeddingResult = {
  weddingId: string
  status: 'created' | 'unchanged' | 'not-found' | 'failed'
  backupId: string | null
  message: string | null
}

export type RunSummary = {
  status: 'ok' | 'partial' | 'failed' | 'busy'
  runId: string | null
  backedUp: number
  unchanged: number
  failed: number
  /** Weddings that were gone by the time their turn came (deleted during the run). */
  skipped: number
  remaining: number
  pruned: number
  failures: BackupFailure[]
  results: WeddingResult[]
  error: string | null
}

export type RunOptions = {
  trigger: RunTrigger
  /** The admin or owner who asked; null for the cron. */
  userId?: string | null
  /** Epoch ms: no wedding is started after this. */
  deadline: number
  /** Only these weddings (an owner's "Back up now"); no pruning. */
  weddingIds?: readonly string[]
  /** The kind for live weddings: 'nightly' unless said otherwise. Deleted weddings always get 'final'. */
  kind?: 'nightly' | 'manual'
  uploadBudget?: number
}

// ---------------------------------------------------------------- messages

function pgErrorCode(err: unknown): string | null {
  let current: unknown = err
  for (let depth = 0; depth < 5 && current !== null && typeof current === 'object'; depth++) {
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code
    current = (current as { cause?: unknown }).cause
  }
  return null
}

/**
 * A message safe to keep in backup_runs.failures and show an admin. Only
 * messages this code wrote are passed on (they name ids, never guest data).
 * Anything else, such as a database error that could quote a value, becomes
 * its kind and code.
 */
export function safeFailureMessage(err: unknown): string {
  let message: string
  if (err instanceof BackupError || err instanceof BackupStoreError || err instanceof BackupIntegrityError) {
    message = err.message
  } else {
    const code = pgErrorCode(err)
    message = code ? `Database error (code ${code})` : `Unexpected error (${err instanceof Error ? err.constructor.name || 'Error' : typeof err})`
  }
  return message.replace(/\s+/g, ' ').trim().slice(0, FAILURE_MESSAGE_MAX)
}

/** Logs a failure for the server log: the safe message and where it came from, never the raw message. */
function logFailure(what: string, err: unknown): void {
  const frames = err instanceof Error && err.stack ? err.stack.split('\n').slice(1, 6).join(' | ') : ''
  console.error(`backups: ${what}: ${safeFailureMessage(err)}${frames ? ` at ${frames}` : ''}`)
}

// ---------------------------------------------------------------- the lease

/** Inserts this run's 'running' row, or answers null when another run is alive. */
async function acquireLease(db: Db, trigger: RunTrigger, userId: string | null): Promise<string | null> {
  return db.transaction(async (tx) => {
    await tx.execute(LEASE_LOCK)
    await tx
      .update(backupRuns)
      .set({ status: 'failed', finishedAt: sql`now()`, error: 'Timed out: no heartbeat for 6 minutes.' })
      .where(and(eq(backupRuns.status, 'running'), sql`${backupRuns.heartbeatAt} < now() - make_interval(secs => ${LEASE_STALE_MS / 1000})`))
    const [alive] = await tx.select({ id: backupRuns.id }).from(backupRuns).where(eq(backupRuns.status, 'running')).limit(1)
    if (alive) return null
    const [row] = await tx.insert(backupRuns).values({ trigger, startedBy: userId }).returning({ id: backupRuns.id })
    return row!.id
  })
}

/**
 * Bumps the heartbeat and saves the progress so far. `current` is the wedding
 * about to be backed up, saved as a failure until the next heartbeat: if the
 * function is stopped part way, the run is left naming it, and the next run
 * puts that wedding last. False when the run was taken over meanwhile.
 */
async function heartbeat(db: Db, runId: string, summary: RunSummary, current: string | null): Promise<boolean> {
  const failures = current
    ? [...summary.failures, { weddingId: current, message: 'The run stopped while backing up this wedding.' }]
    : summary.failures
  const rows = await db
    .update(backupRuns)
    .set({
      heartbeatAt: sql`now()`,
      backedUp: summary.backedUp,
      unchanged: summary.unchanged,
      failed: summary.failed,
      failures,
    })
    .where(and(eq(backupRuns.id, runId), eq(backupRuns.status, 'running')))
    .returning({ id: backupRuns.id })
  return rows.length > 0
}

async function finishRun(db: Db, runId: string, summary: RunSummary): Promise<void> {
  try {
    await db
      .update(backupRuns)
      .set({
        status: summary.status === 'busy' ? 'failed' : summary.status,
        finishedAt: sql`now()`,
        heartbeatAt: sql`now()`,
        backedUp: summary.backedUp,
        unchanged: summary.unchanged,
        failed: summary.failed,
        failures: summary.failures,
        remaining: summary.remaining,
        error: summary.error?.slice(0, 1000) ?? null,
      })
      .where(and(eq(backupRuns.id, runId), eq(backupRuns.status, 'running')))
  } catch (err) {
    // The run's own row could not be closed: the next run marks it timed out after 6 minutes.
    logFailure('could not finish the run row', err)
  }
}

// ---------------------------------------------------------------- which weddings

type Candidate = { weddingId: string; deleted: boolean; createdAt: Date; lastCheckedAt: Date | null }

/**
 * The weddings this run backs up, in order:
 *  - never backed up first, then the one checked longest ago (checked_at:
 *    when its last backup was made or last found unchanged), so after a run
 *    that stopped at its deadline the next one starts with what it missed;
 *  - but a wedding that failed in the last full run goes after all the rest,
 *    so one that keeps failing cannot hold the others up.
 */
async function orderedCandidates(db: Db, runId: string, weddingIds?: readonly string[]): Promise<Candidate[]> {
  if (weddingIds && weddingIds.length === 0) return []
  const only = weddingIds
    ? sql`and w.id in (${sql.join(
        weddingIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`
    : sql``
  const result = await db.execute<{ id: string; deleted_at: Date | null; created_at: Date; last_checked_at: Date | null }>(sql`
    with latest as (
      select distinct on (wedding_id) wedding_id, created_at, checked_at
      from backups
      order by wedding_id, created_at desc, id desc
    )
    select w.id, w.deleted_at, w.created_at, l.checked_at as last_checked_at
    from weddings w
    left join latest l on l.wedding_id = w.id
    where (w.deleted_at is null or l.created_at is null or w.deleted_at > l.created_at)
    ${only}
  `)
  const [previous] = await db
    .select({ failures: backupRuns.failures })
    .from(backupRuns)
    .where(and(inArray(backupRuns.trigger, ['cron', 'admin']), ne(backupRuns.status, 'running'), ne(backupRuns.id, runId)))
    .orderBy(desc(backupRuns.startedAt))
    .limit(1)
  const failedBefore = new Set((previous?.failures ?? []).map((f) => f.weddingId))
  const list: Candidate[] = result.rows.map((r) => ({
    weddingId: r.id,
    deleted: r.deleted_at !== null,
    createdAt: new Date(r.created_at),
    lastCheckedAt: r.last_checked_at ? new Date(r.last_checked_at) : null,
  }))
  const time = (c: Candidate) => (c.lastCheckedAt ?? c.createdAt).getTime()
  return list.sort(
    (a, b) =>
      Number(failedBefore.has(a.weddingId)) - Number(failedBefore.has(b.weddingId)) ||
      Number(a.lastCheckedAt !== null) - Number(b.lastCheckedAt !== null) ||
      time(a) - time(b) ||
      (a.weddingId < b.weddingId ? -1 : 1),
  )
}

// ---------------------------------------------------------------- one wedding

/**
 * Backs up one wedding (kind 'final' for a deleted one), unless nothing in it
 * changed since its last backup (contentSha256, build.ts): then that backup's
 * checked_at moves to now and it is answered 'unchanged'. A final backup is
 * always made, changed or not: it marks the deletion and is kept a year.
 *
 * Images go up first, each once ever (backup_images, by sha256, overwrite
 * allowed since the bytes are the same), then the gzipped head, then its row.
 * If the row cannot be written after the upload, the file is deleted again;
 * if that delete fails too the file stays as an orphan nothing names, which
 * is harmless (it is small and never read) and accepted.
 */
export async function backupOneWedding(
  db: Db,
  store: BackupStore,
  weddingId: string,
  opts: { kind: BackupKind; userId?: string | null; runId?: string | null; uploadBudget?: number },
): Promise<BackupOneResult> {
  const built = await buildBackup(db, weddingId, { includeDeleted: opts.kind === 'final' })
  if (!built) return { status: 'not-found' }
  if (opts.kind === 'final' && !built.deletedAt) throw new BackupError('A final backup is only made of a deleted wedding.')

  if (opts.kind !== 'final') {
    const [latest] = await db
      .select({ id: backups.id, contentSha256: backups.contentSha256 })
      .from(backups)
      .where(eq(backups.weddingId, weddingId))
      .orderBy(desc(backups.createdAt), desc(backups.id))
      .limit(1)
    if (latest && latest.contentSha256 === built.contentSha256) {
      const [checked] = await db.update(backups).set({ checkedAt: sql`now()` }).where(eq(backups.id, latest.id)).returning()
      if (checked) return { status: 'unchanged', backup: checked }
    }
  }

  // Each image once, by content.
  const wanted = [...new Map(built.images.map((image) => [image.sha256, image])).values()]
  const shas = wanted.map((image) => image.sha256)
  const known =
    shas.length === 0
      ? new Set<string>()
      : new Set((await db.select({ sha256: backupImages.sha256 }).from(backupImages).where(inArray(backupImages.sha256, shas))).map((r) => r.sha256))
  const missing = wanted.filter((image) => !known.has(image.sha256))

  // Every upload of the last 30 days still has its row: pruning never deletes a backup that young, nor an image one names.
  const budget = opts.uploadBudget ?? UPLOAD_BUDGET_30_DAYS
  const used = await uploadsLast30Days(db)
  if (used + missing.length + 1 > budget) {
    throw new BackupError(`Skipped: ${used} uploads in the last 30 days, and the limit is ${budget} (Vercel Blob locks the store for 30 days past its monthly allowance).`)
  }

  for (const image of missing) {
    const [row] = await db
      .select({ bytes: venueImages.bytes })
      .from(venueImages)
      .where(and(eq(venueImages.id, image.id), eq(venueImages.templateId, image.templateId)))
    if (!row) throw new BackupError(`The floor plan image ${image.id} was removed while it was being backed up.`)
    const bytes = new Uint8Array(row.bytes)
    if (sha256Hex(bytes) !== image.sha256) throw new BackupError(`The floor plan image ${image.id} does not match its checksum.`)
    const pathname = imagePathname(image.sha256, image.contentType)
    await store.put(pathname, bytes, image.contentType, { overwrite: true })
    await db
      .insert(backupImages)
      .values({ sha256: image.sha256, pathname, contentType: image.contentType, byteSize: bytes.byteLength })
      .onConflictDoNothing()
  }

  const backupId = randomUUID()
  const pathname = backupPathname(weddingId, new Date(), opts.kind, backupId)
  const gz = gzipSync(Buffer.from(JSON.stringify(built.head), 'utf8'))
  await store.put(pathname, gz, 'application/gzip')
  try {
    const row = await db.transaction(async (tx) => {
      if (shas.length > 0) {
        const present = await tx.select({ sha256: backupImages.sha256 }).from(backupImages).where(inArray(backupImages.sha256, shas))
        if (present.length !== shas.length) throw new BackupError('A floor plan image this backup needs is no longer in the backup store.')
      }
      const [inserted] = await tx
        .insert(backups)
        .values({
          id: backupId,
          weddingId,
          weddingName: built.weddingName,
          kind: opts.kind,
          pathname,
          byteSize: gz.byteLength,
          blobSha256: sha256Hex(gz),
          contentSha256: built.contentSha256,
          imageSha256s: shas,
          formatVersion: BACKUP_VERSION,
          guestCount: built.guestCount,
          layoutCount: built.layoutCount,
          createdBy: opts.userId ?? null,
          runId: opts.runId ?? null,
        })
        .returning()
      return inserted!
    })
    return { status: 'created', backup: row }
  } catch (err) {
    await store.delete([pathname]).catch((cleanup: unknown) => logFailure(`could not delete the unrecorded file ${pathname}`, cleanup))
    throw err
  }
}

// ---------------------------------------------------------------- pruning

/**
 * Deletes the backups retention.ts says to, each file first and then its
 * row (stopped in between, a row is left naming a file that is gone; the
 * next prune deletes that row, as retention still says to), then every image
 * no backup names any more, once it is a day old, file first and then row.
 * Answers how many backups went. A store failure stops it; the rest waits for
 * the next run.
 */
export async function pruneBackups(db: Db, store: BackupStore, now: Date = new Date()): Promise<number> {
  const rows = await db
    .select({ id: backups.id, weddingId: backups.weddingId, kind: backups.kind, createdAt: backups.createdAt, pathname: backups.pathname })
    .from(backups)
    .orderBy(asc(backups.createdAt), asc(backups.id))
  const byId = new Map(rows.map((r) => [r.id, r]))
  const doomed = backupsToPrune(rows, now, DEFAULT_RETENTION)
  let pruned = 0
  for (let i = 0; i < doomed.length; i += 100) {
    const ids = doomed.slice(i, i + 100)
    await store.delete(ids.map((id) => byId.get(id)!.pathname))
    await db.delete(backups).where(inArray(backups.id, ids))
    pruned += ids.length
  }

  const unnamed = sql`not exists (select 1 from "backups" b where "backup_images"."sha256" = any(b."image_sha256s"))`
  const orphans = await db
    .select({ sha256: backupImages.sha256, pathname: backupImages.pathname })
    .from(backupImages)
    .where(and(lt(backupImages.createdAt, new Date(now.getTime() - IMAGE_GRACE_MS)), unnamed))
  for (let i = 0; i < orphans.length; i += 100) {
    const part = orphans.slice(i, i + 100)
    await store.delete(part.map((o) => o.pathname))
    await db.delete(backupImages).where(and(inArray(backupImages.sha256, part.map((o) => o.sha256)), unnamed))
  }
  return pruned
}

// ---------------------------------------------------------------- a run

function statusOf(summary: RunSummary): RunSummary['status'] {
  if (summary.failed > 0 && summary.backedUp + summary.unchanged === 0) return 'failed'
  if (summary.failed > 0 || summary.remaining > 0 || summary.error) return 'partial'
  return 'ok'
}

/** One run of the job (see the top of this file). Never throws for one wedding's failure. */
export async function runBackups(db: Db, store: BackupStore, opts: RunOptions): Promise<RunSummary> {
  const summary: RunSummary = {
    status: 'ok',
    runId: null,
    backedUp: 0,
    unchanged: 0,
    failed: 0,
    skipped: 0,
    remaining: 0,
    pruned: 0,
    failures: [],
    results: [],
    error: null,
  }
  const runId = await acquireLease(db, opts.trigger, opts.userId ?? null)
  if (!runId) return { ...summary, status: 'busy' }
  summary.runId = runId

  try {
    const list = await orderedCandidates(db, runId, opts.weddingIds)
    for (let i = 0; i < list.length; i++) {
      const candidate = list[i]!
      if (Date.now() >= opts.deadline) {
        summary.remaining = list.length - i
        break
      }
      if (!(await heartbeat(db, runId, summary, candidate.weddingId))) {
        throw new LeaseLostError('Another run took over this one (no heartbeat for 6 minutes).')
      }
      const kind: BackupKind = candidate.deleted ? 'final' : (opts.kind ?? 'nightly')
      try {
        const result = await backupOneWedding(db, store, candidate.weddingId, {
          kind,
          userId: opts.userId ?? null,
          runId,
          uploadBudget: opts.uploadBudget,
        })
        if (result.status === 'created') summary.backedUp++
        else if (result.status === 'unchanged') summary.unchanged++
        else summary.skipped++
        summary.results.push({
          weddingId: candidate.weddingId,
          status: result.status,
          backupId: result.status === 'not-found' ? null : result.backup.id,
          message: null,
        })
      } catch (err) {
        const message = safeFailureMessage(err)
        logFailure(`wedding ${candidate.weddingId}`, err)
        summary.failed++
        summary.failures.push({ weddingId: candidate.weddingId, message })
        summary.results.push({ weddingId: candidate.weddingId, status: 'failed', backupId: null, message })
      }
    }
    if (!opts.weddingIds && summary.remaining === 0 && Date.now() < opts.deadline) {
      try {
        summary.pruned = await pruneBackups(db, store, new Date())
      } catch (err) {
        logFailure('pruning', err)
        summary.error = `Pruning stopped: ${safeFailureMessage(err)}`
      }
    }
    summary.status = statusOf(summary)
  } catch (err) {
    logFailure('the run', err)
    summary.status = 'failed'
    summary.error = safeFailureMessage(err)
  }
  await finishRun(db, runId, summary)
  return summary
}
