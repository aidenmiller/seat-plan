/**
 * The Rules page as first drawn: couple rules with their switches, other
 * rules with kind, guests, where they apply, on and off, note, clash flags
 * and "Needs guests".
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Guest, StoredRule } from '@/shared/api'
import { RulesScreen } from './RulesScreen'

const W = '44444444-4444-4444-8444-444444444444'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function guest(n: number, first: string, last: string, over: Partial<Guest> = {}): Guest {
  return {
    id: id(n),
    weddingId: W,
    firstName: first,
    lastName: last,
    nickname: null,
    partnerId: null,
    coupleRuleEnabled: true,
    household: null,
    side: 'both',
    rsvp: 'yes',
    meal: null,
    isChild: false,
    notes: null,
    groupIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function rule(n: number, over: Partial<StoredRule>): StoredRule {
  return {
    id: id(100 + n),
    weddingId: W,
    kind: 'together',
    guestIds: [],
    nextToEachOther: false,
    appliesTo: 'both',
    enabled: true,
    note: null,
    needsGuests: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

describe('RulesScreen', () => {
  it('lists couple rules, other rules, clashes and rules that need guests', () => {
    const guests = [
      guest(1, 'Jane', 'Doe', { partnerId: id(2) }),
      guest(2, 'Tom', 'Doe', { partnerId: id(1), coupleRuleEnabled: true }),
      guest(3, 'Ann', 'Lee'),
    ]
    const rules = [
      rule(1, { kind: 'apart', guestIds: [id(1), id(2)], note: 'They argue' }),
      rule(2, { kind: 'together', guestIds: [id(3)], needsGuests: true, appliesTo: 'ceremony' }),
    ]
    const html = renderToStaticMarkup(<RulesScreen weddingId={W} guests={guests} groups={[]} rules={rules} />)
    expect(html).toContain('data-testid="couple-rule"')
    expect(html).toContain('Jane Doe and Tom Doe')
    expect(html).toContain('Keep apart')
    expect(html).toContain('They argue')
    expect(html).toContain('Ceremony only')
    expect(html).toContain('data-testid="rule-needs-guests"')
    // The apart rule and the couple rule clash, flagged on both.
    expect(html.match(/data-testid="rule-clash"/g)).toHaveLength(2)
  })
})
