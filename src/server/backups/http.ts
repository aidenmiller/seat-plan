import 'server-only'
import type { NextResponse } from 'next/server'
import { uuid } from '@/shared/api'
import type { BackupRunCounts, RestoredBackupReply } from '@/shared/backups-api'
import { attachmentDisposition, json } from '../api-route'
import { backupFileName } from '../backup'
import type { BackupRow } from '../repo/backups'
import { backupFileStream } from './assemble'
import { openStoredBackup, storeImageReader } from './read'
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

/** 500 for a stored backup that fails its checks. The message names what is wrong, never what the backup holds. */
export function corrupt(message: string): NextResponse {
  return json({ error: 'corrupt', message }, 500)
}

/**
 * A stored backup as a normal backup file download (format seat-plan-backup,
 * version 2, images included), named like the live download but with the
 * backup's date. The file is checked before the reply starts; each image is
 * checked as it is streamed, and a bad one breaks the download rather than
 * deliver a file that would not restore.
 */
export async function storedBackupDownload(store: BackupStore, backup: BackupRow): Promise<Response> {
  const opened = await openStoredBackup(store, backup)
  if (!opened.ok) return corrupt(opened.message)
  return new Response(backupFileStream(opened.head, storeImageReader(store)), {
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

/** 409 when another run holds the lease. */
export function busy(): NextResponse {
  return json({ error: 'busy', message: 'A backup run is going. Try again in a few minutes.' }, 409)
}

/** How long the cron and admin runs may take before they stop starting weddings: well inside Vercel's 300 s. */
export const RUN_BUDGET_MS = 240_000
