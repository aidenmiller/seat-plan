import { describe, expect, it } from 'vitest'
import { coupleRuleId, withCoupleRules, type Rule, type RuleGuest } from './rules'
import { addPicked, clashMap, couplePairs, ruleKindText } from './rules-list'

const guest = (id: string, partnerId: string | null = null, coupleRuleEnabled = true): RuleGuest => ({ id, rsvp: 'yes', partnerId, coupleRuleEnabled })
const rule = (id: string, kind: Rule['kind'], guestIds: string[], extra: Partial<Rule> = {}): Rule => ({
  id,
  kind,
  guestIds,
  nextToEachOther: false,
  appliesTo: 'both',
  enabled: true,
  ...extra,
})

describe('couplePairs', () => {
  it('lists each linked pair once, off when either switch is off', () => {
    const guests = [guest('a', 'b'), guest('b', 'a', false), guest('c', 'd'), guest('d', 'c'), guest('e', 'a')]
    expect(couplePairs(guests)).toEqual([
      { id: coupleRuleId('a', 'b'), guestIds: ['a', 'b'], enabled: false },
      { id: coupleRuleId('c', 'd'), guestIds: ['c', 'd'], enabled: true },
    ])
  })
})

describe('clashMap', () => {
  it('flags together and apart rules over the same guests, couples included', () => {
    const guests = [guest('a', 'b'), guest('b', 'a'), guest('c')]
    const rules = [rule('r1', 'apart', ['a', 'b']), rule('r2', 'together', ['b', 'c']), rule('r3', 'apart', ['b', 'c'], { enabled: false })]
    const map = clashMap(withCoupleRules(guests, rules))
    expect(map.get('r1')).toEqual([coupleRuleId('a', 'b')])
    expect(map.get(coupleRuleId('a', 'b'))).toEqual(['r1'])
    expect(map.has('r2')).toBe(false)
  })
})

describe('wording', () => {
  it('names the kind of rule', () => {
    expect(ruleKindText({ kind: 'together', nextToEachOther: true })).toBe('Keep together, next to each other')
    expect(ruleKindText({ kind: 'apart', nextToEachOther: false })).toBe('Keep apart')
  })

  it('adds a group to the picked guests once each', () => {
    expect(addPicked(['a', 'b'], ['b', 'c', 'c'])).toEqual(['a', 'b', 'c'])
  })
})
