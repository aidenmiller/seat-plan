/**
 * Matches each imported row's partner name to a person (PLAN section 7):
 * rows in the same file first, then live guests already in the wedding, by
 * full name ignoring case and accents. A name that matches no one, or more
 * than one person, or a person who names someone else, goes to the
 * "Unmatched partners" list with a message, for a guest picker to fix.
 *
 * A partner name is looked up as written first (folded, the way a guest's
 * own "first last" folds, so "Dr. Jane Smith" finds the guest whose first
 * name is "Dr. Jane" and "Bob Smith, Jr" the one whose last name is "Smith,
 * Jr"), then read the way pasted names are ("Smith, Jane", "Mrs Jane Smith").
 */
import { foldName, fullNameKey, lookupKeyForFullName } from '../names'
import type { ImportRow } from './columns'

/** A live guest, as far as partner matching needs one. */
export type PartnerCandidate = { id: string; firstName: string; lastName: string; partnerId: string | null }

/**
 * A person: a row in the file, an existing guest, or both when the row
 * matched that guest. New rows have no guestId yet.
 */
export type PartnerRef = { rowNumber: number | null; guestId: string | null }

/**
 * - file: matched a row in the file (which may also be an existing guest)
 * - existing: matched a guest who is not in the file
 * - unmatched: no one has that name
 * - ambiguous: several people have that name
 * - one-sided: the person found names someone else, or is linked to someone else
 * - shared: someone else is linked to the same person by this import
 */
export type PartnerStatus = 'file' | 'existing' | 'unmatched' | 'ambiguous' | 'one-sided' | 'shared'

export type PartnerMatch = {
  rowNumber: number
  partnerName: string
  status: PartnerStatus
  /** The person found (file, existing, one-sided, shared). */
  partner: PartnerRef | null
  /** Everyone with that name (ambiguous). */
  candidates: PartnerRef[]
  /** Plain words for the unmatched list; null when matched. */
  message: string | null
  /** True when the partner came from a pick, not from the name. */
  picked: boolean
}

/** A choice from the guest picker: a person, or null for "no partner". */
export type PartnerPick = { rowNumber: number } | { guestId: string } | null

export const isPartnerProblem = (m: PartnerMatch) => m.status !== 'file' && m.status !== 'existing'

/** One id per person, whether found through the row or the guest. */
export const personId = (ref: PartnerRef) => (ref.guestId !== null ? `g:${ref.guestId}` : `r:${ref.rowNumber}`)

type PartnerRow = Pick<ImportRow, 'rowNumber' | 'firstName' | 'lastName' | 'partnerName'>

/**
 * @param rows the rows that will be applied (new and matched rows)
 * @param existingGuests every live guest in the wedding
 * @param rowGuestIds the guest each matched row stands for (rowNumber -> guest id)
 * @param picks guest picker choices by rowNumber, which win over the name
 */
export function matchPartners(
  rows: readonly PartnerRow[],
  existingGuests: readonly PartnerCandidate[],
  rowGuestIds: ReadonlyMap<number, string> = new Map(),
  picks: Readonly<Record<number, PartnerPick>> = {},
): PartnerMatch[] {
  const rowByNumber = new Map(rows.map((r) => [r.rowNumber, r]))
  const guestById = new Map(existingGuests.map((g) => [g.id, g]))
  const rowOfGuest = new Map<string, number>()
  for (const [rowNumber, guestId] of rowGuestIds) if (rowByNumber.has(rowNumber)) rowOfGuest.set(guestId, rowNumber)

  const fileIndex = new Map<string, number[]>()
  for (const r of rows) push(fileIndex, fullNameKey(r.firstName, r.lastName), r.rowNumber)
  const guestIndex = new Map<string, string[]>()
  for (const g of existingGuests) push(guestIndex, fullNameKey(g.firstName, g.lastName), g.id)

  const refOfRow = (n: number): PartnerRef => ({ rowNumber: n, guestId: rowGuestIds.get(n) ?? null })
  const refOfGuest = (id: string): PartnerRef => {
    const n = rowOfGuest.get(id)
    return n !== undefined ? refOfRow(n) : { rowNumber: null, guestId: id }
  }
  const same = (a: PartnerRef, b: PartnerRef) => personId(a) === personId(b)
  const nameOf = (ref: PartnerRef): string => {
    if (ref.rowNumber !== null) {
      const r = rowByNumber.get(ref.rowNumber)
      if (r) return `${r.firstName} ${r.lastName}`
    }
    const g = ref.guestId !== null ? guestById.get(ref.guestId) : undefined
    return g ? `${g.firstName} ${g.lastName}` : 'This guest'
  }
  const guestOf = (ref: PartnerRef) => (ref.guestId !== null ? guestById.get(ref.guestId) : undefined)

  // Pass 1: who each partner name can mean.
  type Found = { refs: PartnerRef[]; picked: boolean; invalidPick: boolean; namesSelf: boolean }
  const found = new Map<number, Found>()
  for (const row of rows) {
    const self = refOfRow(row.rowNumber)
    if (Object.prototype.hasOwnProperty.call(picks, row.rowNumber)) {
      const pick = picks[row.rowNumber]
      if (pick === null) continue
      let ref: PartnerRef | null = null
      if ('rowNumber' in pick && rowByNumber.has(pick.rowNumber)) ref = refOfRow(pick.rowNumber)
      if ('guestId' in pick && guestById.has(pick.guestId)) ref = refOfGuest(pick.guestId)
      const ok = ref !== null && !same(ref, self)
      found.set(row.rowNumber, { refs: ok ? [ref!] : [], picked: true, invalidPick: !ok, namesSelf: false })
      continue
    }
    if (!row.partnerName) continue
    const keys = partnerKeys(row.partnerName)
    const ownGuestId = rowGuestIds.get(row.rowNumber) ?? null

    // The partner they already have, when the name still fits, settles it.
    const current = ownGuestId ? guestById.get(ownGuestId)?.partnerId : null
    if (current && guestById.has(current)) {
      const ref = refOfGuest(current)
      const g = guestById.get(current)!
      const theirs = [fullNameKey(g.firstName, g.lastName)]
      const r = ref.rowNumber !== null ? rowByNumber.get(ref.rowNumber) : undefined
      if (r) theirs.push(fullNameKey(r.firstName, r.lastName))
      if (keys.some((k) => theirs.includes(k))) {
        found.set(row.rowNumber, { refs: [ref], picked: false, invalidPick: false, namesSelf: false })
        continue
      }
    }

    // Rows in the file first, then guests, under the name as written, then as read.
    let refs: PartnerRef[] = []
    for (const key of keys) {
      refs = (fileIndex.get(key) ?? []).filter((n) => n !== row.rowNumber).map(refOfRow)
      if (refs.length === 0) {
        for (const id of guestIndex.get(key) ?? []) {
          const ref = refOfGuest(id)
          if (!same(ref, self) && !refs.some((x) => same(x, ref))) refs.push(ref)
        }
      }
      if (refs.length > 0) break
    }
    const ownKey = fullNameKey(row.firstName, row.lastName)
    const namesSelf = refs.length === 0 && keys.includes(ownKey)
    found.set(row.rowNumber, { refs, picked: false, invalidPick: false, namesSelf })
  }

  // Pass 2: of several people with the name, the one who names this row back.
  const namesBack = (candidate: PartnerRef, row: PartnerRow): boolean => {
    const self = refOfRow(row.rowNumber)
    if (candidate.rowNumber !== null) {
      const back = found.get(candidate.rowNumber)
      return !!back && back.refs.some((r) => same(r, self))
    }
    const g = guestOf(candidate)
    return !!g && g.partnerId !== null && g.partnerId === self.guestId
  }
  for (const row of rows) {
    const f = found.get(row.rowNumber)
    if (!f || f.refs.length < 2) continue
    const back = f.refs.filter((c) => namesBack(c, row))
    if (back.length === 1) f.refs = back
  }

  // Pass 3: statuses, checking the person found does not belong to someone else.
  const results = new Map<number, PartnerMatch>()
  for (const row of rows) {
    const f = found.get(row.rowNumber)
    if (!f) continue
    const partnerName = row.partnerName ?? ''
    const base = { rowNumber: row.rowNumber, partnerName, picked: f.picked }
    if (f.refs.length === 0) {
      const message = f.invalidPick
        ? 'Pick another guest'
        : f.namesSelf
          ? 'This row names the same guest as partner'
          : `No guest is named ${partnerName}`
      results.set(row.rowNumber, { ...base, status: 'unmatched', partner: null, candidates: [], message })
      continue
    }
    if (f.refs.length > 1) {
      results.set(row.rowNumber, {
        ...base,
        status: 'ambiguous',
        partner: null,
        candidates: f.refs,
        message: `${f.refs.length} guests are named ${partnerName}`,
      })
      continue
    }
    const self = refOfRow(row.rowNumber)
    const t = f.refs[0]
    const status: PartnerStatus = t.rowNumber !== null ? 'file' : 'existing'
    let message: string | null = null
    if (!f.picked) {
      const tRow = t.rowNumber !== null ? rowByNumber.get(t.rowNumber) : undefined
      const tFound = t.rowNumber !== null ? found.get(t.rowNumber) : undefined
      const tGuest = guestOf(t)
      if (tRow && tFound && (tRow.partnerName || tFound.picked)) {
        if (!(tFound.refs.length === 1 && same(tFound.refs[0], self))) {
          message = tFound.picked
            ? `${nameOf(t)} has another partner picked`
            : `${nameOf(t)} names ${tRow.partnerName} as partner`
        }
      } else if (tGuest && tGuest.partnerId !== null && tGuest.partnerId !== self.guestId) {
        message = `${nameOf(t)} is already the partner of ${nameOf(refOfGuest(tGuest.partnerId))}`
      }
    }
    results.set(row.rowNumber, {
      ...base,
      status: message ? 'one-sided' : status,
      partner: t,
      candidates: [],
      message,
    })
  }

  // Pass 4: a person can have one partner. Two links to one person are both flagged.
  const links = new Map<string, { a: PartnerRef; b: PartnerRef; rows: number[] }>()
  for (const m of results.values()) {
    if (isPartnerProblem(m) || !m.partner) continue
    const self = refOfRow(m.rowNumber)
    const ids = [personId(self), personId(m.partner)].sort()
    const pairId = ids.join('+')
    const link = links.get(pairId)
    if (link) link.rows.push(m.rowNumber)
    else links.set(pairId, { a: self, b: m.partner, rows: [m.rowNumber] })
  }
  const linksByPerson = new Map<string, string[]>()
  for (const [pairId, link] of links) {
    push(linksByPerson, personId(link.a), pairId)
    push(linksByPerson, personId(link.b), pairId)
  }
  for (const [person, pairIds] of linksByPerson) {
    if (pairIds.length < 2) continue
    for (const pairId of pairIds) {
      const link = links.get(pairId)!
      const others = pairIds
        .filter((p) => p !== pairId)
        .flatMap((p) => links.get(p)!.rows)
        .sort((x, y) => x - y)
      const who = same(link.a, refFromId(person, link)) ? link.a : link.b
      for (const rowNumber of link.rows) {
        const m = results.get(rowNumber)!
        if (m.status === 'shared') continue
        results.set(rowNumber, {
          ...m,
          status: 'shared',
          message: `${nameOf(who)} is also named as partner on ${rowList(others)}`,
        })
      }
    }
  }

  return rows.flatMap((r) => {
    const m = results.get(r.rowNumber)
    return m ? [m] : []
  })
}

/**
 * The keys a partner cell is looked up under, in order: the name as written,
 * folded like fullNameKey ("Dr. Jane Smith" gives "dr jane smith"), then the
 * name read the way a pasted line is ("Smith, Jane" gives "jane smith").
 * Empty keys are left out.
 */
export function partnerKeys(partnerName: string): string[] {
  const keys: string[] = []
  for (const key of [foldName(partnerName), lookupKeyForFullName(partnerName)]) {
    if (key && !keys.includes(key)) keys.push(key)
  }
  return keys
}

function refFromId(id: string, link: { a: PartnerRef; b: PartnerRef }): PartnerRef {
  return personId(link.a) === id ? link.a : link.b
}

function rowList(rows: readonly number[]): string {
  const unique = [...new Set(rows)]
  if (unique.length === 1) return `row ${unique[0]}`
  return `rows ${unique.slice(0, -1).join(', ')} and ${unique[unique.length - 1]}`
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}
