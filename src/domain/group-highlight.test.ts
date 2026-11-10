import { describe, expect, it } from 'vitest'
import type { Canvas, ChairRow, Item, Seat, Table } from './canvas-schema'
import {
  canAddHighlight,
  cleanHighlight,
  groupHighlight,
  MAX_HIGHLIGHT_GROUPS,
  seatFaded,
  seatRing,
  toggleHighlight,
  type HighlightGroup,
} from './group-highlight'
import { seatKey } from './rules'

function seats(n: number, taken: Record<number, string> = {}): Seat[] {
  return Array.from({ length: n }, (_, index) => ({ index, guestId: taken[index] ?? null }))
}

function table(id: string, taken: Record<number, string> = {}): Table {
  return {
    id,
    kind: 'table',
    shape: 'round',
    x: 0,
    y: 0,
    rotation: 0,
    locked: false,
    width: 152.4,
    height: 152.4,
    number: 1,
    name: 'Table 1',
    seatCount: 8,
    seatSides: 'all',
    seats: seats(8, taken),
  }
}

function row(id: string, taken: Record<number, string> = {}): ChairRow {
  return {
    id,
    kind: 'chairRow',
    x: 0,
    y: 0,
    rotation: 0,
    locked: false,
    chairCount: 6,
    spacing: 50.8,
    blockId: null,
    blockLabel: null,
    rowNumber: 1,
    rowLabel: '',
    reservedFor: null,
    seats: seats(6, taken),
  }
}

const canvas = (...items: Item[]): Canvas => ({ schemaVersion: 1, items })

const groups: HighlightGroup[] = [
  { id: 'fam', color: '#2563EB', memberIds: ['a', 'b', 'c'] },
  { id: 'hs', color: '#EA580C', memberIds: ['b', 'd', 'x'] },
  { id: 'work', color: '#16A34A', memberIds: ['e'] },
  { id: 'band', color: '#9333EA', memberIds: ['f'] },
]

describe('groupHighlight', () => {
  const c = canvas(table('t1', { 0: 'a', 1: 'b', 2: 'z' }), table('t2', { 0: 'd', 3: 'e' }), row('r1', { 1: 'f' }))

  it('rings the seated members of each chosen group in its color, and fades the rest', () => {
    const h = groupHighlight(c, groups, ['fam', 'work'])
    expect(h.groupIds).toEqual(['fam', 'work'])
    expect(h.fade).toBe(true)
    expect([...h.rings.keys()].sort()).toEqual([seatKey('t1', 0), seatKey('t1', 1), seatKey('t2', 3)].sort())
    expect(seatRing(h, 't1', 0)).toEqual({ itemId: 't1', seatIndex: 0, guestId: 'a', groupId: 'fam', color: '#2563EB' })
    expect(seatRing(h, 't2', 3)).toMatchObject({ guestId: 'e', groupId: 'work', color: '#16A34A' })
    expect(seatRing(h, 't2', 0)).toBeNull()
    expect(seatFaded(h, 't2', 0)).toBe(true)
    expect(seatFaded(h, 't1', 2)).toBe(true)
    expect(seatFaded(h, 't1', 0)).toBe(false)
    expect(h.itemIds).toEqual(new Set(['t1', 't2']))
    // c has no seat.
    expect(h.seatedCount).toEqual(
      new Map([
        ['fam', 2],
        ['work', 1],
      ]),
    )
  })

  it('gives a guest in several chosen groups the color of the first chosen', () => {
    expect(seatRing(groupHighlight(c, groups, ['fam', 'hs']), 't1', 1)).toMatchObject({ guestId: 'b', groupId: 'fam' })
    const hsFirst = groupHighlight(c, groups, ['hs', 'fam'])
    expect(seatRing(hsFirst, 't1', 1)).toMatchObject({ guestId: 'b', groupId: 'hs', color: '#EA580C' })
    // b still counts as seated for both groups.
    expect(hsFirst.seatedCount.get('fam')).toBe(2)
    expect(hsFirst.seatedCount.get('hs')).toBe(2)
  })

  it('rings guests in ceremony chair rows', () => {
    const h = groupHighlight(c, groups, ['band'])
    expect(seatRing(h, 'r1', 1)).toMatchObject({ guestId: 'f', groupId: 'band' })
    expect(h.itemIds).toEqual(new Set(['r1']))
  })

  it('fades nothing with no group chosen', () => {
    const h = groupHighlight(c, groups, [])
    expect(h).toMatchObject({ groupIds: [], fade: false })
    expect(h.rings.size).toBe(0)
    expect(seatFaded(h, 't1', 0)).toBe(false)
  })

  it('still fades when the chosen group has nobody seated', () => {
    const h = groupHighlight(c, [...groups, { id: 'empty', color: '#000000', memberIds: ['q'] }], ['empty'])
    expect(h.fade).toBe(true)
    expect(h.rings.size).toBe(0)
    expect(h.seatedCount.get('empty')).toBe(0)
  })

  it('shows at most three groups and skips deleted ones', () => {
    const h = groupHighlight(c, groups, ['gone', 'fam', 'hs', 'fam', 'work', 'band'])
    expect(h.groupIds).toEqual(['fam', 'hs', 'work'])
    expect(seatRing(h, 'r1', 1)).toBeNull()
  })
})

describe('choosing groups', () => {
  it('toggles groups on and off, up to three', () => {
    let chosen: readonly string[] = []
    chosen = toggleHighlight(chosen, 'a')
    chosen = toggleHighlight(chosen, 'b')
    chosen = toggleHighlight(chosen, 'c')
    expect(chosen).toEqual(['a', 'b', 'c'])
    expect(canAddHighlight(chosen)).toBe(false)
    expect(toggleHighlight(chosen, 'd')).toBe(chosen)
    chosen = toggleHighlight(chosen, 'b')
    expect(chosen).toEqual(['a', 'c'])
    expect(canAddHighlight(chosen)).toBe(true)
    expect(toggleHighlight(chosen, 'd')).toEqual(['a', 'c', 'd'])
    expect(MAX_HIGHLIGHT_GROUPS).toBe(3)
  })

  it('cleans a remembered choice against the groups that exist', () => {
    expect(cleanHighlight(['x', 'fam', 'fam', 'hs'], groups)).toEqual(['fam', 'hs'])
    expect(cleanHighlight(['band', 'work', 'hs', 'fam'], groups)).toEqual(['band', 'work', 'hs'])
  })
})
