import { describe, expect, it } from 'vitest'
import type { Canvas } from './canvas-schema'
import type { FixedItem } from './venue-schema'
import { buildShareView, type ShareViewInput } from './share-view'

const ANN = '00000000-0000-4000-8000-0000000000a1'
const BEN = '00000000-0000-4000-8000-0000000000b1'
const GONE = '00000000-0000-4000-8000-0000000000c1'

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
      name: 'Family',
      seatCount: 3,
      seatSides: 'all',
      seats: [
        { index: 0, guestId: ANN, pinned: true },
        { index: 1, guestId: GONE },
        { index: 2, guestId: null },
      ],
    },
    { id: 'f1', kind: 'fixture', x: 0, y: 0, rotation: 0, locked: false, type: 'bar', width: 200, height: 60, label: 'Bar' },
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
      seats: [{ index: 0, guestId: BEN }],
    },
    {
      id: 's1',
      kind: 'shape',
      x: 0,
      y: 0,
      rotation: 0,
      locked: false,
      type: 'rect',
      width: 10,
      height: 10,
      text: 'lounge for the ex',
      style: { stroke: '#000', fill: 'none', strokeWidth: 1 },
    },
    {
      id: 's2',
      kind: 'shape',
      x: 0,
      y: 0,
      rotation: 0,
      locked: false,
      type: 'text',
      width: 10,
      height: 10,
      text: 'secret text',
      style: { stroke: '#000', fill: 'none', strokeWidth: 1 },
    },
    {
      id: 'n1',
      kind: 'note',
      x: 0,
      y: 0,
      rotation: 0,
      locked: false,
      type: 'sticky',
      width: 100,
      height: 100,
      text: 'Keep Uncle Bob away from the bar',
      color: 'yellow',
      author: 'Noa',
      done: false,
      createdAt: '2026-11-10T10:00:00.000Z',
      attachedTo: { start: null, end: null },
    },
  ],
}

const venue: FixedItem[] = [
  { id: 'w1', type: 'wall', unsure: true, unsureNote: 'maybe a curtain', thickness: 20, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
]

function input(over: Partial<ShareViewInput> = {}): ShareViewInput {
  return {
    layoutName: 'Dinner',
    kind: 'reception',
    unit: 'ft',
    updatedAt: '2026-11-10T10:00:00.000Z',
    canvas,
    venue,
    guests: [
      { id: ANN, firstName: 'Ann', lastName: 'Lee', meal: 'Fish', isChild: false },
      { id: BEN, firstName: 'Ben', lastName: 'Ray', meal: null, isChild: true },
    ],
    showNames: true,
    showNotes: false,
    ...over,
  }
}

describe('buildShareView', () => {
  it('sends names, meals and child flags under short keys, never guest ids', () => {
    const view = buildShareView(input())
    expect(view.guests).toEqual([
      { key: 'g1', name: 'Ann Lee', meal: 'Fish', isChild: false },
      { key: 'g2', name: 'Ben Ray', meal: null, isChild: true },
    ])
    const table = view.items.find((i) => i.id === 't1')
    expect(table).toMatchObject({ name: 'Family', seats: [{ index: 0, guestId: 'g1' }, { index: 1, guestId: null }, { index: 2, guestId: null }] })
    const text = JSON.stringify(view)
    expect(text).not.toContain(ANN)
    expect(text).not.toContain(BEN)
    expect(text).not.toContain('pinned')
  })

  it('hides every name when names are off, and keeps meals and child flags', () => {
    const view = buildShareView(input({ showNames: false }))
    expect(view.guests).toEqual([
      { key: 'g1', meal: 'Fish', isChild: false },
      { key: 'g2', meal: null, isChild: true },
    ])
    const text = JSON.stringify(view)
    expect(text).not.toContain('Ann')
    expect(text).not.toContain('Lee')
  })

  it('leaves notes out unless they are on, and never sends shape text', () => {
    const off = JSON.stringify(buildShareView(input()))
    expect(off).not.toContain('Uncle Bob')
    expect(off).not.toContain('secret text')
    expect(off).not.toContain('lounge for the ex')
    const on = buildShareView(input({ showNotes: true }))
    expect(on.items.map((i) => i.id)).toEqual(['t1', 'f1', 'r1', 's1', 'n1'])
  })

  it('keeps the venue walls without the import notes', () => {
    expect(buildShareView(input()).venue).toEqual([{ ...venue[0], unsure: false, unsureNote: '' }])
  })
})
