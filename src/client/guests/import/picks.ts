/**
 * The import review's choices, as the selects hold them and as the preview
 * and commit bodies send them (row numbers become JSON object keys).
 */
import type { ImportRow } from '@/domain/csv/columns'
import type { PartnerPick } from '@/domain/csv/partner-match'
import type { GuestSeatPlace } from '@/shared/api'

/** A needs-review choice: a guest id, or 'new'. */
export type ReviewChoice = string

/**
 * Every choice made on the review step. The wizard keeps them, so going back
 * to fix a column match does not throw them away.
 */
export type ImportPicks = {
  reviewPicks: ReadonlyMap<number, ReviewChoice | undefined>
  partnerPicks: ReadonlyMap<number, PartnerPick | undefined>
  removeMissing: boolean
}

export const NO_PICKS: ImportPicks = { reviewPicks: new Map(), partnerPicks: new Map(), removeMissing: false }

type RowLike = Pick<ImportRow, 'rowNumber' | 'guestId' | 'firstName' | 'lastName' | 'partnerName'>

/** Who a row is: what the server matches it on. */
const who = (r: RowLike) => JSON.stringify([r.guestId ?? null, r.firstName, r.lastName])
/** Who a row is and the partner it names. */
const whoAndPartner = (r: RowLike) => JSON.stringify([r.guestId ?? null, r.firstName, r.lastName, r.partnerName ?? null])

/**
 * The picks made against `before`, carried over to `after` (the same file
 * read with other column matches). A pick stays only while its row still
 * reads the same, so a pick never lands on a row that now holds someone
 * else; a partner pick of another row also needs that row unchanged.
 */
export function keepPicks(picks: ImportPicks, before: readonly RowLike[], after: readonly RowLike[]): ImportPicks {
  const old = new Map(before.map((r) => [r.rowNumber, r]))
  const now = new Map(after.map((r) => [r.rowNumber, r]))
  const same = (n: number, key: (r: RowLike) => string) => {
    const a = old.get(n)
    const b = now.get(n)
    return a !== undefined && b !== undefined && key(a) === key(b)
  }
  const reviewPicks = new Map<number, ReviewChoice | undefined>()
  for (const [n, pick] of picks.reviewPicks) if (pick !== undefined && same(n, who)) reviewPicks.set(n, pick)
  const partnerPicks = new Map<number, PartnerPick | undefined>()
  for (const [n, pick] of picks.partnerPicks) {
    if (pick === undefined || !same(n, whoAndPartner)) continue
    if (pick !== null && 'rowNumber' in pick && !same(pick.rowNumber, who)) continue
    partnerPicks.set(n, pick)
  }
  return { reviewPicks, partnerPicks, removeMissing: picks.removeMissing }
}

/** '' (no choice yet), 'none' (leave unlinked), 'r:<row>' (a row of the file) or 'g:<guest id>'. */
export function encodePartnerPick(pick: PartnerPick | undefined): string {
  if (pick === undefined) return ''
  if (pick === null) return 'none'
  return 'rowNumber' in pick ? `r:${pick.rowNumber}` : `g:${pick.guestId}`
}

export function decodePartnerPick(value: string): PartnerPick | undefined {
  if (value === '') return undefined
  if (value === 'none') return null
  if (value.startsWith('r:')) {
    const n = Number(value.slice(2))
    return Number.isInteger(n) && n > 0 ? { rowNumber: n } : undefined
  }
  if (value.startsWith('g:')) return { guestId: value.slice(2) }
  return undefined
}

/** { 4: x } as the body's { "4": x }, leaving out rows with no choice. */
export function picksBody<T>(picks: ReadonlyMap<number, T | undefined>): Record<string, T> {
  const out: Record<string, T> = {}
  for (const [row, pick] of picks) if (pick !== undefined) out[String(row)] = pick
  return out
}

/**
 * What removing the missing guests touches, one line per layout:
 * "Reception plan: Table 3 (Ann Lee), Table 5 (Bob Ray)".
 */
export function missingSeatLines(seats: readonly GuestSeatPlace[], nameOf: (guestId: string) => string): string[] {
  const byLayout = new Map<string, { name: string; parts: string[] }>()
  for (const s of seats) {
    const entry = byLayout.get(s.layoutId) ?? { name: s.layoutName, parts: [] }
    entry.parts.push(`${s.itemLabel} (${nameOf(s.guestId)})`)
    byLayout.set(s.layoutId, entry)
  }
  return [...byLayout.values()].map((e) => `${e.name}: ${e.parts.join(', ')}`)
}
