/**
 * The re-import summary (spec section 6, PLAN change 10): which rows are new,
 * which change an existing guest (and how), which wait for a pick, who is in
 * the wedding but missing from the file, likely duplicates, groups to create
 * and partner links to set. Pure, so the server can build the same plan for
 * the preview and again inside the commit transaction.
 *
 * Rules:
 *  - a row matches on guest_id first, then on first and last name ignoring
 *    case and accents (nameKey);
 *  - a name that matches two or more guests, or a guest another row already
 *    matched, waits in needsReview and is never applied until picked;
 *  - a blank cell leaves the field as it was; names change only on a
 *    guest_id match (a name match means the names already agree);
 *  - text is compared in NFC, the form every write stores, so a guest
 *    saved before that rule never shows a change that is not one;
 *  - groups are only added, never taken away;
 *  - notes: on a guest_id match the notes cell holds the whole notes, as our
 *    export wrote them, so it replaces them; on a name match each line of
 *    the notes cell, and each "Header: value" line from extra columns, is
 *    added only when the notes do not already hold it;
 * so importing the same file twice gives zero new and zero changed.
 */
import { DUPLICATE_REASON_TEXT, findLikelyDuplicates, nameKey, type DuplicateReason } from '../names'
import { cleanNotes, cleanOneLine, type GuestRsvp, type GuestSide, type ImportRow } from './columns'
import {
  isPartnerProblem,
  matchPartners,
  personId,
  type PartnerMatch,
  type PartnerPick,
  type PartnerRef,
} from './partner-match'

/** A live guest as the plan needs one. Deleted guests are left out by the caller. */
export type ExistingGuest = {
  id: string
  firstName: string
  lastName: string
  nickname?: string | null
  partnerId: string | null
  household: string | null
  side: GuestSide
  rsvp: GuestRsvp
  meal: string | null
  isChild: boolean
  notes: string | null
  /** Names of the groups the guest is in. */
  groups: readonly string[]
}

/** A needs-review choice: the guest the row is, or "new" to add the row as a new guest. */
export type ReviewPick = string | 'new'

export type ImportOptions = {
  /** Every group in the wedding, empty ones too. Defaults to the groups the guests are in. */
  existingGroupNames?: readonly string[]
  /** Needs-review choices by rowNumber. */
  reviewPicks?: Readonly<Record<number, ReviewPick>>
  /** Unmatched-partner choices by rowNumber. */
  partnerPicks?: Readonly<Record<number, PartnerPick>>
}

export type GuestFields = {
  firstName: string
  lastName: string
  nickname: string | null
  household: string | null
  side: GuestSide
  rsvp: GuestRsvp
  meal: string | null
  isChild: boolean
  notes: string | null
}
export type GuestPatch = Partial<GuestFields>

export type ChangeField =
  | 'firstName'
  | 'lastName'
  | 'nickname'
  | 'household'
  | 'side'
  | 'rsvp'
  | 'meal'
  | 'isChild'
  | 'notes'
  | 'partner'
  | 'groups'

export const CHANGE_FIELD_LABELS: Record<ChangeField, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  nickname: 'Nickname',
  household: 'Household',
  side: 'Side',
  rsvp: 'RSVP',
  meal: 'Meal',
  isChild: 'Child',
  notes: 'Notes',
  partner: 'Partner',
  groups: 'Groups',
}

/** Before and after as display text ("" for none). */
export type FieldChange = { field: ChangeField; before: string; after: string }

export type MatchedBy = 'id' | 'name' | 'pick'

export type NewGuestPlan = {
  rowNumber: number
  guest: GuestFields
  /** Group names, spelled as the existing group when one matches. */
  groups: string[]
}

export type ChangedGuestPlan = {
  rowNumber: number
  guestId: string
  matchedBy: MatchedBy
  /** The guest's name as it is now. */
  name: string
  changes: FieldChange[]
  /** Only the fields that change. Partner changes are in partnerLinks. */
  patch: GuestPatch
  addGroups: string[]
}

export type UnchangedGuestPlan = { rowNumber: number; guestId: string; matchedBy: MatchedBy }

export type ReviewCandidate = {
  guestId: string
  firstName: string
  lastName: string
  household: string | null
  partnerName: string | null
  groups: string[]
}

export type ReviewItem = {
  rowNumber: number
  row: ImportRow
  message: string
  candidates: ReviewCandidate[]
}

export type MissingGuest = { guestId: string; firstName: string; lastName: string }

export type DuplicateFlag = {
  /** The new row. */
  rowNumber: number
  name: string
  /** The person it looks like: another new row, or an existing guest. */
  other: PartnerRef
  otherName: string
  reason: DuplicateReason
  /** "Close spelling: Jon Smith (already a guest)". */
  message: string
}

export type PartnerLinkPlan = { a: PartnerRef; b: PartnerRef; aName: string; bName: string }

export type ImportPlan = {
  newGuests: NewGuestPlan[]
  changed: ChangedGuestPlan[]
  unchanged: UnchangedGuestPlan[]
  needsReview: ReviewItem[]
  /** Live guests no row matched, sorted by last name. Removing them is a separate choice. */
  missing: MissingGuest[]
  duplicates: DuplicateFlag[]
  /** New groups, spelled as first written in the file. */
  groupsToCreate: string[]
  /** Links this import makes. Links that already exist are left out. */
  partnerLinks: PartnerLinkPlan[]
  /** Partner names to fix by hand: unmatched, ambiguous, one-sided or shared. */
  partnerProblems: PartnerMatch[]
  counts: { new: number; changed: number; unchanged: number; needsReview: number; missing: number }
}

type Resolution =
  | { kind: 'guest'; guestId: string; matchedBy: MatchedBy }
  | { kind: 'new' }
  | { kind: 'review'; message: string; candidates: string[] }

const fullName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`
/** Group names compare ignoring case, in NFC like the file. */
const lower = (s: string) => s.normalize('NFC').toLowerCase()

/** Lines of a notes text, cleaned, for "does it already hold this line". */
function noteLines(notes: string | null | undefined): string[] {
  if (!notes) return []
  return cleanNotes(notes)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

/** `base` plus each of `lines` it does not already hold, one per line. */
function appendLines(base: string, lines: readonly string[]): string {
  const have = new Set(noteLines(base))
  const out = base ? [base] : []
  for (const line of lines) {
    const clean = cleanOneLine(line)
    if (!clean || have.has(clean)) continue
    have.add(clean)
    out.push(clean)
  }
  return out.join('\n')
}

export function planImport(
  rows: readonly ImportRow[],
  existingGuests: readonly ExistingGuest[],
  options: ImportOptions = {},
): ImportPlan {
  const guestById = new Map(existingGuests.map((g) => [g.id, g]))
  const byKey = new Map<string, string[]>()
  for (const g of existingGuests) {
    const k = nameKey(g.firstName, g.lastName)
    const list = byKey.get(k)
    if (list) list.push(g.id)
    else byKey.set(k, [g.id])
  }

  // --- Match rows to guests ------------------------------------------------
  const resolution = new Map<number, Resolution>()
  const claimedBy = new Map<string, number>()
  const claim = (row: ImportRow, guestId: string, matchedBy: MatchedBy) => {
    claimedBy.set(guestId, row.rowNumber)
    resolution.set(row.rowNumber, { kind: 'guest', guestId, matchedBy })
  }

  for (const row of rows) {
    if (!row.guestId || !guestById.has(row.guestId)) continue
    const other = claimedBy.get(row.guestId)
    if (other !== undefined) {
      resolution.set(row.rowNumber, {
        kind: 'review',
        message: `Row ${other} has the same guest_id`,
        candidates: [row.guestId],
      })
    } else {
      claim(row, row.guestId, 'id')
    }
  }

  const picks = options.reviewPicks ?? {}
  for (const row of rows) {
    if (resolution.get(row.rowNumber)?.kind === 'guest') continue
    const pick = picks[row.rowNumber]
    if (pick === undefined) continue
    if (pick === 'new') {
      resolution.set(row.rowNumber, { kind: 'new' })
    } else if (guestById.has(pick)) {
      const other = claimedBy.get(pick)
      if (other === undefined) claim(row, pick, 'pick')
      else
        resolution.set(row.rowNumber, {
          kind: 'review',
          message: `Row ${other} is already matched to this guest`,
          candidates: [...new Set([pick, ...(byKey.get(nameKey(row.firstName, row.lastName)) ?? [])])],
        })
    }
  }

  const byName = rows.filter((r) => !resolution.has(r.rowNumber))
  const wanting = new Map<string, number[]>()
  for (const row of byName) {
    const candidates = byKey.get(nameKey(row.firstName, row.lastName)) ?? []
    if (candidates.length !== 1) continue
    const list = wanting.get(candidates[0])
    if (list) list.push(row.rowNumber)
    else wanting.set(candidates[0], [row.rowNumber])
  }
  for (const row of byName) {
    const candidates = byKey.get(nameKey(row.firstName, row.lastName)) ?? []
    if (candidates.length === 0) {
      resolution.set(row.rowNumber, { kind: 'new' })
    } else if (candidates.length > 1) {
      resolution.set(row.rowNumber, {
        kind: 'review',
        message: `${candidates.length} guests have this name`,
        candidates,
      })
    } else {
      const guestId = candidates[0]
      const other = claimedBy.get(guestId)
      const rivals = wanting.get(guestId)!.filter((n) => n !== row.rowNumber)
      if (other !== undefined) {
        resolution.set(row.rowNumber, {
          kind: 'review',
          message: `Row ${other} is already matched to this guest`,
          candidates,
        })
      } else if (rivals.length > 0) {
        resolution.set(row.rowNumber, {
          kind: 'review',
          message: `${rivals.length === 1 ? `Row ${rivals[0]}` : `Rows ${rivals.join(', ')}`} also ${rivals.length === 1 ? 'matches' : 'match'} this guest`,
          candidates,
        })
      } else {
        claim(row, guestId, 'name')
      }
    }
  }

  const applied = rows.filter((r) => resolution.get(r.rowNumber)?.kind !== 'review')
  const rowGuestIds = new Map<number, string>()
  for (const row of applied) {
    const r = resolution.get(row.rowNumber)!
    if (r.kind === 'guest') rowGuestIds.set(row.rowNumber, r.guestId)
  }
  const rowByNumber = new Map(rows.map((r) => [r.rowNumber, r]))

  // --- Partners -----------------------------------------------------------
  const partnerMatches = matchPartners(applied, existingGuests, rowGuestIds, options.partnerPicks ?? {})
  const refName = (ref: PartnerRef): string => {
    const row = ref.rowNumber !== null ? rowByNumber.get(ref.rowNumber) : undefined
    if (row) return fullName(row)
    const g = ref.guestId !== null ? guestById.get(ref.guestId) : undefined
    return g ? fullName(g) : ''
  }
  const partnerLinks: PartnerLinkPlan[] = []
  /** person id -> the person they will be linked to by this import. */
  const linkedTo = new Map<string, PartnerRef>()
  const seenPairs = new Set<string>()
  for (const m of partnerMatches) {
    if (isPartnerProblem(m) || !m.partner) continue
    const a: PartnerRef = { rowNumber: m.rowNumber, guestId: rowGuestIds.get(m.rowNumber) ?? null }
    const b = m.partner
    const pair = [personId(a), personId(b)].sort().join('+')
    if (seenPairs.has(pair)) continue
    seenPairs.add(pair)
    linkedTo.set(personId(a), b)
    linkedTo.set(personId(b), a)
    const already = a.guestId !== null && b.guestId !== null && guestById.get(a.guestId)?.partnerId === b.guestId
    if (!already) partnerLinks.push({ a, b, aName: refName(a), bName: refName(b) })
  }
  const linkedPairs = new Set(seenPairs)

  // --- Groups -------------------------------------------------------------
  const groupNames = options.existingGroupNames ?? existingGuests.flatMap((g) => g.groups)
  const canonical = new Map<string, string>()
  for (const name of groupNames) if (!canonical.has(lower(name))) canonical.set(lower(name), name)
  const groupsToCreate: string[] = []
  const resolveGroup = (name: string): string => {
    const found = canonical.get(lower(name))
    if (found) return found
    canonical.set(lower(name), name)
    groupsToCreate.push(name)
    return name
  }
  const resolveGroups = (names: readonly string[]): string[] => {
    const out: string[] = []
    for (const name of names) {
      const g = resolveGroup(name)
      if (!out.some((x) => lower(x) === lower(g))) out.push(g)
    }
    return out
  }

  // --- New and matched rows -----------------------------------------------
  const newGuests: NewGuestPlan[] = []
  const changed: ChangedGuestPlan[] = []
  const unchanged: UnchangedGuestPlan[] = []
  for (const row of applied) {
    const r = resolution.get(row.rowNumber)!
    if (r.kind === 'new') {
      const base = row.notes ?? ''
      const notes = appendLines(base, row.extraNotes)
      newGuests.push({
        rowNumber: row.rowNumber,
        guest: {
          firstName: row.firstName,
          lastName: row.lastName,
          nickname: row.nickname ?? null,
          household: row.household ?? null,
          side: row.side ?? 'Both',
          rsvp: row.rsvp ?? 'pending',
          meal: row.meal ?? null,
          isChild: row.isChild ?? false,
          notes: notes || null,
        },
        groups: resolveGroups(row.groups),
      })
      continue
    }
    if (r.kind !== 'guest') continue
    const g = guestById.get(r.guestId)!
    const changes: FieldChange[] = []
    const patch: GuestPatch = {}

    if (r.matchedBy === 'id') {
      if (row.firstName !== cleanOneLine(g.firstName)) {
        changes.push({ field: 'firstName', before: g.firstName, after: row.firstName })
        patch.firstName = row.firstName
      }
      if (row.lastName !== cleanOneLine(g.lastName)) {
        changes.push({ field: 'lastName', before: g.lastName, after: row.lastName })
        patch.lastName = row.lastName
      }
    }
    for (const field of ['nickname', 'household', 'meal'] as const) {
      const value = row[field]
      const before = g[field] ?? ''
      if (value !== undefined && value !== cleanOneLine(before)) {
        changes.push({ field, before, after: value })
        patch[field] = value
      }
    }
    if (row.side !== undefined && row.side !== g.side) {
      changes.push({ field: 'side', before: g.side, after: row.side })
      patch.side = row.side
    }
    if (row.rsvp !== undefined && row.rsvp !== g.rsvp) {
      changes.push({ field: 'rsvp', before: g.rsvp, after: row.rsvp })
      patch.rsvp = row.rsvp
    }
    if (row.isChild !== undefined && row.isChild !== g.isChild) {
      changes.push({ field: 'isChild', before: g.isChild ? 'Yes' : 'No', after: row.isChild ? 'Yes' : 'No' })
      patch.isChild = row.isChild
    }

    const notesBefore = g.notes ?? ''
    const notesBase =
      r.matchedBy === 'id' && row.notes !== undefined
        ? cleanNotes(notesBefore) === row.notes
          ? notesBefore
          : row.notes
        : notesBefore
    const notesAfter =
      r.matchedBy === 'id'
        ? appendLines(notesBase, row.extraNotes)
        : appendLines(notesBase, [...(row.notes ? row.notes.split('\n') : []), ...row.extraNotes])
    if (notesAfter !== notesBefore) {
      changes.push({ field: 'notes', before: notesBefore, after: notesAfter })
      patch.notes = notesAfter || null
    }

    const link = linkedTo.get(personId({ rowNumber: row.rowNumber, guestId: g.id }))
    if (link && link.guestId !== g.partnerId) {
      const current = g.partnerId ? guestById.get(g.partnerId) : undefined
      changes.push({ field: 'partner', before: current ? fullName(current) : '', after: refName(link) })
    }

    const have = new Set(g.groups.map(lower))
    const addGroups = resolveGroups(row.groups).filter((name) => !have.has(lower(name)))
    if (addGroups.length > 0) {
      changes.push({ field: 'groups', before: g.groups.join('; '), after: [...g.groups, ...addGroups].join('; ') })
    }

    if (changes.length > 0) {
      changed.push({
        rowNumber: row.rowNumber,
        guestId: g.id,
        matchedBy: r.matchedBy,
        name: fullName(g),
        changes,
        patch,
        addGroups,
      })
    } else {
      unchanged.push({ rowNumber: row.rowNumber, guestId: g.id, matchedBy: r.matchedBy })
    }
  }

  // --- Needs review and missing ---------------------------------------------
  const needsReview: ReviewItem[] = []
  const underReview = new Set<string>()
  for (const row of rows) {
    const r = resolution.get(row.rowNumber)
    if (r?.kind !== 'review') continue
    for (const id of r.candidates) underReview.add(id)
    needsReview.push({
      rowNumber: row.rowNumber,
      row,
      message: r.message,
      candidates: r.candidates.map((id) => {
        const g = guestById.get(id)!
        const partner = g.partnerId ? guestById.get(g.partnerId) : undefined
        return {
          guestId: g.id,
          firstName: g.firstName,
          lastName: g.lastName,
          household: g.household,
          partnerName: partner ? fullName(partner) : null,
          groups: [...g.groups],
        }
      }),
    })
  }
  const missing: MissingGuest[] = existingGuests
    .filter((g) => !claimedBy.has(g.id) && !underReview.has(g.id))
    .map((g) => ({ guestId: g.id, firstName: g.firstName, lastName: g.lastName }))
    .sort(
      (a, b) =>
        a.lastName.localeCompare(b.lastName, 'en', { sensitivity: 'base' }) ||
        a.firstName.localeCompare(b.firstName, 'en', { sensitivity: 'base' }),
    )

  // --- Likely duplicates among new rows, and between new rows and guests ----
  const newRowNumbers = new Set(newGuests.map((n) => n.rowNumber))
  const people = [
    ...newGuests.map((n) => ({
      key: `r:${n.rowNumber}`,
      firstName: n.guest.firstName,
      lastName: n.guest.lastName,
      nickname: n.guest.nickname,
    })),
    ...existingGuests.map((g) => ({ key: `g:${g.id}`, firstName: g.firstName, lastName: g.lastName, nickname: g.nickname })),
  ]
  const refOfKey = (key: string): PartnerRef =>
    key.startsWith('r:')
      ? { rowNumber: Number(key.slice(2)), guestId: null }
      : { rowNumber: claimedBy.get(key.slice(2)) ?? null, guestId: key.slice(2) }
  const duplicates: DuplicateFlag[] = []
  for (const pair of findLikelyDuplicates(people, (key) => key.startsWith('r:'))) {
    let [mine, theirs] = [refOfKey(pair.a), refOfKey(pair.b)]
    if (mine.guestId !== null || (theirs.guestId === null && theirs.rowNumber! > mine.rowNumber!)) {
      ;[mine, theirs] = [theirs, mine]
    }
    if (mine.rowNumber === null || !newRowNumbers.has(mine.rowNumber)) continue
    if (linkedPairs.has([personId(mine), personId(theirs)].sort().join('+'))) continue
    const otherGuest = theirs.guestId !== null ? guestById.get(theirs.guestId) : undefined
    if (otherGuest && otherGuest.partnerId !== null && otherGuest.partnerId === mine.guestId) continue
    const name = refName(mine)
    const otherName = otherGuest ? fullName(otherGuest) : refName(theirs)
    const where = theirs.guestId !== null ? 'already a guest' : `row ${theirs.rowNumber}`
    duplicates.push({
      rowNumber: mine.rowNumber,
      name,
      other: theirs,
      otherName,
      reason: pair.reason,
      message: `${DUPLICATE_REASON_TEXT[pair.reason]}: ${otherName} (${where})`,
    })
  }
  duplicates.sort((a, b) => a.rowNumber - b.rowNumber || (a.other.rowNumber ?? 0) - (b.other.rowNumber ?? 0))

  return {
    newGuests,
    changed,
    unchanged,
    needsReview,
    missing,
    duplicates,
    groupsToCreate,
    partnerLinks,
    partnerProblems: partnerMatches.filter(isPartnerProblem),
    counts: {
      new: newGuests.length,
      changed: changed.length,
      unchanged: unchanged.length,
      needsReview: needsReview.length,
      missing: missing.length,
    },
  }
}
