/**
 * What the backup screens say, kept apart from the components so it can be
 * tested without a browser: the plain words for a backup's kind, size and
 * time, what each answer to "Back up now" means, and a restore attempt that
 * keeps its job id, so "Try again" after a failure finishes the same wedding
 * instead of making a second one.
 */
import { ApiRequestError, errorMessage } from '@/client/api'
import { clockTime, plural } from '@/domain/wording'
import type { BackupKind, BackupNowReply, BackupSummary, RestoredBackupReply } from '@/shared/backups-api'

export function kindLabel(kind: BackupKind): string {
  switch (kind) {
    case 'nightly':
      return 'Nightly'
    case 'manual':
      return 'Made by hand'
    case 'final':
      return 'Final copy'
  }
}

/** "84 KB", "1.2 MB". */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/** "Nov 3, 3:42 pm" in this device's time zone, with the year when it is not this year. */
export function backupTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return ''
  const day = date.toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  })
  return `${day}, ${clockTime(date)}`
}

/** "12 guests, 2 layouts". */
export function backupCounts(b: Pick<BackupSummary, 'guestCount' | 'layoutCount'>): string {
  return `${plural(b.guestCount, 'guest')}, ${plural(b.layoutCount, 'layout')}`
}

export type BackupNowResult = {
  /** ok: a backup was made; info: nothing to do; error: it did not work. */
  tone: 'ok' | 'info' | 'error'
  message: string
  /** True when the list should be loaded again. */
  reload: boolean
}

function bodyMessage(error: ApiRequestError): string | null {
  const body = error.body
  if (body && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string') return (body as { message: string }).message
  return null
}

/** Runs "Back up now" and says in plain words what happened. */
export async function runBackupNow(call: () => Promise<BackupNowReply>): Promise<BackupNowResult> {
  try {
    const reply = await call()
    if (reply.status === 'unchanged') {
      return { tone: 'info', message: 'Nothing has changed since the last backup, so no new one was needed.', reload: true }
    }
    return { tone: 'ok', message: 'Backed up.', reload: true }
  } catch (err) {
    if (err instanceof ApiRequestError) {
      if (err.status === 429) return { tone: 'info', message: 'This wedding was already backed up in the last few minutes.', reload: false }
      if (err.status === 409) return { tone: 'info', message: 'A backup run is in progress. Try again shortly.', reload: false }
      if (err.status === 503) return { tone: 'error', message: 'Backups are not set up yet.', reload: false }
      if (err.status === 500) return { tone: 'error', message: `The backup did not work. ${bodyMessage(err) ?? 'Try again.'}`, reload: false }
    }
    return { tone: 'error', message: `Could not back up. ${errorMessage(err)}`, reload: false }
  }
}

/** The sentence for a failed restore. */
export function restoreErrorMessage(err: unknown): string {
  if (err instanceof ApiRequestError) {
    if (err.status === 503) return 'Backups are not set up yet.'
    if (err.status === 500 && (err.body as { error?: unknown } | null)?.error === 'corrupt') {
      return `This backup cannot be restored. ${bodyMessage(err) ?? ''}`.trim()
    }
    if (err.status === 409) return 'This restore was started by someone else. Close this and start it again.'
  }
  return errorMessage(err)
}

export type RestoreAttempt = {
  /** The job id every try of this attempt sends. */
  readonly jobId: string
  run(): Promise<{ ok: true; reply: RestoredBackupReply } | { ok: false; message: string }>
}

/**
 * One restore of one backup. The job id is chosen once, here, and sent on
 * every try: the server answers a repeat of the same id with the wedding it
 * already made, so a retry after a lost reply never makes a second wedding.
 */
export function createRestoreAttempt(
  send: (jobId: string) => Promise<RestoredBackupReply>,
  makeJobId: () => string = () => crypto.randomUUID(),
): RestoreAttempt {
  const jobId = makeJobId()
  return {
    jobId,
    async run() {
      try {
        return { ok: true, reply: await send(jobId) }
      } catch (err) {
        return { ok: false, message: restoreErrorMessage(err) }
      }
    },
  }
}

/** The nightly run is stale when it last succeeded more than this long ago. */
export const STALE_AFTER_MS = 36 * 60 * 60 * 1000

export type NightlyStatus =
  | { state: 'not-set-up' }
  | { state: 'never' }
  | { state: 'stale'; lastIso: string }
  | { state: 'fresh'; lastIso: string }

export function nightlyStatus(configured: boolean, lastSuccessIso: string | null, nowMs: number): NightlyStatus {
  if (!configured) return { state: 'not-set-up' }
  if (!lastSuccessIso) return { state: 'never' }
  const last = Date.parse(lastSuccessIso)
  if (!Number.isFinite(last) || nowMs - last > STALE_AFTER_MS) return { state: 'stale', lastIso: lastSuccessIso }
  return { state: 'fresh', lastIso: lastSuccessIso }
}
