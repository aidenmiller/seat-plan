/**
 * The column matching step: which CSV column fills which guest field, a
 * guess from the header names, and turning parsed rows into ImportRows with
 * every value normalised (side, RSVP, child, groups). Sides are read with
 * the wedding's own partner names. Unknown columns go into notes as
 * "Header: value" lines (DECISIONS 24).
 */
import { wellFormedText } from '../canvas-schema'
import { foldName } from '../names'
import { sideKey, sideLabel, sideWordMap, type GuestSide, type PartnerNames } from '../partners'

export type GuestRsvp = 'yes' | 'no' | 'pending'

/** The sample file's columns, in the spec's order. */
export const SAMPLE_COLUMNS = [
  'first_name',
  'last_name',
  'partner',
  'household',
  'side',
  'groups',
  'rsvp',
  'meal',
  'child',
  'notes',
] as const

/** Our export adds this one, so a re-import can match on it first (PLAN change 10). */
export const GUEST_ID_COLUMN = 'guest_id'
/** Our export also writes the nickname, after guest_id, so the sample's columns stay as the spec gives them (DECISIONS 70). */
export const NICKNAME_COLUMN = 'nickname'

export type ImportField = (typeof SAMPLE_COLUMNS)[number] | typeof GUEST_ID_COLUMN | typeof NICKNAME_COLUMN
export type ColumnTarget = ImportField | 'add_to_notes' | 'ignore'
/** Header -> what its values fill. */
export type ColumnMapping = Record<string, ColumnTarget>

/** Every choice for a column, in the order a picker lists them, with its label. */
export const COLUMN_TARGETS: readonly { target: ColumnTarget; label: string }[] = [
  { target: 'first_name', label: 'First name' },
  { target: 'last_name', label: 'Last name' },
  { target: 'nickname', label: 'Nickname' },
  { target: 'partner', label: 'Partner' },
  { target: 'household', label: 'Household' },
  { target: 'side', label: 'Side' },
  { target: 'groups', label: 'Groups' },
  { target: 'rsvp', label: 'RSVP' },
  { target: 'meal', label: 'Meal' },
  { target: 'child', label: 'Child' },
  { target: 'notes', label: 'Notes' },
  { target: 'guest_id', label: 'Guest ID' },
  { target: 'add_to_notes', label: 'Add to notes' },
  { target: 'ignore', label: 'Ignore' },
]

export const COLUMN_TARGET_LABELS = Object.fromEntries(COLUMN_TARGETS.map((t) => [t.target, t.label])) as Record<
  ColumnTarget,
  string
>

// ---------------------------------------------------------------------------
// Guessing

/** Header names, folded and with punctuation as spaces, that mean each field. Earlier entries win ties. */
const SYNONYMS: Record<ImportField, readonly string[]> = {
  first_name: ['first name', 'firstname', 'first', 'given name', 'given names', 'given', 'forename', 'fname'],
  last_name: ['last name', 'lastname', 'last', 'surname', 'family name', 'lname'],
  nickname: ['nickname', 'nick name', 'nicknames', 'nick', 'preferred name', 'goes by', 'known as', 'called'],
  partner: [
    'partner',
    'partner name',
    'spouse',
    'spouse name',
    'plus one',
    'plus one name',
    'plus 1',
    '+1',
    'partner full name',
    'significant other',
  ],
  household: ['household', 'family', 'household name', 'party'],
  side: ['side', 'bride or groom', 'groom or bride', 'bride groom', 'groom bride', 'whose side', 'guest of'],
  groups: ['groups', 'group', 'tags', 'tag', 'categories', 'category'],
  rsvp: ['rsvp', 'rsvp status', 'attending', 'attendance', 'response', 'will attend', 'coming'],
  meal: ['meal', 'entree', 'dinner choice', 'meal choice', 'meal selection', 'dinner', 'menu', 'main course', 'food'],
  child: ['child', 'kid', 'is child', 'children', 'kids', 'age group', 'child or adult', 'adult or child'],
  notes: ['notes', 'note', 'comments', 'comment', 'remarks', 'dietary', 'dietary needs', 'dietary restrictions', 'allergies'],
  guest_id: ['guest id', 'guestid'],
}

/** Looser matches for headers such as "Guest First Name", tried when no synonym fits exactly. */
const PATTERNS: readonly [RegExp, ImportField][] = [
  [/\bguest ?id\b/, 'guest_id'],
  [/\b(nick ?names?|preferred (first )?names?|goes by|known as)\b/, 'nickname'],
  [/\b(first|given|fore) ?names?\b/, 'first_name'],
  [/\b(last|sur|family) ?names?\b/, 'last_name'],
  [/\b(partner|spouse|plus one|plus 1|\+ ?1)\b/, 'partner'],
  [/\b(household|family)\b/, 'household'],
  [/\bside\b/, 'side'],
  [/\b(groups?|tags?)\b/, 'groups'],
  [/\b(rsvp|attending|attendance)\b/, 'rsvp'],
  [/\b(meal|entree|dinner|menu)\b/, 'meal'],
  [/\b(child|kids?|age group)\b/, 'child'],
  [/\b(notes?|comments?|dietary|allerg\w*)\b/, 'notes'],
]

const PATTERN_RANK = 100

/** "First_Name", "first-name", "First Name (required)" -> "first name". */
export function normaliseHeader(header: string): string {
  return foldName(header.replace(/\s*\(\d+\)$/, '').replace(/\([^)]*\)/g, ' '))
    .replace(/[^a-z0-9+]+/g, ' ')
    .trim()
}

function guessOne(header: string): { field: ImportField; rank: number } | null {
  const h = normaliseHeader(header)
  if (!h) return null
  for (const [field, names] of Object.entries(SYNONYMS) as [ImportField, readonly string[]][]) {
    const rank = names.indexOf(h)
    if (rank >= 0) return { field, rank }
  }
  // "Partner first name" is half a partner, not the guest's first name.
  const partnerish = /\b(partner|spouse|plus one|plus 1)\b/.test(h)
  for (const [re, field] of PATTERNS) {
    if (!re.test(h)) continue
    if (partnerish && (field === 'first_name' || field === 'last_name' || field === 'nickname')) return null
    return { field, rank: PATTERN_RANK }
  }
  return null
}

/**
 * A first guess for each column from its header. Each field goes to at most
 * one column, the closest match (leftmost on a tie); other columns, and
 * columns nobody recognises, default to "Add to notes".
 */
export function guessMapping(headers: readonly string[]): ColumnMapping {
  const guesses = headers.map((h, index) => ({ h, index, guess: guessOne(h) }))
  const mapping: ColumnMapping = {}
  for (const h of headers) mapping[h] = 'add_to_notes'
  const taken = new Set<ImportField>()
  const ordered = guesses
    .filter((g) => g.guess !== null)
    .sort((a, b) => a.guess!.rank - b.guess!.rank || a.index - b.index)
  for (const g of ordered) {
    const field = g.guess!.field
    if (taken.has(field)) continue
    taken.add(field)
    mapping[g.h] = field
  }
  return mapping
}

/**
 * What stops the import with this mapping: first and last name each need a
 * column, and every field but Notes fits one column only.
 */
export function mappingProblems(mapping: ColumnMapping): string[] {
  const counts = new Map<ColumnTarget, number>()
  for (const target of Object.values(mapping)) counts.set(target, (counts.get(target) ?? 0) + 1)
  const problems: string[] = []
  if (!counts.has('first_name')) problems.push('Pick the column for First name')
  if (!counts.has('last_name')) problems.push('Pick the column for Last name')
  for (const { target, label } of COLUMN_TARGETS) {
    if (target === 'notes' || target === 'add_to_notes' || target === 'ignore') continue
    if ((counts.get(target) ?? 0) > 1) problems.push(`${label} is picked for more than one column`)
  }
  return problems
}

// ---------------------------------------------------------------------------
// Values

export type Normalised<T> = { value: T | undefined; understood: boolean }

const word = (value: string) => foldName(value).replace(/[^a-z0-9?' ]+/g, ' ').replace(/\s+/g, ' ').trim()

function sideFrom(raw: string, words: ReadonlyMap<string, GuestSide>): Normalised<GuestSide> {
  if (!raw.trim()) return { value: undefined, understood: true }
  const side = words.get(sideKey(raw))
  return side ? { value: side, understood: true } : { value: 'both', understood: false }
}

/**
 * Partner 1, partner 2 or both, by the wedding's names ("Sam", "Sam's
 * side", "Partner 1", "Both"; see sideWordMap). "Bride" and "groom" cannot
 * say which of the two is meant, so they, a first name both partners share,
 * and anything else unrecognised become both, reported as not understood.
 * Blank is undefined.
 */
export function normaliseSide(raw: string, partners: PartnerNames): Normalised<GuestSide> {
  return sideFrom(raw, sideWordMap(partners))
}

const RSVP_WORDS: Record<string, GuestRsvp> = {
  yes: 'yes',
  y: 'yes',
  attending: 'yes',
  accepted: 'yes',
  accepts: 'yes',
  accept: 'yes',
  '1': 'yes',
  true: 'yes',
  coming: 'yes',
  confirmed: 'yes',
  'will attend': 'yes',
  going: 'yes',
  no: 'no',
  n: 'no',
  declined: 'no',
  declines: 'no',
  decline: 'no',
  regrets: 'no',
  regret: 'no',
  '0': 'no',
  false: 'no',
  'not attending': 'no',
  'not coming': 'no',
  "can't come": 'no',
  'cant come': 'no',
  'will not attend': 'no',
  pending: 'pending',
  maybe: 'pending',
  'no response': 'pending',
  'no reply': 'pending',
  awaiting: 'pending',
  'awaiting reply': 'pending',
  'not yet': 'pending',
  invited: 'pending',
  unknown: 'pending',
  tbd: 'pending',
  '?': 'pending',
}

/** yes, no or pending. Blank and anything unrecognised are undefined; unrecognised is reported. */
export function normaliseRsvp(raw: string): Normalised<GuestRsvp> {
  if (!raw.trim()) return { value: undefined, understood: true }
  const rsvp = RSVP_WORDS[word(raw)]
  return rsvp ? { value: rsvp, understood: true } : { value: undefined, understood: false }
}

const CHILD_YES = new Set(['yes', 'y', 'true', '1', 'child', 'kid', 'x', 'infant', 'baby', 'toddler'])
const CHILD_NO = new Set(['no', 'n', 'false', '0', 'adult'])

/** true for yes/y/true/1/child/kid/x, false for no/n/false/0/adult, else undefined. */
export function normaliseChild(raw: string): Normalised<boolean> {
  const trimmed = raw.trim()
  if (!trimmed) return { value: undefined, understood: true }
  if (trimmed === '✓' || trimmed === '✔') return { value: true, understood: true }
  const w = word(raw)
  if (CHILD_YES.has(w)) return { value: true, understood: true }
  if (CHILD_NO.has(w)) return { value: false, understood: true }
  return { value: undefined, understood: false }
}

/** Group names split on ";" (or on "," when the cell has no ";"), trimmed, repeats removed ignoring case. */
export function splitGroups(raw: string): string[] {
  const parts = raw.includes(';') ? raw.split(';') : raw.split(',')
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of parts) {
    const name = cleanOneLine(part)
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    out.push(name)
  }
  return out
}

/**
 * Cells our export guards with one more apostrophe: a formula start (= + -
 * @ tab or CR), after any apostrophes the value holds itself, so "'=x" is
 * written "''=x" and every value round-trips exactly.
 */
export const GUARDED_CELL_RE = /^'*[=+\-@\t\r]/

/** Removes the one apostrophe our export puts before a guarded cell (GUARDED_CELL_RE). */
export function unguardCell(value: string): string {
  return value.startsWith("'") && GUARDED_CELL_RE.test(value.slice(1)) ? value.slice(1) : value
}

/**
 * Text Postgres can store, in NFC: "Zoë" typed as e plus a combining mark
 * (pasted from a macOS PDF, say) is stored as the one letter ë, the way an
 * uploaded file is read (decodeCsvBytes), so a re-import compares like with
 * like. Every guest, group and import text field goes through this.
 */
function storableText(value: string): string {
  return wellFormedText(value).normalize('NFC')
}

/** A single-line value: text Postgres can store, in NFC, spaces collapsed, trimmed. */
export function cleanOneLine(value: string): string {
  return storableText(value).replace(/\s+/g, ' ').trim()
}

/** Notes: text Postgres can store, in NFC, LF line ends, each line's spaces collapsed, at most one blank line in a row. */
export function cleanNotes(value: string): string {
  return storableText(value)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ---------------------------------------------------------------------------
// Rows

export type ImportRow = {
  /** The spreadsheet row number, for messages ("Row 4"). Unique within one file. */
  rowNumber: number
  /** From our own export's guest_id column, lower case. */
  guestId?: string
  firstName: string
  lastName: string
  nickname?: string
  /** The partner's full name as written. */
  partnerName?: string
  household?: string
  side?: GuestSide
  rsvp?: GuestRsvp
  meal?: string
  isChild?: boolean
  notes?: string
  groups: string[]
  /** Values of "Add to notes" columns, as "Header: value" lines. */
  extraNotes: string[]
}

export type RowIssue = { rowNumber: number; field: ImportField | null; message: string }

export type MappedRows = {
  /** Rows with a first and last name. Blank cells are undefined, so they leave a field as it was. */
  rows: ImportRow[]
  /** Rows left out, with why. */
  errors: RowIssue[]
  /** Values not understood. The row is still imported. */
  warnings: RowIssue[]
}

/**
 * Applies a mapping to parsed rows. Side cells are read with the wedding's
 * partner names. `rowNumbers` gives each row's spreadsheet row number
 * (parseCsv returns them); without it, rows count from 2.
 */
export function applyMapping(
  rows: readonly Record<string, string>[],
  mapping: ColumnMapping,
  partners: PartnerNames,
  rowNumbers?: readonly number[],
): MappedRows {
  const columns = Object.entries(mapping).filter(
    (entry): entry is [string, Exclude<ColumnTarget, 'ignore'>] => entry[1] !== 'ignore',
  )
  const sideWords = sideWordMap(partners)
  const sideChoices = `${sideLabel(partners, 'partner1')}, ${sideLabel(partners, 'partner2')} or ${sideLabel(partners, 'both')}`
  const out: ImportRow[] = []
  const errors: RowIssue[] = []
  const warnings: RowIssue[] = []

  rows.forEach((record, index) => {
    const rowNumber = rowNumbers?.[index] ?? index + 2
    const values = new Map<ImportField, string>()
    const notes: string[] = []
    const extraNotes: string[] = []
    for (const [header, target] of columns) {
      const raw = unguardCell(record[header] ?? '').trim()
      if (!raw) continue
      if (target === 'add_to_notes') {
        const text = cleanOneLine(raw)
        if (text) extraNotes.push(`${cleanOneLine(header)}: ${text}`)
      } else if (target === 'notes') {
        const text = cleanNotes(raw)
        if (text) notes.push(text)
      } else if (!values.has(target)) {
        values.set(target, raw)
      }
    }

    const firstName = cleanOneLine(values.get('first_name') ?? '')
    const lastName = cleanOneLine(values.get('last_name') ?? '')
    if (!firstName || !lastName) {
      const message =
        !firstName && !lastName ? 'Needs a first and last name' : !firstName ? 'Needs a first name' : 'Needs a last name'
      errors.push({ rowNumber, field: !firstName ? 'first_name' : 'last_name', message })
      return
    }

    const row: ImportRow = { rowNumber, firstName, lastName, groups: [], extraNotes }
    const warn = (field: ImportField, message: string) => warnings.push({ rowNumber, field, message })

    const guestId = values.get('guest_id')
    if (guestId !== undefined) {
      if (UUID_RE.test(guestId)) row.guestId = guestId.toLowerCase()
      else warn('guest_id', `Guest ID "${cleanOneLine(guestId)}" is not one of ours, so this row is matched by name`)
    }
    const nickname = cleanOneLine(values.get('nickname') ?? '')
    if (nickname) row.nickname = nickname
    const partner = cleanOneLine(values.get('partner') ?? '')
    if (partner) row.partnerName = partner
    const household = cleanOneLine(values.get('household') ?? '')
    if (household) row.household = household
    const meal = cleanOneLine(values.get('meal') ?? '')
    if (meal) row.meal = meal

    const sideRaw = values.get('side')
    if (sideRaw !== undefined) {
      const side = sideFrom(sideRaw, sideWords)
      if (side.value !== undefined) row.side = side.value
      if (!side.understood) warn('side', `Side "${cleanOneLine(sideRaw)}" is not ${sideChoices}, so it is set to Both`)
    }
    const rsvpRaw = values.get('rsvp')
    if (rsvpRaw !== undefined) {
      const rsvp = normaliseRsvp(rsvpRaw)
      if (rsvp.value !== undefined) row.rsvp = rsvp.value
      if (!rsvp.understood) warn('rsvp', `RSVP "${cleanOneLine(rsvpRaw)}" is not yes, no or pending, so it is left out`)
    }
    const childRaw = values.get('child')
    if (childRaw !== undefined) {
      const child = normaliseChild(childRaw)
      if (child.value !== undefined) row.isChild = child.value
      if (!child.understood) warn('child', `Child "${cleanOneLine(childRaw)}" is not yes or no, so it is left out`)
    }
    const groupsRaw = values.get('groups')
    if (groupsRaw !== undefined) row.groups = splitGroups(groupsRaw)
    if (notes.length > 0) row.notes = notes.join('\n')
    out.push(row)
  })

  return { rows: out, errors, warnings }
}
