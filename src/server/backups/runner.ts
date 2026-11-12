import 'server-only'
import { randomUUID } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { and, asc, desc, eq, inArray, isNull, lt, ne, sql } from 'drizzle-orm'
import { BACKUP_VERSION } from '@/domain/backup/schema'
import { backupsToPrune, DEFAULT_RETENTION } from '@/domain/backup/retention'
import { backupImages, backupRuns, backups, venueImages, weddings, type BackupFailure } from '../db/schema'
import type { Db } from '../locks'
import { manualUploadsLast30Days, uploadsLast30Days } from '../repo/backups'
import { BackupIntegrityError } from './assemble'
import { buildBackup } from './build'
import { checkHeadJson } from './format'
import { sha256Hex } from './hash'
import { withWeddingBackupLock } from './lock'
import { markUnreadable, openStoredBackup } from './read'
import { backupPathname, BackupStoreError, imagePathname, type BackupStore } from './store'

/**
 * The backup job (PLAN section 7, "Automatic backups"). Run by the nightly
 * cron, by an admin ("Run backups now"), and for one wedding by its owner
 * ("Back up now").
 *
 * A full run (the cron's or an admin's):
 *
 *  1. Takes the lease: under an advisory lock, in one short transaction, it
 *     marks a run whose heartbeat is older than 6 minutes 'failed' (timed
 *     out) and inserts its own 'running' row, unless another full run is
 *     alive. A transaction lock, not a session one, so it works through
 *     Neon's pooler. When another run is alive it can wait for it
 *     (leaseWaitMs, the cron does: Vercel never calls a cron again); if that
 *     run is still going when the wait is over it answers 'busy' and does
 *     nothing, and a cron run records that as a failed run, so the admin page
 *     shows it.
 *  2. Reads one stored backup back (checkOneBackup, the self-check): the one
 *     checked longest ago. One read a night, so every backup is read back in
 *     turn; one found missing or damaged is marked unreadable and reported.
 *  3. Lists the weddings to back up (orderedCandidates): every live wedding,
 *     and every wedding deleted in the last 12 months whose deletion is newer
 *     than its last readable backup (it gets one 'final' backup). Only
 *     backups in this store count (BackupStore.id), so after the store is
 *     replaced every wedding is backed up afresh.
 *  4. Backs each up in turn (backupOneWedding) under the wedding's backup lock
 *     (lock.ts), each in its own try/catch, so one failure never stops the
 *     others; a failure is recorded by wedding id with a message that never
 *     holds guest data. A wedding whose owner is backing it up at that moment
 *     is tried again at the end of the run, and if still busy is skipped (its
 *     owner's backup covers it). Past the deadline it stops, 'partial', and
 *     counts what is left; the next run starts with those.
 *  5. Prunes old backups (pruneBackups).
 *  6. Finishes its row: 'ok', 'partial' or 'failed'.
 *
 * An owner's run backs up the one wedding under its backup lock only: it
 * never takes the lease, so it never holds up the nightly run, and runs
 * beside it. Its row in backup_runs is written when it is done.
 *
 * Every backup is checked against the backup format before it is uploaded
 * (format.ts): a wedding that does not fit fails, by field, and is never
 * found "unchanged" since a backup of the same content, so it cannot sit
 * silently on a backup that would not restore.
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
/**
 * The share of that limit kept for the nightly run: backups made by hand
 * ("Back up now", across every planner) may use only the rest, so no one can
 * use up the uploads the nightly backup of every wedding needs.
 */
export const NIGHTLY_RESERVE_30_DAYS = 1000
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

/** Not backed up because the upload limit (or the share of it Back up now may use) is reached. */
export class UploadLimitError extends BackupError {}

class LeaseLostError extends BackupError {}

export type BackupOneResult = { status: 'created'; backup: BackupRow } | { status: 'unchanged'; backup: BackupRow } | { status: 'not-found' }

export type WeddingResult = {
  weddingId: string
  /** busy: someone else was backing the wedding up at that moment (an owner's Back up now, or the nightly run). */
  status: 'created' | 'unchanged' | 'not-found' | 'failed' | 'busy'
  backupId: string | null
  message: string | null
}

export type RunSummary = {
  status: 'ok' | 'partial' | 'failed' | 'busy'
  /** The run's row; for 'busy', the failed row a cron run records, or null. */
  runId: string | null
  backedUp: number
  unchanged: number
  failed: number
  /** Weddings that were gone by the time their turn came (deleted during the run), or being backed up by someone else. */
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
  /** Only these weddings (an owner's "Back up now", which must name them); no self-check, no pruning. */
  weddingIds?: readonly string[]
  /** The kind for live weddings: 'nightly' unless said otherwise. Deleted weddings always get 'final'. */
  kind?: 'nightly' | 'manual'
  uploadBudget?: number
  /** Of uploadBudget, the share manual backups may not use (NIGHTLY_RESERVE_30_DAYS). */
  nightlyReserve?: number
  /** How long a full run waits for another one holding the lease (never past the deadline). 0: not at all. */
  leaseWaitMs?: number
  /** How often it looks again while it waits. */
  leasePollMs?: number
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

/** 2026-11-11 08:03 UTC */
function utcMinute(d: Date): string {
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

// ---------------------------------------------------------------- the lease

type Lease = { runId: string } | { runId: null; holder: { trigger: RunTrigger; startedAt: Date } | null }

/** Inserts this run's 'running' row, or answers which run is alive. */
async function acquireLease(db: Db, trigger: RunTrigger, userId: string | null): Promise<Lease> {
  return db.transaction(async (tx): Promise<Lease> => {
    await tx.execute(LEASE_LOCK)
    await tx
      .update(backupRuns)
      .set({ status: 'failed', finishedAt: sql`now()`, error: 'Timed out: no heartbeat for 6 minutes.' })
      .where(and(eq(backupRuns.status, 'running'), sql`${backupRuns.heartbeatAt} < now() - make_interval(secs => ${LEASE_STALE_MS / 1000})`))
    const [alive] = await tx
      .select({ trigger: backupRuns.trigger, startedAt: backupRuns.startedAt })
      .from(backupRuns)
      .where(eq(backupRuns.status, 'running'))
      .limit(1)
    if (alive) return { runId: null, holder: alive }
    const [row] = await tx.insert(backupRuns).values({ trigger, startedBy: userId }).returning({ id: backupRuns.id })
    return { runId: row!.id }
  })
}

/** The lease, looking again every leasePollMs until leaseWaitMs (or the deadline) is up. */
async function acquireLeaseWaiting(db: Db, opts: RunOptions): Promise<Lease> {
  const until = Math.min(Date.now() + (opts.leaseWaitMs ?? 0), opts.deadline)
  const poll = Math.max(10, opts.leasePollMs ?? 5000)
  let lease = await acquireLease(db, opts.trigger, opts.userId ?? null)
  while (lease.runId === null && Date.now() + poll <= until) {
    await new Promise((resolve) => setTimeout(resolve, poll))
    lease = await acquireLease(db, opts.trigger, opts.userId ?? null)
  }
  return lease
}

/**
 * A cron call that gave up waiting for the lease: recorded as a failed
 * nightly run, so the admin page lists it and the last good nightly run
 * stays where it was.
 */
async function recordSkippedCronRun(db: Db, holder: { trigger: RunTrigger; startedAt: Date } | null, waitedMs: number): Promise<{ runId: string | null; error: string }> {
  const who = !holder ? 'another backup run' : holder.trigger === 'cron' ? 'another nightly run' : holder.trigger === 'admin' ? 'an admin’s Run now' : 'another backup run'
  const error = `Did not run: ${who}${holder ? `, started ${utcMinute(holder.startedAt)},` : ''} was still going after ${Math.round(waitedMs / 1000)} s of waiting.`
  try {
    const [row] = await db
      .insert(backupRuns)
      .values({ trigger: 'cron', status: 'failed', finishedAt: sql`now()`, error })
      .returning({ id: backupRuns.id })
    return { runId: row?.id ?? null, error }
  } catch (err) {
    logFailure('could not record a skipped nightly run', err)
    return { runId: null, error }
  }
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
 * The weddings this run backs up: every live wedding, and every wedding
 * deleted in the last 12 months whose deletion is newer than its last
 * readable backup in this store (its final backup). The 12 months stop a
 * deleted wedding from coming back once retention has let its final backup
 * go, 12 months after it was made. In order:
 *  - never backed up first, then the one checked longest ago (checked_at:
 *    when its last backup was made or last found unchanged), so after a run
 *    that stopped at its deadline the next one starts with what it missed;
 *  - but a wedding that failed in the last full run goes after all the rest,
 *    so one that keeps failing cannot hold the others up. Not one skipped for
 *    the upload limit, nor one whose old backup the self-check found
 *    unreadable: those say nothing about backing the wedding up, and a
 *    wedding skipped for the limit must not wait behind every other.
 * A backup marked unreadable counts for nothing here.
 */
async function orderedCandidates(db: Db, storeId: string, runId: string, weddingIds?: readonly string[]): Promise<Candidate[]> {
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
      where store_id = ${storeId} and unreadable_at is null
      order by wedding_id, created_at desc, id desc
    )
    select w.id, w.deleted_at, w.created_at, l.checked_at as last_checked_at
    from weddings w
    left join latest l on l.wedding_id = w.id
    where (
      w.deleted_at is null
      or (
        w.deleted_at > now() - make_interval(months => ${DEFAULT_RETENTION.monthlyMonths})
        and (l.created_at is null or w.deleted_at > l.created_at)
      )
    )
    ${only}
  `)
  const [previous] = await db
    .select({ failures: backupRuns.failures })
    .from(backupRuns)
    .where(and(inArray(backupRuns.trigger, ['cron', 'admin']), ne(backupRuns.status, 'running'), ne(backupRuns.id, runId)))
    .orderBy(desc(backupRuns.startedAt))
    .limit(1)
  const failedBefore = new Set((previous?.failures ?? []).filter((f) => !f.reason).map((f) => f.weddingId))
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
 * Throws UploadLimitError when `needed` more uploads would pass the limit.
 * Every backup counts against UPLOAD_BUDGET_30_DAYS; a manual one also
 * against the share manual backups may use (the budget less the nightly
 * reserve), counted from manual backups only, so a busy nightly run does not
 * stop Back up now, and Back up now can never take what the nightly run needs.
 */
async function checkUploadLimit(db: Db, needed: number, kind: BackupKind, opts: { uploadBudget?: number; nightlyReserve?: number }): Promise<void> {
  // Counted from the rows: pruning never deletes a backup younger than 30 days, nor an image one names. (An image
  // uploaded for a backup whose row then failed can be pruned a day later, so the count can run a little low.)
  const budget = opts.uploadBudget ?? UPLOAD_BUDGET_30_DAYS
  const used = await uploadsLast30Days(db)
  const pause = kind === 'manual' ? 'Back up now is paused' : 'Skipped'
  if (used + needed > budget) {
    throw new UploadLimitError(`${pause}: ${used} uploads in the last 30 days, and the limit is ${budget} (Vercel Blob locks the store for 30 days past its monthly allowance).`)
  }
  if (kind === 'manual') {
    const share = Math.max(0, budget - (opts.nightlyReserve ?? NIGHTLY_RESERVE_30_DAYS))
    const manual = await manualUploadsLast30Days(db)
    if (manual + needed > share) {
      throw new UploadLimitError(
        `${pause}: backups made by hand used ${manual} of the ${share} uploads they may make in 30 days; the rest is kept for the nightly backup, which still runs.`,
      )
    }
  }
}

/**
 * Backs up one wedding (kind 'final' for a deleted one), unless nothing in it
 * changed since its last backup (contentSha256, build.ts): then that backup's
 * checked_at moves to now and it is answered 'unchanged'. A final backup is
 * always made, changed or not: it marks the deletion and is kept a year.
 *
 * Before anything else the backup is checked against the backup format
 * (format.ts), so a wedding that would not restore fails here, by field,
 * rather than be stored, or found "unchanged" since a backup that would not
 * restore either. A last backup marked unreadable is never "unchanged".
 *
 * Images go up first, each once per store (backup_images, by sha256,
 * overwrite allowed since the bytes are the same), then the gzipped head,
 * then its row. The row's transaction holds the images' rows (FOR SHARE)
 * while it checks they are all still there, so a prune deleting one waits
 * for it, then sees it named and keeps it (pruneBackups).
 * If the row cannot be written after the upload, the file is deleted again;
 * if that delete fails too the file stays as an orphan nothing names, which
 * is harmless (it is small and never read) and accepted.
 *
 * The caller holds the wedding's backup lock (lock.ts).
 */
export async function backupOneWedding(
  db: Db,
  store: BackupStore,
  weddingId: string,
  opts: { kind: BackupKind; userId?: string | null; runId?: string | null; uploadBudget?: number; nightlyReserve?: number },
): Promise<BackupOneResult> {
  const built = await buildBackup(db, weddingId, { includeDeleted: opts.kind === 'final' })
  if (!built) return { status: 'not-found' }
  if (opts.kind === 'final' && !built.deletedAt) throw new BackupError('A final backup is only made of a deleted wedding.')

  const json = JSON.stringify(built.head)
  const fits = checkHeadJson(json)
  if (!fits.ok) throw new BackupError(`Not backed up: this wedding does not fit the backup format (${fits.problem}).`)

  if (opts.kind !== 'final') {
    const [latest] = await db
      .select({ id: backups.id, contentSha256: backups.contentSha256, unreadableAt: backups.unreadableAt })
      .from(backups)
      .where(and(eq(backups.weddingId, weddingId), eq(backups.storeId, store.id)))
      .orderBy(desc(backups.createdAt), desc(backups.id))
      .limit(1)
    if (latest && latest.unreadableAt === null && latest.contentSha256 === built.contentSha256) {
      const [checked] = await db
        .update(backups)
        .set({ checkedAt: sql`now()` })
        .where(and(eq(backups.id, latest.id), isNull(backups.unreadableAt)))
        .returning()
      if (checked) return { status: 'unchanged', backup: checked }
    }
  }

  // Each image once, by content.
  const wanted = [...new Map(built.images.map((image) => [image.sha256, image])).values()]
  const shas = wanted.map((image) => image.sha256)
  const known =
    shas.length === 0
      ? new Set<string>()
      : new Set(
          (
            await db
              .select({ sha256: backupImages.sha256 })
              .from(backupImages)
              .where(and(eq(backupImages.storeId, store.id), inArray(backupImages.sha256, shas)))
          ).map((r) => r.sha256),
        )
  const missing = wanted.filter((image) => !known.has(image.sha256))

  await checkUploadLimit(db, missing.length + 1, opts.kind, opts)

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
      .values({ storeId: store.id, sha256: image.sha256, pathname, contentType: image.contentType, byteSize: bytes.byteLength })
      .onConflictDoNothing()
  }

  const backupId = randomUUID()
  const pathname = backupPathname(weddingId, new Date(), opts.kind, backupId)
  const gz = gzipSync(Buffer.from(json, 'utf8'))
  await store.put(pathname, gz, 'application/gzip')
  try {
    const row = await db.transaction(async (tx) => {
      if (shas.length > 0) {
        const present = await tx
          .select({ sha256: backupImages.sha256 })
          .from(backupImages)
          .where(and(eq(backupImages.storeId, store.id), inArray(backupImages.sha256, shas)))
          .orderBy(asc(backupImages.sha256))
          .for('share')
        if (present.length !== shas.length) throw new BackupError('A floor plan image this backup needs is no longer in the backup store.')
      }
      const [inserted] = await tx
        .insert(backups)
        .values({
          id: backupId,
          storeId: store.id,
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

// ---------------------------------------------------------------- the self-check

/**
 * Reads one stored backup back, the one checked longest ago (never-checked
 * first, then oldest): its file is there, matches its checksum, unzips and
 * fits the format (read.ts, openStoredBackup). One read a run, so the check
 * costs one Blob operation a night and still reaches every backup in turn.
 *
 * A backup that fails is marked unreadable (it is never again what
 * "unchanged" compares with, so when it was its wedding's newest the run
 * makes a fresh backup) and reported as a failure the admin page shows. A
 * store that cannot be reached marks nothing: that is not the backup's fault.
 */
async function checkOneBackup(db: Db, store: BackupStore, summary: RunSummary): Promise<void> {
  try {
    const [backup] = await db
      .select({ id: backups.id, weddingId: backups.weddingId, pathname: backups.pathname, blobSha256: backups.blobSha256, createdAt: backups.createdAt })
      .from(backups)
      .where(and(eq(backups.storeId, store.id), isNull(backups.unreadableAt)))
      .orderBy(sql`${backups.verifiedAt} asc nulls first`, asc(backups.createdAt), asc(backups.id))
      .limit(1)
    if (!backup) return
    const opened = await openStoredBackup(store, backup)
    if (opened.ok) {
      await db.update(backups).set({ verifiedAt: sql`now()` }).where(eq(backups.id, backup.id))
      return
    }
    await markUnreadable(db, backup.id)
    summary.failures.push({
      weddingId: backup.weddingId,
      message: safeFailureMessage(
        new BackupError(`Self-check: the backup of ${utcMinute(backup.createdAt)} is unreadable (${opened.problem}). It is marked; if it was the wedding’s newest, a fresh backup is made.`),
      ),
      reason: 'check',
    })
  } catch (err) {
    logFailure('the self-check', err)
  }
}

// ---------------------------------------------------------------- pruning

/**
 * Deletes the backups retention.ts says to (a deleted wedding's final backup
 * goes a year on only while the wedding is still deleted), then every image
 * no backup names any more, once it is a day old.
 *
 * Always the row first, then the file: stopped in between, a file is left
 * that nothing names (harmless, and accepted), never a row naming a file that
 * is gone, which a later backup or restore would trust. An image's row is
 * deleted in a transaction that first locks it (FOR UPDATE, so a backup now
 * naming it, which holds it FOR SHARE, finishes first) and then deletes it
 * only if still no backup names it.
 *
 * Answers how many backups went. A failure stops it; the rest waits for the
 * next run.
 */
export async function pruneBackups(db: Db, store: BackupStore, now: Date = new Date()): Promise<number> {
  const rows = await db
    .select({
      id: backups.id,
      weddingId: backups.weddingId,
      kind: backups.kind,
      createdAt: backups.createdAt,
      weddingLive: sql<boolean>`(${weddings.id} is not null and ${weddings.deletedAt} is null)`,
    })
    .from(backups)
    .leftJoin(weddings, eq(weddings.id, backups.weddingId))
    .where(eq(backups.storeId, store.id))
    .orderBy(asc(backups.createdAt), asc(backups.id))
  const doomed = backupsToPrune(rows, now, DEFAULT_RETENTION)
  let pruned = 0
  for (let i = 0; i < doomed.length; i += 100) {
    const ids = doomed.slice(i, i + 100)
    const gone = await db
      .delete(backups)
      .where(and(eq(backups.storeId, store.id), inArray(backups.id, ids)))
      .returning({ pathname: backups.pathname })
    pruned += gone.length
    if (gone.length > 0) await store.delete(gone.map((g) => g.pathname))
  }

  const unnamed = sql`not exists (
    select 1 from "backups" b
    where b."store_id" = "backup_images"."store_id" and b."image_sha256s" @> array["backup_images"."sha256"]
  )`
  const orphans = await db
    .select({ sha256: backupImages.sha256 })
    .from(backupImages)
    .where(and(eq(backupImages.storeId, store.id), lt(backupImages.createdAt, new Date(now.getTime() - IMAGE_GRACE_MS)), unnamed))
    .orderBy(asc(backupImages.sha256))
  for (let i = 0; i < orphans.length; i += 100) {
    const part = orphans.slice(i, i + 100).map((o) => o.sha256)
    const gone = await db.transaction(async (tx) => {
      const these = and(eq(backupImages.storeId, store.id), inArray(backupImages.sha256, part))
      await tx.select({ sha256: backupImages.sha256 }).from(backupImages).where(these).orderBy(asc(backupImages.sha256)).for('update')
      return tx.delete(backupImages).where(and(these, unnamed)).returning({ pathname: backupImages.pathname })
    })
    if (gone.length > 0) await store.delete(gone.map((g) => g.pathname))
  }
  return pruned
}

// ---------------------------------------------------------------- a run

function emptySummary(): RunSummary {
  return {
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
}

function statusOf(summary: RunSummary): RunSummary['status'] {
  if (summary.failed > 0 && summary.backedUp + summary.unchanged === 0) return 'failed'
  if (summary.failures.length > 0 || summary.failed > 0 || summary.remaining > 0 || summary.error) return 'partial'
  return 'ok'
}

/**
 * One wedding, under its backup lock, with the result added to the summary.
 * Answers false, adding nothing, when someone else holds the lock.
 */
async function backUpCandidate(
  db: Db,
  store: BackupStore,
  summary: RunSummary,
  weddingId: string,
  opts: { kind: BackupKind; userId: string | null; runId: string | null; uploadBudget?: number; nightlyReserve?: number },
): Promise<boolean> {
  try {
    const locked = await withWeddingBackupLock(db, weddingId, () => backupOneWedding(db, store, weddingId, opts))
    if (!locked.locked) return false
    const result = locked.value
    if (result.status === 'created') summary.backedUp++
    else if (result.status === 'unchanged') summary.unchanged++
    else summary.skipped++
    summary.results.push({ weddingId, status: result.status, backupId: result.status === 'not-found' ? null : result.backup.id, message: null })
  } catch (err) {
    const message = safeFailureMessage(err)
    logFailure(`wedding ${weddingId}`, err)
    summary.failed++
    summary.failures.push(err instanceof UploadLimitError ? { weddingId, message, reason: 'budget' } : { weddingId, message })
    summary.results.push({ weddingId, status: 'failed', backupId: null, message })
  }
  return true
}

function busyResult(summary: RunSummary, weddingId: string): void {
  summary.skipped++
  summary.results.push({ weddingId, status: 'busy', backupId: null, message: 'Someone else was backing this wedding up at the time.' })
}

/**
 * An owner's "Back up now": the named weddings, each under its backup lock,
 * without the lease, so it runs beside a nightly run and never holds it up.
 * 'busy' when every wedding was being backed up by someone else. Its row in
 * backup_runs is written at the end, finished (only one row may be
 * 'running', and that is the full run's).
 */
async function runOwnerBackups(db: Db, store: BackupStore, opts: RunOptions): Promise<RunSummary> {
  const summary = emptySummary()
  const startedAt = new Date()
  for (const weddingId of opts.weddingIds ?? []) {
    const went = await backUpCandidate(db, store, summary, weddingId, {
      kind: opts.kind ?? 'manual',
      userId: opts.userId ?? null,
      runId: null,
      uploadBudget: opts.uploadBudget,
      nightlyReserve: opts.nightlyReserve,
    })
    if (!went) busyResult(summary, weddingId)
  }
  if (summary.results.length > 0 && summary.results.every((r) => r.status === 'busy')) return { ...summary, status: 'busy' }
  summary.status = statusOf(summary)
  try {
    const created = summary.results.flatMap((r) => (r.status === 'created' && r.backupId ? [r.backupId] : []))
    summary.runId = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(backupRuns)
        .values({
          trigger: 'owner',
          startedBy: opts.userId ?? null,
          startedAt,
          heartbeatAt: sql`now()`,
          finishedAt: sql`now()`,
          status: summary.status === 'busy' ? 'failed' : summary.status,
          backedUp: summary.backedUp,
          unchanged: summary.unchanged,
          failed: summary.failed,
          failures: summary.failures,
        })
        .returning({ id: backupRuns.id })
      if (created.length > 0) await tx.update(backups).set({ runId: row!.id }).where(inArray(backups.id, created))
      return row!.id
    })
  } catch (err) {
    // The backups stand; only the record of the run is missing.
    logFailure('could not record the owner’s run', err)
  }
  return summary
}

/** One run of the job (see the top of this file). Never throws for one wedding's failure. */
export async function runBackups(db: Db, store: BackupStore, opts: RunOptions): Promise<RunSummary> {
  if (opts.trigger === 'owner') return runOwnerBackups(db, store, opts)
  const summary = emptySummary()
  const waitStarted = Date.now()
  const lease = await acquireLeaseWaiting(db, opts)
  if (lease.runId === null) {
    if (opts.trigger !== 'cron') return { ...summary, status: 'busy' }
    const skipped = await recordSkippedCronRun(db, lease.holder, Date.now() - waitStarted)
    return { ...summary, status: 'busy', runId: skipped.runId, error: skipped.error }
  }
  const runId = lease.runId
  summary.runId = runId
  const each = { kind: opts.kind ?? 'nightly', userId: opts.userId ?? null, runId, uploadBudget: opts.uploadBudget, nightlyReserve: opts.nightlyReserve } as const

  try {
    if (!opts.weddingIds && Date.now() < opts.deadline) await checkOneBackup(db, store, summary)
    const list = await orderedCandidates(db, store.id, runId, opts.weddingIds)
    // Weddings someone else was backing up at their turn: tried once more at the end.
    const later: Candidate[] = []
    for (const [pass, queue] of [
      ['first', list],
      ['again', later],
    ] as const) {
      for (let i = 0; i < queue.length; i++) {
        const candidate = queue[i]!
        if (Date.now() >= opts.deadline) {
          summary.remaining = queue.length - i + (pass === 'first' ? later.length : 0)
          break
        }
        if (!(await heartbeat(db, runId, summary, candidate.weddingId))) {
          throw new LeaseLostError('Another run took over this one (no heartbeat for 6 minutes).')
        }
        const kind: BackupKind = candidate.deleted ? 'final' : each.kind
        const went = await backUpCandidate(db, store, summary, candidate.weddingId, { ...each, kind })
        if (!went) {
          if (pass === 'first') later.push(candidate)
          else busyResult(summary, candidate.weddingId)
        }
      }
      if (summary.remaining > 0) break
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
