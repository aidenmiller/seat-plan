import { describe, expect, it } from 'vitest'
import type { Canvas } from '../canvas-schema'
import type { FixedItem } from '../venue-schema'
import { partnerPairs, remapCanvas, remapWeddingRows, restoredName, sameWalls } from './remap'
import { backupFileSchema, restoreStartSchema, type BackupGuest } from './schema'

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const C = '00000000-0000-4000-8000-00000000000c'
const D = '00000000-0000-4000-8000-00000000000d'
const G1 = '00000000-0000-4000-8000-0000000000f1'
const R1 = '00000000-0000-4000-8000-0000000000e1'
const OUTSIDE = '00000000-0000-4000-8000-000000000099'

const newId = (old: string) => `new-${old.slice(-2)}`

function guest(id: string, partnerId: string | null = null, coupleRuleEnabled = true): BackupGuest {
  return {
    id,
    firstName: `F${id.slice(-1)}`,
    lastName: 'L',
    nickname: null,
    partnerId,
    coupleRuleEnabled,
    household: null,
    side: 'Both',
    rsvp: 'pending',
    meal: null,
    isChild: false,
    notes: null,
  }
}

const rule = { kind: 'apart' as const, nextToEachOther: false, appliesTo: 'both' as const, enabled: true, note: null }

describe('remapWeddingRows', () => {
  it('rewrites every guest id through the one map, in partners, members and rule guests', () => {
    const rows = remapWeddingRows(
      {
        guests: [guest(A, B), guest(B, A), guest(C)],
        groups: [{ id: G1, name: 'Friends', color: '#2563EB' }],
        groupMembers: [
          { groupId: G1, guestId: A },
          { groupId: G1, guestId: C },
        ],
        rules: [{ id: R1, ...rule }],
        ruleGuests: [
          { ruleId: R1, guestId: B },
          { ruleId: R1, guestId: C },
        ],
      },
      newId,
    )
    expect(rows.guests.map((g) => [g.id, g.partnerId])).toEqual([
      ['new-0a', 'new-0b'],
      ['new-0b', 'new-0a'],
      ['new-0c', null],
    ])
    expect(rows.groups).toEqual([{ id: 'new-f1', name: 'Friends', color: '#2563EB' }])
    expect(rows.groupMembers).toEqual([
      { groupId: 'new-f1', guestId: 'new-0a' },
      { groupId: 'new-f1', guestId: 'new-0c' },
    ])
    expect(rows.rules.map((r) => r.id)).toEqual(['new-e1'])
    expect(rows.ruleGuests).toEqual([
      { ruleId: 'new-e1', guestId: 'new-0b' },
      { ruleId: 'new-e1', guestId: 'new-0c' },
    ])
  })

  it('drops partner links that do not point both ways, and links to rows outside the file', () => {
    const rows = remapWeddingRows(
      {
        guests: [guest(A, B), guest(B, C), guest(C, B), guest(D, OUTSIDE)],
        groups: [{ id: G1, name: 'Friends', color: '#2563EB' }],
        groupMembers: [
          { groupId: G1, guestId: OUTSIDE },
          { groupId: OUTSIDE, guestId: A },
          { groupId: G1, guestId: A },
          { groupId: G1, guestId: A },
        ],
        rules: [{ id: R1, ...rule }],
        ruleGuests: [{ ruleId: R1, guestId: OUTSIDE }],
      },
      newId,
    )
    expect(rows.guests.map((g) => g.partnerId)).toEqual([null, 'new-0c', 'new-0b', null])
    expect(rows.groupMembers).toEqual([{ groupId: 'new-f1', guestId: 'new-0a' }])
    expect(rows.ruleGuests).toEqual([])
  })

  it('keeps the couple rule switch the same on both partners', () => {
    const rows = remapWeddingRows(
      { guests: [guest(A, B, false), guest(B, A, true), guest(C, null, false)], groups: [], groupMembers: [], rules: [], ruleGuests: [] },
      newId,
    )
    expect(rows.guests.map((g) => g.coupleRuleEnabled)).toEqual([false, false, true])
  })
})

describe('partnerPairs', () => {
  it('lists each pair once', () => {
    expect(
      partnerPairs([
        { id: 'a', partnerId: 'b' },
        { id: 'b', partnerId: 'a' },
        { id: 'c', partnerId: null },
      ]),
    ).toEqual([['a', 'b']])
  })
})

describe('remapCanvas', () => {
  it('rewrites seated guest ids in tables and chair rows and leaves everything else', () => {
    const canvas: Canvas = {
      schemaVersion: 1,
      items: [
        {
          id: 't1',
          kind: 'table',
          x: 0,
          y: 0,
          rotation: 0,
          locked: false,
          shape: 'round',
          width: 152.4,
          height: 152.4,
          number: 1,
          name: 'Table 1',
          seatCount: 2,
          seatSides: 'all',
          seats: [
            { index: 0, guestId: A },
            { index: 1, guestId: null },
          ],
        },
        {
          id: 'r1',
          kind: 'chairRow',
          x: 0,
          y: 0,
          rotation: 0,
          locked: false,
          chairCount: 1,
          spacing: 50.8,
          blockId: null,
          blockLabel: null,
          rowNumber: 1,
          rowLabel: 'Row 1',
          reservedFor: null,
          seats: [{ index: 0, guestId: B, pinned: true }],
        },
      ],
    }
    const out = remapCanvas(canvas, newId)
    expect(out.items[0]).toMatchObject({ id: 't1', seats: [{ index: 0, guestId: 'new-0a' }, { index: 1, guestId: null }] })
    expect(out.items[1]).toMatchObject({ id: 'r1', seats: [{ index: 0, guestId: 'new-0b', pinned: true }] })
    // The input is left as it was.
    expect(canvas.items[0]).toMatchObject({ seats: [{ guestId: A }, { guestId: null }] })
  })
})

describe('sameWalls', () => {
  const wall = (id: string, x: number, thickness = 20): FixedItem => ({
    id,
    type: 'wall',
    unsure: false,
    unsureNote: '',
    thickness,
    points: [
      { x, y: 0 },
      { x, y: 500 },
    ],
  })
  const label: FixedItem = { id: 'l', type: 'label', unsure: false, unsureNote: '', x: 0, y: 0, rotation: 0, text: 'Bar', fontSize: 30 }

  it('matches the same wall geometry in any order, whatever the ids or other items', () => {
    expect(sameWalls([wall('a', 0), wall('b', 100)], [wall('y', 100), wall('x', 0), label])).toBe(true)
  })

  it('tells moved, thicker, added or removed walls apart', () => {
    expect(sameWalls([wall('a', 0)], [wall('a', 1)])).toBe(false)
    expect(sameWalls([wall('a', 0)], [wall('a', 0, 30)])).toBe(false)
    expect(sameWalls([wall('a', 0)], [wall('a', 0), wall('b', 5)])).toBe(false)
    expect(sameWalls([wall('a', 0)], [])).toBe(false)
  })
})

describe('restoredName', () => {
  it('adds (restored) and stays within the limit', () => {
    expect(restoredName('Hall')).toBe('Hall (restored)')
    expect(restoredName('x'.repeat(200))).toHaveLength(200)
  })
})

describe('backup schemas', () => {
  const start = {
    format: 'seat-plan-backup',
    version: 1,
    wedding: { id: A, name: 'Noa & Aiden', date: null, unit: 'ft', minGapCm: 152.4 },
    guests: [],
    groups: [],
    groupMembers: [],
    rules: [],
    ruleGuests: [],
  }

  it('refuses an id used twice across guests, groups and rules, and two groups with one name', () => {
    const twice = restoreStartSchema.safeParse({
      ...start,
      guests: [guest(B)],
      groups: [
        { id: B, name: 'Friends', color: '#2563eb' },
        { id: C, name: 'friends', color: '#2563eb' },
      ],
    })
    expect(twice.success).toBe(false)
    expect(twice.error?.issues.map((i) => i.message)).toEqual([`The id ${B} appears twice`, 'Two groups are named friends'])
  })

  it('refuses next to each other on an apart rule', () => {
    const parsed = restoreStartSchema.safeParse({ ...start, rules: [{ id: R1, ...rule, nextToEachOther: true }] })
    expect(parsed.success).toBe(false)
  })

  it('reads a whole file and cleans its text', () => {
    const parsed = backupFileSchema.parse({
      ...start,
      exportedAt: '2026-11-10T12:00:00.000Z',
      guests: [{ ...guest(B), firstName: '  Zoë ', nickname: '' }],
      layouts: [],
      templates: [],
      images: [],
    })
    expect(parsed.guests[0]).toMatchObject({ firstName: 'Zoë', nickname: null })
  })
})
