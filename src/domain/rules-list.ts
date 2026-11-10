/**
 * What the Rules page shows (spec section 7, "Rules"; PLAN changes 8 and
 * 16): every linked couple with its switch, the wording of each rule, and
 * which rules clash. Pure.
 */
import { clashes, coupleRuleId, type AppliesTo, type Rule, type RuleGuest } from './rules'

/** A linked couple as the Rules page lists it, switch on or off. */
export type CouplePair = { id: string; guestIds: [string, string]; enabled: boolean }

/** Every pair of live guests linked to each other, once, in guest order. On when the switch is on for both. */
export function couplePairs(guests: readonly RuleGuest[]): CouplePair[] {
  const byId = new Map(guests.map((g) => [g.id, g]))
  const out: CouplePair[] = []
  for (const g of guests) {
    if (!g.partnerId || g.partnerId === g.id) continue
    const p = byId.get(g.partnerId)
    if (!p || p.partnerId !== g.id || !(g.id < p.id)) continue
    out.push({ id: coupleRuleId(g.id, p.id), guestIds: [g.id, p.id], enabled: g.coupleRuleEnabled && p.coupleRuleEnabled })
  }
  return out
}

/** For each rule in a clash (PLAN change 16), the ids of the rules it clashes with. Pass withCoupleRules(...) to include couples. */
export function clashMap(rules: readonly Rule[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const add = (a: string, b: string) => {
    const list = out.get(a)
    if (!list) out.set(a, [b])
    else if (!list.includes(b)) list.push(b)
  }
  for (const c of clashes(rules)) {
    add(c.togetherRuleId, c.apartRuleId)
    add(c.apartRuleId, c.togetherRuleId)
  }
  return out
}

/** "Keep together", "Keep together, next to each other", "Keep apart". */
export function ruleKindText(rule: Pick<Rule, 'kind' | 'nextToEachOther'>): string {
  if (rule.kind === 'apart') return 'Keep apart'
  return rule.nextToEachOther ? 'Keep together, next to each other' : 'Keep together'
}

export const APPLIES_TO_TEXT: Record<AppliesTo, string> = {
  both: 'Reception and ceremony',
  reception: 'Reception only',
  ceremony: 'Ceremony only',
}

/** Adds guests to a picked list (a whole group at once), keeping the order and each guest once. */
export function addPicked(picked: readonly string[], add: readonly string[]): string[] {
  const out = [...picked]
  for (const id of add) if (!out.includes(id)) out.push(id)
  return out
}
