/**
 * Guest names: the folded form used for matching (and stored as
 * guests.name_key), close-spelling checks for likely duplicates, splitting a
 * pasted line into first and last name (DECISIONS 25), and initials.
 * Pure: the browser and the server use the same rules.
 */
import { wellFormedText } from './canvas-schema'

// ---------------------------------------------------------------------------
// Folding

/** Letters that NFKD leaves whole, spelled the way an English keyboard would type them. */
const LETTER_MAP: Record<string, string> = {
  ł: 'l',
  ø: 'o',
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ı: 'i',
  ħ: 'h',
  ŀ: 'l',
}
const LETTER_RE = new RegExp(`[${Object.keys(LETTER_MAP).join('')}]`, 'g')
/** Curly quotes, primes, the modifier letter apostrophe, grave and acute accents typed as apostrophes. */
const APOSTROPHES_RE = /[‘’‚‛ʼʹʻ′`´＇]/g
/** Hyphens and dashes. "Mary-Jane" and "Mary Jane" fold the same. */
const DASHES_RE = /[-‐-―−﹘﹣－]/g

/**
 * The form two names are compared in: accents and case removed ("Zoë" and
 * "zoe", "Łukasz" and "Lukasz"), ł ø ß æ œ đ ð þ ı spelled out, apostrophes
 * made plain, hyphens read as spaces, full stops dropped ("St. John" and
 * "St John", "Jr." and "Jr"), spaces collapsed and trimmed.
 */
export function foldName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(LETTER_RE, (ch) => LETTER_MAP[ch] ?? ch)
    .replace(APOSTROPHES_RE, "'")
    .replace(DASHES_RE, ' ')
    .replaceAll('.', '')
    .replaceAll('|', ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The value stored in guests.name_key: folded first name, "|", folded last
 * name. Every writer of name_key (routes, import, seed, tests) must use this.
 */
export function nameKey(firstName: string, lastName: string): string {
  return `${foldName(firstName)}|${foldName(lastName)}`
}

/** Folded "first last", for matching a full name typed in one cell (such as a partner). */
export function fullNameKey(firstName: string, lastName: string): string {
  return foldName(`${firstName} ${lastName}`)
}

/**
 * Folded full name for text typed as one name: "Smith, Jane", "Mrs. Jane
 * Smith" and "jane smith" all give "jane smith".
 */
export function lookupKeyForFullName(text: string): string {
  const split = splitPastedName(text)
  return fullNameKey(split.firstName, split.lastName)
}

// ---------------------------------------------------------------------------
// String distance

/** Jaro-Winkler similarity, 0 to 1, with the usual 0.1 prefix scale over up to 4 characters. */
export function jaroWinkler(a: string, b: string): number {
  const s = Array.from(a)
  const t = Array.from(b)
  if (s.length === 0 && t.length === 0) return 1
  if (s.length === 0 || t.length === 0) return 0
  const window = Math.max(0, Math.floor(Math.max(s.length, t.length) / 2) - 1)
  const sMatched = new Array<boolean>(s.length).fill(false)
  const tMatched = new Array<boolean>(t.length).fill(false)
  let matches = 0
  for (let i = 0; i < s.length; i++) {
    const lo = Math.max(0, i - window)
    const hi = Math.min(t.length - 1, i + window)
    for (let j = lo; j <= hi; j++) {
      if (!tMatched[j] && s[i] === t[j]) {
        sMatched[i] = true
        tMatched[j] = true
        matches++
        break
      }
    }
  }
  if (matches === 0) return 0
  let halfTranspositions = 0
  let k = 0
  for (let i = 0; i < s.length; i++) {
    if (!sMatched[i]) continue
    while (!tMatched[k]) k++
    if (s[i] !== t[k]) halfTranspositions++
    k++
  }
  const jaro = (matches / s.length + matches / t.length + (matches - halfTranspositions / 2) / matches) / 3
  let prefix = 0
  while (prefix < 4 && prefix < s.length && prefix < t.length && s[prefix] === t[prefix]) prefix++
  return jaro + prefix * 0.1 * (1 - jaro)
}

/**
 * Optimal string alignment distance: insertions, deletions, substitutions
 * and swaps of two neighboring letters each cost 1 ("Jon"/"John" 1,
 * "Smtih"/"Smith" 1). With `max`, stops early and returns max + 1 once the
 * distance must exceed it.
 */
export function osaDistance(a: string, b: string, max = Infinity): number {
  const s = Array.from(a)
  const t = Array.from(b)
  if (Math.abs(s.length - t.length) > max) return max + 1
  if (s.length === 0) return t.length
  if (t.length === 0) return s.length
  const width = t.length + 1
  let prev2 = new Array<number>(width).fill(0)
  let prev = Array.from({ length: width }, (_, j) => j)
  let row = new Array<number>(width).fill(0)
  for (let i = 1; i <= s.length; i++) {
    row[0] = i
    let rowMin = row[0]
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1
      let d = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost)
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) d = Math.min(d, prev2[j - 2] + 1)
      row[j] = d
      if (d < rowMin) rowMin = d
    }
    if (rowMin > max) return max + 1
    const used = prev2
    prev2 = prev
    prev = row
    row = used
  }
  const result = prev[t.length]
  return result > max ? max + 1 : result
}

// ---------------------------------------------------------------------------
// Nicknames and likely duplicates

/** Formal name and the short forms people use for it. Small on purpose. */
const NICKNAMES: Record<string, readonly string[]> = {
  william: ['bill', 'billy', 'will', 'willy', 'liam'],
  robert: ['bob', 'bobby', 'rob', 'robbie'],
  elizabeth: ['liz', 'lizzie', 'beth', 'betty', 'eliza', 'libby'],
  katherine: ['kate', 'katie', 'kathy', 'kat'],
  catherine: ['kate', 'katie', 'cathy', 'cat'],
  kathryn: ['kate', 'katie', 'kathy'],
  michael: ['mike', 'mikey', 'mick'],
  daniel: ['dan', 'danny'],
  samuel: ['sam', 'sammy'],
  samantha: ['sam', 'sammy'],
  alexander: ['alex', 'xander', 'sasha'],
  alexandra: ['alex', 'lexi', 'sasha'],
  james: ['jim', 'jimmy', 'jamie'],
  joseph: ['joe', 'joey'],
  thomas: ['tom', 'tommy'],
  richard: ['rich', 'rick', 'ricky'],
  edward: ['ed', 'eddie', 'ted', 'ned'],
  christopher: ['chris'],
  christine: ['chris', 'tina'],
  jennifer: ['jen', 'jenny'],
  margaret: ['maggie', 'meg', 'peggy'],
  rebecca: ['becky', 'becca'],
  benjamin: ['ben', 'benny'],
  matthew: ['matt'],
  nicholas: ['nick', 'nicky'],
  anthony: ['tony'],
  andrew: ['andy', 'drew'],
  jonathan: ['jon', 'jonny'],
  stephen: ['steve'],
  steven: ['steve'],
  timothy: ['tim'],
  charles: ['charlie'],
  victoria: ['vicky', 'tori'],
  abigail: ['abby'],
}

/** Folded name -> the formal names it can stand for (itself included). */
const FORMAL_NAMES = (() => {
  const map = new Map<string, Set<string>>()
  const add = (name: string, formal: string) => {
    let set = map.get(name)
    if (!set) map.set(name, (set = new Set()))
    set.add(formal)
  }
  for (const [formal, nicks] of Object.entries(NICKNAMES)) {
    add(formal, formal)
    for (const nick of nicks) add(nick, formal)
  }
  return map
})()

/** True when two folded first names can be the same person by the nickname table ("bill" and "william"). */
export function nicknamesMatch(a: string, b: string): boolean {
  const fa = FORMAL_NAMES.get(a)
  const fb = FORMAL_NAMES.get(b)
  if (!fa || !fb) return false
  for (const name of fa) if (fb.has(name)) return true
  return false
}

/**
 * Two folded first names close enough to be one person typed twice:
 * Jaro-Winkler 0.90 or more, or one edit apart. A single changed letter in
 * a name of three letters or fewer ("Tom", "Tim") is two people, not a typo,
 * so it does not count.
 */
function firstNamesClose(a: string, b: string): boolean {
  if (a === b) return true
  if (jaroWinkler(a, b) >= 0.9) return true
  const la = Array.from(a).length
  const lb = Array.from(b).length
  if (osaDistance(a, b, 1) > 1) return false
  return la !== lb || Math.min(la, lb) >= 4
}

export type PersonName = { firstName: string; lastName: string; nickname?: string | null }
export type DuplicateReason = 'same-name' | 'swapped' | 'nickname' | 'close-spelling'

export const DUPLICATE_REASON_TEXT: Record<DuplicateReason, string> = {
  'same-name': 'Same name',
  swapped: 'First and last name swapped',
  nickname: 'Nickname',
  'close-spelling': 'Close spelling',
}

/** Shortest full name the "close spelling of the whole name" rule looks at. */
const FULL_NAME_MIN_LENGTH = 10
const FULL_NAME_MAX_EDITS = 2

/**
 * Why two people look like the same person, or null:
 *  - same name, ignoring case and accents;
 *  - first and last name swapped ("Lee Chen", "Chen Lee");
 *  - same last name and first names that are nicknames of each other
 *    ("Bill", "William"), counting a guest's nickname too;
 *  - same last name and first names close in spelling;
 *  - whole names of 10 or more characters within 2 edits ("Katherine
 *    Smyth", "Katharine Smith").
 */
export function duplicateReason(a: PersonName, b: PersonName): DuplicateReason | null {
  return duplicateReasonFolded(foldPerson(a), foldPerson(b))
}

export function likelyDuplicate(a: PersonName, b: PersonName): boolean {
  return duplicateReason(a, b) !== null
}

type FoldedPerson = { first: string; last: string; nick: string; full: string }

function foldPerson(p: PersonName): FoldedPerson {
  const first = foldName(p.firstName)
  const last = foldName(p.lastName)
  return { first, last, nick: p.nickname ? foldName(p.nickname) : '', full: `${first} ${last}`.trim() }
}

function duplicateReasonFolded(a: FoldedPerson, b: FoldedPerson): DuplicateReason | null {
  if (!a.full || !b.full) return null
  if (a.first === b.first && a.last === b.last) return 'same-name'
  if (a.first && a.last && a.first === b.last && a.last === b.first) return 'swapped'
  if (a.last && a.last === b.last) {
    const aNames = a.nick ? [a.first, a.nick] : [a.first]
    const bNames = b.nick ? [b.first, b.nick] : [b.first]
    for (const x of aNames) for (const y of bNames) if (x && y && (x === y || nicknamesMatch(x, y))) return 'nickname'
    if (a.first && b.first && firstNamesClose(a.first, b.first)) return 'close-spelling'
  }
  if (
    Math.min(a.full.length, b.full.length) >= FULL_NAME_MIN_LENGTH &&
    osaDistance(a.full, b.full, FULL_NAME_MAX_EDITS) <= FULL_NAME_MAX_EDITS
  ) {
    return 'close-spelling'
  }
  return null
}

export type DuplicatePair = { a: string; b: string; reason: DuplicateReason }

/** Letter counts for the quick "can these be within 2 edits" test. */
function letterCounts(s: string): Uint8Array {
  const counts = new Uint8Array(27)
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i) - 97
    const k = c >= 0 && c < 26 ? c : 26
    if (counts[k] < 255) counts[k]++
  }
  return counts
}

/**
 * Each edit changes the letter counts by at most 2 in all, so names whose
 * counts differ by more than 4 cannot be within 2 edits.
 */
function countsWithin(a: Uint8Array, b: Uint8Array, limit: number): boolean {
  let diff = 0
  for (let i = 0; i < 27; i++) {
    diff += a[i] > b[i] ? a[i] - b[i] : b[i] - a[i]
    if (diff > limit) return false
  }
  return true
}

/**
 * Every likely duplicate pair among `people`, each pair once, with the ids
 * given as `key`. With `involving`, only pairs where at least one side's key
 * passes it (new rows against everyone, say). Fast enough for 10,000 names:
 * only people with the same last name, swapped names or similar letters are
 * compared in full.
 */
export function findLikelyDuplicates(
  people: readonly (PersonName & { key: string })[],
  involving: (key: string) => boolean = () => true,
): DuplicatePair[] {
  const folded = people.map(foldPerson)
  const wanted = people.map((p) => involving(p.key))
  const seen = new Set<string>()
  const pairs: DuplicatePair[] = []
  const consider = (i: number, j: number) => {
    if (i === j || (!wanted[i] && !wanted[j])) return
    const lo = Math.min(i, j)
    const hi = Math.max(i, j)
    const id = `${lo}:${hi}`
    if (seen.has(id)) return
    seen.add(id)
    const reason = duplicateReasonFolded(folded[lo], folded[hi])
    if (reason) pairs.push({ a: people[lo].key, b: people[hi].key, reason })
  }

  // Same last name: same name, nicknames, close first names, and close whole names.
  const byLast = new Map<string, number[]>()
  folded.forEach((f, i) => {
    if (!f.last) return
    const list = byLast.get(f.last)
    if (list) list.push(i)
    else byLast.set(f.last, [i])
  })
  for (const list of byLast.values()) {
    for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) consider(list[x], list[y])
  }

  // Swapped first and last names.
  const byFirstLast = new Map<string, number[]>()
  folded.forEach((f, i) => {
    if (!f.first || !f.last) return
    const k = `${f.first}|${f.last}`
    const list = byFirstLast.get(k)
    if (list) list.push(i)
    else byFirstLast.set(k, [i])
  })
  folded.forEach((f, i) => {
    if (!f.first || !f.last || f.first === f.last) return
    for (const j of byFirstLast.get(`${f.last}|${f.first}`) ?? []) consider(i, j)
  })

  // Whole names within 2 edits, sorted by length so only lengths within 2 meet.
  const long = folded
    .map((f, i) => ({ i, len: f.full.length }))
    .filter((x) => x.len >= FULL_NAME_MIN_LENGTH)
    .sort((x, y) => x.len - y.len)
  const counts = new Map<number, Uint8Array>()
  for (const x of long) counts.set(x.i, letterCounts(folded[x.i].full))
  for (let x = 0; x < long.length; x++) {
    const ci = counts.get(long[x].i)!
    for (let y = x + 1; y < long.length && long[y].len - long[x].len <= FULL_NAME_MAX_EDITS; y++) {
      const i = long[x].i
      const j = long[y].i
      if (!wanted[i] && !wanted[j]) continue
      if (!countsWithin(ci, counts.get(j)!, FULL_NAME_MAX_EDITS * 2)) continue
      consider(i, j)
    }
  }

  return pairs
}

// ---------------------------------------------------------------------------
// Pasted names

export type PastedNameProblem =
  | 'Needs a name'
  | 'Needs a first name'
  | 'Needs a last name'
  | 'Two people? Split this line'

export type PastedName = {
  /** The line as pasted, trimmed. */
  source: string
  firstName: string
  lastName: string
  /** Missing names block saving; "Two people?" is a warning to check. */
  problem: PastedNameProblem | null
}

const PARTICLES = new Set([
  'van',
  'von',
  'de',
  'del',
  'della',
  'da',
  'di',
  'du',
  'la',
  'le',
  'al',
  'bin',
  'ben',
  'ter',
  'ten',
])
const HONORIFICS = new Set(['mr', 'mrs', 'ms', 'miss', 'mx', 'dr'])
const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv'])

const bare = (token: string) => token.replace(/\.$/, '').toLowerCase()
const isHonorific = (token: string) => HONORIFICS.has(bare(token))
const isSuffix = (token: string) => SUFFIXES.has(bare(token))
const isParticle = (token: string) => PARTICLES.has(token.toLowerCase())

/** " & " or " and " between two names. */
const TWO_PEOPLE_RE = /\s(?:&|and)\s/i

function cleanLine(line: string): string {
  let s = wellFormedText(line).replace(/\s+/g, ' ').trim()
  // List bullets and numbering: "- Anna Lee", "3. Anna Lee", "• Anna Lee".
  s = s.replace(/^(?:[-*•·◦‣–—]|\d{1,4}[.)])\s+/, '')
  // Matching quotes around the whole line.
  const quoted = /^(?:"(.*)"|'(.*)'|“(.*)”|‘(.*)’)$/.exec(s)
  if (quoted) s = (quoted[1] ?? quoted[2] ?? quoted[3] ?? quoted[4]).trim()
  return s
}

function dropHonorifics(tokens: string[]): string[] {
  const out = [...tokens]
  while (out.length > 1 && isHonorific(out[0])) out.shift()
  return out
}

/** Moves trailing suffixes ("Jr.", "III") off the tokens, when at least `keep` tokens remain. */
function takeSuffixes(tokens: string[], keep: number): { tokens: string[]; suffix: string[] } {
  const out = [...tokens]
  const suffix: string[] = []
  while (out.length > keep && isSuffix(out[out.length - 1])) suffix.unshift(out.pop()!)
  return { tokens: out, suffix }
}

function result(source: string, firstName: string, lastName: string, twoPeople: boolean): PastedName {
  let problem: PastedNameProblem | null = null
  if (!firstName && !lastName) problem = 'Needs a name'
  else if (!lastName) problem = 'Needs a last name'
  else if (!firstName) problem = 'Needs a first name'
  else if (twoPeople) problem = 'Two people? Split this line'
  return { source, firstName, lastName, problem }
}

/**
 * Splits one pasted line into first and last name (DECISIONS 25):
 *  - "Last, First" when the line holds a comma ("van der Berg, Anna");
 *  - otherwise the last word is the last name, unless a particle (van, von,
 *    de, del, della, da, di, du, la, le, al, bin, ben, ter, ten) starts it
 *    earlier ("Anna van der Berg");
 *  - Jr, Sr, II, III and IV stay with the last name ("Smith Jr.");
 *  - Mr, Mrs, Ms, Miss, Mx and Dr at the start are dropped;
 *  - two cells pasted from a spreadsheet (a tab between them) are first and last name.
 * A single word gets "Needs a last name"; " & " or " and " between names gets
 * "Two people? Split this line". Spelling and case are kept as typed.
 */
export function splitPastedName(line: string): PastedName {
  const raw = wellFormedText(line)
  if (raw.includes('\t')) {
    const cells = raw
      .split('\t')
      .map((c) => c.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
    if (cells.length >= 2) {
      const first = dropHonorifics(cells[0].split(' ')).join(' ')
      const source = cells.join(' ')
      return result(source, first, cells.slice(1).join(' '), TWO_PEOPLE_RE.test(` ${source} `))
    }
  }
  const source = cleanLine(raw)
  const twoPeople = TWO_PEOPLE_RE.test(source)
  // "John Smith, Jr." is not "Last, First": fold the suffix back in.
  const s = source.replace(/,\s*((?:jr|sr|ii|iii|iv)\.?)$/i, ' $1')

  const comma = s.indexOf(',')
  if (comma >= 0) {
    const lastPart = s.slice(0, comma).trim()
    const firstPart = s
      .slice(comma + 1)
      .replaceAll(',', ' ')
      .replace(/\s+/g, ' ')
      .trim()
    const { tokens, suffix } = takeSuffixes(firstPart ? firstPart.split(' ') : [], 1)
    const first = dropHonorifics(tokens).join(' ')
    const last = [lastPart, ...suffix].filter(Boolean).join(' ')
    return result(source, first, last, twoPeople)
  }

  if (!s) return result(source, '', '', false)
  const { tokens, suffix } = takeSuffixes(dropHonorifics(s.split(' ')), 2)
  if (tokens.length === 1) return result(source, tokens[0], suffix.join(' '), twoPeople)
  let start = tokens.length - 1
  for (let i = 1; i <= tokens.length - 2; i++) {
    if (isParticle(tokens[i])) {
      start = i
      break
    }
  }
  const first = tokens.slice(0, start).join(' ')
  const last = [...tokens.slice(start), ...suffix].join(' ')
  return result(source, first, last, twoPeople)
}

/** One entry per non-blank line. */
export function splitPastedNames(text: string): PastedName[] {
  return text
    .split(/\r\n|\r|\n/)
    .filter((line) => line.trim() !== '')
    .map(splitPastedName)
}

/**
 * For a line holding two people, the two lines to use instead, or null:
 * "John & Jane Smith" gives "John Smith" and "Jane Smith"; "Smith, John and
 * Jane" the same; "Anna Berg and Tom Lee" gives "Anna Berg" and "Tom Lee".
 */
export function suggestTwoPeopleSplit(line: string): [string, string] | null {
  const s = cleanLine(line)
  const comma = s.indexOf(',')
  if (comma >= 0) {
    const last = s.slice(0, comma).trim()
    const parts = s.slice(comma + 1).split(TWO_PEOPLE_RE)
    if (parts.length !== 2 || !last) return null
    const [a, b] = parts.map((p) => dropHonorifics(p.trim().split(' ')).join(' '))
    if (!a || !b) return null
    return [`${a} ${last}`, `${b} ${last}`]
  }
  const parts = s.split(TWO_PEOPLE_RE)
  if (parts.length !== 2) return null
  const left = dropHonorifics(parts[0].trim().split(' ')).join(' ')
  const right = dropHonorifics(parts[1].trim().split(' ')).join(' ')
  // "Mr and Mrs John Smith" names one person and a title: nothing to split.
  if (!left || !right || isHonorific(left) || isHonorific(right)) return null
  const leftHasLast = left.includes(' ')
  const rightHasLast = right.includes(' ')
  if (!leftHasLast && rightHasLast) return [`${left} ${splitPastedName(right).lastName}`, right]
  if (leftHasLast && !rightHasLast) return [left, `${right} ${splitPastedName(left).lastName}`]
  return [left, right]
}

// ---------------------------------------------------------------------------
// Initials

function firstLetter(value: string): string {
  const m = /\p{L}|\p{N}/u.exec(value)
  return m ? m[0] : ''
}

/** "AB" for Anna Berg; "AV" for Anna van der Berg. Upper case; empty parts give nothing. */
export function initials(firstName: string, lastName: string): string {
  return `${firstLetter(firstName)}${firstLetter(lastName)}`.toUpperCase()
}
