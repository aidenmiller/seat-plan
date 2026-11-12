import 'server-only'
import { NextResponse } from 'next/server'
import { uuid } from '@/shared/api'
import type { BackupRunCounts, RestoredBackupReply } from '@/shared/backups-api'
import { attachmentDisposition, json } from '../api-route'
import { backupFileName } from '../backup'
import type { Db } from '../locks'
import type { BackupRow } from '../repo/backups'
import { backupFileStream } from './assemble'
import { markUnreadable, openStoredBackup, storeImageReader, unreadableMessage } from './read'
import type { RestoreStoredResult } from './restore'
import type { RunSummary } from './runner'
import type { BackupStore } from './store'

/**
 * Replies shared by the stored-backup routes (the owner's under
 * /api/weddings/:id/backups and the admin's under /api/admin/backups).
 */

/** The context of a handler under a [backupId] folder (with [id] above it on the owner's routes). */
export type BackupIdContext = { params: Promise<{ backupId: string; id?: string }> }

/** The [backupId] param when it is a uuid, lower-cased; null otherwise (the caller answers 404). */
export async function backupIdParam(ctx: BackupIdContext): Promise<string | null> {
  const { backupId } = await ctx.params
  return typeof backupId === 'string' && uuid.safeParse(backupId).success ? backupId.toLowerCase() : null
}

/** 503: this deployment has no backup store (store.ts, getBackupStore). */
export function notConfigured(): NextResponse {
  return json(
    {
      error: 'not_configured',
      message: 'Backups are not set up: this deployment has no backup store. On Vercel, connect a private Blob store to Production.',
    },
    503,
  )
}

/** 500 for a stored backup that fails its checks. The message says it is unreadable and what to do, never what the backup holds. */
export function corrupt(message: string): NextResponse {
  return json({ error: 'corrupt', message }, 500)
}

/**
 * A stored backup as a normal backup file download (format seat-plan-backup,
 * version 2, images included), named like the live download but with the
 * backup's date. The file is checked before the reply starts (one that fails
 * is marked unreadable, so the next run makes a fresh backup); each image is
 * checked as it is streamed, and a bad one breaks the download rather than
 * deliver a file that would not restore (and is forgotten, so the next
 * backup that needs it uploads it again).
 */
export async function storedBackupDownload(db: Db, store: BackupStore, backup: BackupRow): Promise<Response> {
  const opened = await openStoredBackup(store, backup)
  if (!opened.ok) {
    await markUnreadable(db, backup.id)
    return corrupt(unreadableMessage(opened.problem))
  }
  return new Response(backupFileStream(opened.head, storeImageReader(store, db)), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': attachmentDisposition(backupFileName(backup.weddingName, backup.createdAt), 'wedding backup.json'),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

/** The reply to a restore of a stored backup. */
export function restoreReply(jobId: string, result: RestoreStoredResult): NextResponse {
  switch (result.status) {
    case 'restored': {
      const reply: RestoredBackupReply = {
        jobId,
        weddingId: result.weddingId,
        weddingName: result.weddingName,
        droppedSeats: result.droppedSeats,
        ownersAdded: result.ownersAdded.length,
      }
      return json(reply, result.existed ? 200 : 201)
    }
    case 'id-taken':
      return json({ error: 'id_taken' }, 409)
    case 'corrupt':
      return corrupt(result.message)
    case 'not-found':
      return json({ error: 'not_found' }, 404)
  }
}

/** A run's counts, without wedding ids or messages. */
export function runCounts(summary: RunSummary): BackupRunCounts {
  return {
    status: summary.status,
    backedUp: summary.backedUp,
    unchanged: summary.unchanged,
    failed: summary.failed,
    skipped: summary.skipped,
    remaining: summary.remaining,
    pruned: summary.pruned,
  }
}

/** 409 when another full run holds the lease (an admin's Run now). */
export function busy(): NextResponse {
  return json({ error: 'busy', message: 'A backup run is going. Try again in a few minutes.' }, 409)
}

/** 409 when this wedding is being backed up at this moment (by the nightly run). */
export function weddingBusy(): NextResponse {
  return json({ error: 'busy', message: 'This wedding is being backed up right now. Try again in a minute.' }, 409)
}

/** 429 with Retry-After. */
export function tooMany(error: string, message: string, retryAfterSeconds: number | null): NextResponse {
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' }
  if (retryAfterSeconds !== null) headers['Retry-After'] = String(retryAfterSeconds)
  return NextResponse.json({ error, message, ...(retryAfterSeconds !== null ? { retryAfter: retryAfterSeconds } : {}) }, { status: 429, headers })
}

/** How long the cron and admin runs may take before they stop starting weddings: well inside Vercel's 300 s. */
export const RUN_BUDGET_MS = 240_000
/**
 * How long the nightly cron waits for a run that holds the lease (an admin's
 * Run now, or a second delivery of the same call) before it gives up, and
 * how often it looks again. Vercel never calls a cron again, so it waits
 * rather than skip the night; whatever it waits comes out of RUN_BUDGET_MS.
 */
export const CRON_LEASE_WAIT_MS = 120_000
export const CRON_LEASE_POLL_MS = 5_000
/** One "Back up now" per wedding per 5 minutes. */
export const MANUAL_INTERVAL_MS = 5 * 60_000
/** Backups by hand one person may make in 24 hours, across all their weddings. */
export const MANUAL_BACKUPS_PER_DAY = 10
