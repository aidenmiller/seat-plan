/**
 * The couple's two names and the guest sides that point at them. A guest's
 * side is stored by position ('partner1', 'partner2' or 'both'), and every
 * screen, export and import turns it into this wedding's names, so renaming a
 * partner in the wedding's settings relabels every guest at once.
 *
 * Weddings from before names were stored are Noa and Aiden's: migration 0007
 * gave them those names, and legacySide reads the old stored words. Pure.
 */
import { DEFAULT_LEFT_LABEL, DEFAULT_RIGHT_LABEL } from './ceremony'
import { foldName } from './names'

export const guestSides = ['partner1', 'partner2', 'both'] as const
export type GuestSide = (typeof guestSides)[number]

/** A wedding's two names; null when not given. */
export type PartnerNames = { partner1: string | null; partner2: string | null }

/** The longest name a wedding takes (weddings_partner1_name_valid). */
export const PARTNER_NAME_MAX = 60

/** A wedding's names as PartnerNames. */
export function partnersOf(wedding: { partner1Name: string | null; partner2Name: string | null }): PartnerNames {
  return { partner1: wedding.partner1Name, partner2: wedding.partner2Name }
}

const FALLBACK: Record<'partner1' | 'partner2', string> = { partner1: 'Partner 1', partner2: 'Partner 2' }

/** The partner's name, or "Partner 1" / "Partner 2" when the wedding has none. */
export function partnerName(p: PartnerNames, which: 'partner1' | 'partner2'): string {
  return p[which]?.trim() || FALLBACK[which]
}

/** What a side reads as: "Noa", "Aiden" or "Both". */
export function sideLabel(p: PartnerNames, side: GuestSide): string {
  return side === 'both' ? 'Both' : partnerName(p, side)
}

/** The side picker's choices: partner 1, partner 2, then Both. */
export function sideOptions(p: PartnerNames): { value: GuestSide; label: string }[] {
  return guestSides.map((value) => ({ value, label: sideLabel(p, value) }))
}

/**
 * The seating block's side labels: partner 1 on the left as you face the
 * front ("Noa's side"), partner 2 on the right. A partner without a name
 * gets "Left side" or "Right side".
 */
export function ceremonySideLabels(p: PartnerNames): { left: string; right: string } {
  const left = p.partner1?.trim()
  const right = p.partner2?.trim()
  return { left: left ? `${left}'s side` : DEFAULT_LEFT_LABEL, right: right ? `${right}'s side` : DEFAULT_RIGHT_LABEL }
}

/** Sides as stored before migration 0007, when every wedding was Noa and Aiden's. */
const LEGACY: Record<string, GuestSide> = { Noa: 'partner1', Aiden: 'partner2', Both: 'both' }

/**
 * A stored side as a code: the codes pass through, and the old words map to
 * their place ('Noa' was partner 1, 'Aiden' partner 2). An older deployment
 * still writes the old words while a new one builds. Anything else is null.
 */
export function legacySide(value: string): GuestSide | null {
  if ((guestSides as readonly string[]).includes(value)) return value as GuestSide
  return LEGACY[value] ?? null
}

/**
 * A side cell as the import compares it: folded like names (accents, case,
 * curly apostrophes), punctuation as spaces, the word "side" dropped.
 * "Noa’s Side" -> "noa's".
 */
export function sideKey(raw: string): string {
  return foldName(raw)
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\bside\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Words that mean a side in every wedding. */
const FIXED_WORDS: readonly [string, GuestSide][] = [
  ['partner 1', 'partner1'],
  ['partner1', 'partner1'],
  ['p1', 'partner1'],
  ['partner 2', 'partner2'],
  ['partner2', 'partner2'],
  ['p2', 'partner2'],
  ['both', 'both'],
  ['both sides', 'both'],
  ['mutual', 'both'],
  ['shared', 'both'],
  ['either', 'both'],
]

/** "sam" -> sam, sam's, sams (and james' for names ending in s). */
function possessives(key: string): string[] {
  const forms = [key, `${key}'s`, `${key}s`]
  if (key.endsWith('s')) forms.push(`${key}'`)
  return forms
}

/**
 * The side words the CSV import understands for this wedding, keyed by
 * sideKey: "Partner 1" / "P1" and the same for 2, Both with its synonyms,
 * and each partner's whole name and first name with their possessives
 * ("Sam", "Sam's", "Sams"). The fixed words always mean the same, whatever
 * the names. A name word both partners share ("Sam" for Sam Lee and Sam
 * Park) could mean either side, so it is left out and the import reports it.
 */
export function sideWordMap(p: PartnerNames): Map<string, GuestSide> {
  const words = new Map<string, GuestSide>(FIXED_WORDS)
  const claims = new Map<string, Set<'partner1' | 'partner2'>>()
  for (const which of ['partner1', 'partner2'] as const) {
    const whole = sideKey(p[which] ?? '')
    if (!whole) continue
    const first = whole.split(' ')[0]!
    for (const key of [...possessives(whole), ...possessives(first)]) {
      if (words.has(key)) continue
      const sides = claims.get(key) ?? new Set()
      sides.add(which)
      claims.set(key, sides)
    }
  }
  for (const [key, sides] of claims) {
    if (sides.size === 1) words.set(key, [...sides][0]!)
  }
  return words
}
