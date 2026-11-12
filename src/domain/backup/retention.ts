/**
 * Which stored backups to delete (the nightly prune, src/server/backups/runner.ts).
 * Pure: it sees only each backup's wedding, kind and time.
 *
 * A backup is kept when any of these holds:
 *  1. It is from the last `dailyDays` days (30): every backup of the last month.
 *  2. It is the first backup of its wedding in a calendar month (UTC), for the
 *     current month and the `monthlyMonths - 1` months before it (12 in all).
 *  3. It is the newest backup of its wedding. A wedding nobody touches is
 *     found "unchanged" night after night and gets no new backup, so without
 *     this its last copy would age out and it would have none. The one
 *     exception: a `final` backup (the last copy of a deleted wedding) once it
 *     is `monthlyMonths` months old. A deleted wedding gets no newer backup,
 *     so this is what lets a deleted wedding's data leave the store a year on.
 *  4. It is a `final` backup younger than `monthlyMonths` months.
 * Everything else is pruned.
 */

export type RetentionKind = 'nightly' | 'manual' | 'final'

export type RetentionEntry = { id: string; weddingId: string; kind: RetentionKind; createdAt: Date }

export type RetentionPolicy = { dailyDays: number; monthlyMonths: number }

export const DEFAULT_RETENTION: RetentionPolicy = { dailyDays: 30, monthlyMonths: 12 }

const DAY_MS = 86_400_000

/** Months since year 0, in UTC: one number per calendar month. */
function monthIndex(d: Date): number {
  return d.getUTCFullYear() * 12 + d.getUTCMonth()
}

/** `d` moved back `months` calendar months (UTC). The 31st of a month without one rolls into the next month, as Date does. */
function monthsBefore(d: Date, months: number): Date {
  const out = new Date(d.getTime())
  out.setUTCMonth(out.getUTCMonth() - months)
  return out
}

/** Oldest first; the id breaks a tie so the answer never depends on the input order. */
function byAge(a: RetentionEntry, b: RetentionEntry): number {
  return a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/** The ids of the backups to delete, oldest first. */
export function backupsToPrune(list: readonly RetentionEntry[], now: Date, policy: RetentionPolicy = DEFAULT_RETENTION): string[] {
  const dailyCutoff = now.getTime() - policy.dailyDays * DAY_MS
  const finalCutoff = monthsBefore(now, policy.monthlyMonths).getTime()
  const oldestKeptMonth = monthIndex(now) - policy.monthlyMonths + 1

  const sorted = [...list].sort(byAge)
  const keep = new Set<string>()
  const firstOfMonth = new Set<string>()
  const newest = new Map<string, RetentionEntry>()

  for (const b of sorted) {
    const time = b.createdAt.getTime()
    if (time > dailyCutoff) keep.add(b.id)
    if (b.kind === 'final' && time > finalCutoff) keep.add(b.id)
    const month = monthIndex(b.createdAt)
    const monthKey = `${b.weddingId}|${month}`
    if (!firstOfMonth.has(monthKey)) {
      firstOfMonth.add(monthKey)
      if (month >= oldestKeptMonth) keep.add(b.id)
    }
    newest.set(b.weddingId, b)
  }
  for (const b of newest.values()) {
    const expiredFinal = b.kind === 'final' && b.createdAt.getTime() <= finalCutoff
    if (!expiredFinal) keep.add(b.id)
  }
  return sorted.filter((b) => !keep.has(b.id)).map((b) => b.id)
}
