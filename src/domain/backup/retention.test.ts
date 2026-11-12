import { describe, expect, it } from 'vitest'
import { backupsToPrune, type RetentionEntry, type RetentionKind } from './retention'

const NOW = new Date('2026-11-11T08:30:00.000Z')
const W1 = 'wedding-1'
const W2 = 'wedding-2'

let seq = 0
/** A backup. Its wedding is live unless `live` says otherwise; a final backup's wedding is deleted unless it says otherwise. */
function b(createdAt: string, opts: { wedding?: string; kind?: RetentionKind; id?: string; live?: boolean } = {}): RetentionEntry {
  seq++
  const kind = opts.kind ?? 'nightly'
  return { id: opts.id ?? `b${String(seq).padStart(4, '0')}`, weddingId: opts.wedding ?? W1, kind, createdAt: new Date(createdAt), weddingLive: opts.live ?? kind !== 'final' }
}

/** One nightly backup a day at 08:05 UTC for `days` days back from NOW (newest first). */
function nightly(days: number, wedding = W1): RetentionEntry[] {
  const out: RetentionEntry[] = []
  for (let d = 0; d < days; d++) {
    const at = new Date(Date.UTC(2026, 10, 11, 8, 5) - d * 86_400_000)
    out.push(b(at.toISOString(), { wedding }))
  }
  return out
}

const kept = (list: RetentionEntry[], now = NOW) => {
  const pruned = new Set(backupsToPrune(list, now))
  return list.filter((x) => !pruned.has(x.id))
}
const keptDates = (list: RetentionEntry[], now = NOW) =>
  kept(list, now)
    .map((x) => x.createdAt.toISOString().slice(0, 10))
    .sort()

describe('backupsToPrune', () => {
  it('prunes nothing from an empty list or a month of nightlies', () => {
    expect(backupsToPrune([], NOW)).toEqual([])
    expect(backupsToPrune(nightly(30), NOW)).toEqual([])
  })

  it('keeps every backup of the last 30 days, then the first of each month for 12 months', () => {
    const list = nightly(500)
    const dates = keptDates(list)
    // 30 days: 2026-10-13 .. 2026-11-11.
    const recent = dates.filter((d) => d >= '2026-10-13')
    expect(recent).toHaveLength(30)
    // Before that, one a month: the first of the month (the 1st, at 08:05), for 2025-12 .. 2026-10.
    expect(dates.filter((d) => d < '2026-10-13')).toEqual([
      '2025-12-01',
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
      '2026-04-01',
      '2026-05-01',
      '2026-06-01',
      '2026-07-01',
      '2026-08-01',
      '2026-09-01',
      '2026-10-01',
    ])
    // 2025-11-01 is the 13th month back: gone.
    expect(dates).not.toContain('2025-11-01')
  })

  it('draws the 30-day line by time, to the millisecond', () => {
    const edge = new Date(NOW.getTime() - 30 * 86_400_000)
    const inside = b(new Date(edge.getTime() + 1).toISOString())
    const onLine = b(edge.toISOString())
    const newer = b(NOW.toISOString())
    // Both old ones fall in October 2026; the older one is the first of the month and stays for that reason.
    const list = [newer, inside, onLine]
    expect(backupsToPrune(list, NOW)).toEqual([])
    // A third backup the same month, just after the line: kept by age.
    // And one on the line that is not the month's first: pruned.
    const first = b('2026-10-01T00:00:00.000Z')
    expect(backupsToPrune([first, onLine, inside, newer], NOW)).toEqual([onLine.id])
  })

  it('takes the first backup of a month in UTC, at the month boundary', () => {
    // 2026-08-31 23:59:59.999 belongs to August; 2026-09-01 00:00 to September.
    const lastOfAugust = b('2026-08-31T23:59:59.999Z')
    const firstOfSeptember = b('2026-09-01T00:00:00.000Z')
    const secondOfSeptember = b('2026-09-01T00:00:00.001Z')
    const midAugust = b('2026-08-15T12:00:00.000Z')
    const newest = b('2026-11-11T08:05:00.000Z')
    const prunedIds = backupsToPrune([lastOfAugust, firstOfSeptember, secondOfSeptember, midAugust, newest], NOW)
    expect(prunedIds.sort()).toEqual([lastOfAugust.id, secondOfSeptember.id].sort())
  })

  it('counts the 12 months as this month and the 11 before it, across a year boundary', () => {
    const now = new Date('2027-01-05T00:00:00.000Z')
    const feb2026 = b('2026-02-03T00:00:00.000Z')
    const jan2026 = b('2026-01-03T00:00:00.000Z')
    const dec2025 = b('2025-12-03T00:00:00.000Z')
    const newest = b('2027-01-04T00:00:00.000Z')
    expect(backupsToPrune([feb2026, jan2026, dec2025, newest], now).sort()).toEqual([jan2026.id, dec2025.id].sort())
  })

  it('always keeps the newest backup of each wedding, however old', () => {
    // A quiet wedding, unchanged for two years: its one backup stays.
    const quiet = b('2024-06-01T08:00:00.000Z', { wedding: W2 })
    const olderQuiet = b('2024-05-01T08:00:00.000Z', { wedding: W2 })
    const busy = nightly(3)
    const pruned = backupsToPrune([quiet, olderQuiet, ...busy], NOW)
    expect(pruned).toEqual([olderQuiet.id])
  })

  it('keeps months per wedding, not across weddings', () => {
    const a = b('2026-05-01T08:00:00.000Z', { wedding: W1 })
    const bb = b('2026-05-02T08:00:00.000Z', { wedding: W2 })
    const a2 = b('2026-05-03T08:00:00.000Z', { wedding: W1 })
    const newestA = b('2026-11-10T08:00:00.000Z', { wedding: W1 })
    const newestB = b('2026-11-10T08:00:00.000Z', { wedding: W2 })
    expect(backupsToPrune([a, bb, a2, newestA, newestB], NOW)).toEqual([a2.id])
  })

  it('treats manual backups like nightly ones', () => {
    const firstManual = b('2026-06-01T10:00:00.000Z', { kind: 'manual' })
    const laterNightly = b('2026-06-02T08:00:00.000Z')
    const newest = b('2026-11-10T08:00:00.000Z', { kind: 'manual' })
    expect(backupsToPrune([firstManual, laterNightly, newest], NOW)).toEqual([laterNightly.id])
  })

  it('never prunes a final backup younger than 12 months, even when it is neither the first of its month nor the newest', () => {
    const nightlyFirst = b('2026-03-01T08:00:00.000Z', { wedding: W2 })
    const finalLater = b('2026-03-20T09:00:00.000Z', { wedding: W2, kind: 'final' })
    const nightlyAfter = b('2026-03-25T08:00:00.000Z', { wedding: W2 })
    expect(backupsToPrune([nightlyFirst, finalLater, nightlyAfter], NOW)).toEqual([])
    // The same nightly in its place would go.
    const nightlyInstead = b('2026-03-20T09:00:00.000Z', { wedding: W2 })
    expect(backupsToPrune([nightlyFirst, nightlyInstead, nightlyAfter], NOW)).toEqual([nightlyInstead.id])
  })

  it('lets a deleted wedding leave the store 12 months after its final backup', () => {
    const older = b('2025-09-01T08:00:00.000Z', { wedding: W2 })
    const finalOld = b('2025-10-15T09:00:00.000Z', { wedding: W2, kind: 'final' })
    // 2026-11-11 minus 12 months is 2025-11-11: the final is older, and it is the newest of its wedding.
    expect(backupsToPrune([older, finalOld], NOW).sort()).toEqual([older.id, finalOld.id].sort())
    // One day short of 12 months: kept.
    const finalYoung = b('2025-11-12T09:00:00.000Z', { wedding: W2, kind: 'final' })
    expect(backupsToPrune([older, finalYoung], NOW)).toEqual([older.id])
  })

  it('keeps the newest backup of a wedding brought back after it was deleted, even a final one over 12 months old', () => {
    // Deleted, its final backup made, then undeleted by an admin and left alone: every night finds it unchanged, so
    // the final backup stays its newest. While the wedding is live it is never let go.
    const older = b('2025-09-01T08:00:00.000Z', { wedding: W2 })
    const finalOld = b('2025-10-15T09:00:00.000Z', { wedding: W2, kind: 'final', live: true })
    expect(backupsToPrune([older, finalOld], NOW)).toEqual([older.id])
    // Deleted again (or a wedding that is gone altogether): it leaves the store as before.
    const stillDeleted = { ...finalOld, weddingLive: false }
    expect(backupsToPrune([older, stillDeleted], NOW).sort()).toEqual([older.id, finalOld.id].sort())
  })

  it('answers the same whatever order the list comes in, oldest first', () => {
    const list = [...nightly(400), ...nightly(90, W2)]
    const forward = backupsToPrune(list, NOW)
    const reversed = backupsToPrune([...list].reverse(), NOW)
    expect(reversed).toEqual(forward)
    const times = forward.map((id) => list.find((x) => x.id === id)!.createdAt.getTime())
    expect(times).toEqual([...times].sort((x, y) => x - y))
  })

  it('breaks a tie on time by id, so two backups at the same moment are handled the same every time', () => {
    const x = b('2026-04-01T00:00:00.000Z', { id: 'aaa' })
    const y = b('2026-04-01T00:00:00.000Z', { id: 'bbb' })
    const newest = b('2026-11-11T00:00:00.000Z', { id: 'zzz' })
    expect(backupsToPrune([y, x, newest], NOW)).toEqual(['bbb'])
    expect(backupsToPrune([x, y, newest], NOW)).toEqual(['bbb'])
  })

  it('keeps a bounded number of backups per wedding: at most 30 days plus 12 monthly plus the newest', () => {
    const list = nightly(1500)
    expect(kept(list).length).toBeLessThanOrEqual(30 + 12 + 1)
  })
})
