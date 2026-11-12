import 'server-only'
import type { z } from 'zod'
import { storedBackupHeadSchema, type StoredBackupHead } from '@/domain/backup/schema'

/**
 * Whether a backup fits the backup format, checked the same way everywhere:
 * before the nightly job uploads one (runner.ts), when a stored one is opened
 * (read.ts), and before the live download is sent (backup.ts). A backup that
 * fails here would fail "Restore from file" and the server's restore, so it
 * is never stored or handed over as if it were fine.
 *
 * Problems are described by where they are and what kind they are only
 * ("rules.3.note is longer than 10000 characters"), never by the value or a
 * message a refinement wrote (one names a group), so the description is safe
 * to record and show an admin.
 */

/** The most a backup's JSON may be: what read.ts unzips at most, far above any real wedding. */
export const MAX_HEAD_BYTES = 64 * 1024 * 1024

export type HeadCheck = { ok: true; head: StoredBackupHead } | { ok: false; problem: string }

type Issue = z.core.$ZodIssue

function where(issue: Issue): string {
  return issue.path.length === 0 ? 'the backup' : issue.path.map((p) => (typeof p === 'symbol' ? '?' : String(p))).join('.')
}

/** One issue in words, without the value or the issue's own message. */
export function describeIssue(issue: Issue): string {
  const at = where(issue)
  switch (issue.code) {
    case 'too_big':
      if (issue.origin === 'string') return `${at} is longer than ${String(issue.maximum)} characters`
      if (issue.origin === 'array') return `${at} has more than ${String(issue.maximum)} items`
      return `${at} is more than ${String(issue.maximum)}`
    case 'too_small':
      if (issue.origin === 'string') return Number(issue.minimum) <= 1 ? `${at} is empty` : `${at} is shorter than ${String(issue.minimum)} characters`
      if (issue.origin === 'array') return `${at} has fewer than ${String(issue.minimum)} items`
      return `${at} is less than ${String(issue.minimum)}`
    case 'invalid_type':
      return `${at} is missing or of the wrong kind`
    default:
      return `${at} is not valid`
  }
}

/** The first problem in words, and how many more there are. */
export function describeIssues(issues: readonly Issue[]): string {
  const first = issues[0]
  if (!first) return 'it is not valid'
  return issues.length > 1 ? `${describeIssue(first)}, and ${issues.length - 1} more` : describeIssue(first)
}

/** A backup head (as parsed JSON) checked against the stored-backup format. */
export function checkStoredHead(raw: unknown): HeadCheck {
  const parsed = storedBackupHeadSchema.safeParse(raw)
  if (parsed.success) return { ok: true, head: parsed.data }
  return { ok: false, problem: describeIssues(parsed.error.issues) }
}

/**
 * A head about to be stored or sent: its JSON within MAX_HEAD_BYTES, and the
 * head as that JSON reads back (JSON drops what it cannot hold, so the check
 * sees what a reader will).
 */
export function checkHeadJson(json: string): HeadCheck {
  const bytes = Buffer.byteLength(json, 'utf8')
  if (bytes > MAX_HEAD_BYTES) {
    return { ok: false, problem: `it is ${Math.ceil(bytes / (1024 * 1024))} MB, over the ${MAX_HEAD_BYTES / (1024 * 1024)} MB a backup may hold` }
  }
  return checkStoredHead(JSON.parse(json))
}
