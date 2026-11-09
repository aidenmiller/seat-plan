import { describe, expect, it } from 'vitest'
import type { Fixture, Item, Table } from './canvas-schema'
import { alignDeltas, alignItems, distributeDeltas, distributeItems } from './align'
import { footprintBox, itemBox } from './geometry'
import { CHAIR_DEPTH_CM, emptySeats } from './seats'

function fixture(id: string, x: number, y: number, width = 100, height = 50, locked = false): Fixture {
  return { id, kind: 'fixture', type: 'bar', x, y, rotation: 0, locked, width, height, label: 'Bar' }
}

function round(id: string, x: number, y: number): Table {
  return {
    id,
    kind: 'table',
    shape: 'round',
    x,
    y,
    rotation: 0,
    locked: false,
    width: 152.4,
    height: 152.4,
    number: 1,
    name: 'Table 1',
    seatCount: 8,
    seatSides: 'all',
    seats: emptySeats(8),
  }
}

const three = [fixture('a', 0, 0), fixture('b', 300, 100, 200, 100), fixture('c', 150, -200, 50, 20)]

describe('align', () => {
  it('lines up left, center and right edges', () => {
    const left = alignItems(three, 'left')
    expect(left.map((i) => footprintBox(i).minX)).toEqual([-50, -50, -50])
    const right = alignItems(three, 'right')
    expect(right.map((i) => footprintBox(i).maxX)).toEqual([400, 400, 400])
    const center = alignItems(three, 'center')
    // The selection runs from -50 to 400.
    expect(center.map((i) => i.x)).toEqual([175, 175, 175])
    expect(left.map((i) => i.y)).toEqual([0, 100, -200])
  })

  it('lines up top, middle and bottom edges', () => {
    expect(alignItems(three, 'top').map((i) => footprintBox(i).minY)).toEqual([-210, -210, -210])
    expect(alignItems(three, 'bottom').map((i) => footprintBox(i).maxY)).toEqual([150, 150, 150])
    expect(alignItems(three, 'middle').map((i) => i.y)).toEqual([-30, -30, -30])
  })

  it('never moves locked items, though they still count', () => {
    const items = [fixture('a', 0, 0), fixture('b', 300, 0, 100, 50, true)]
    const right = alignItems(items, 'right')
    expect(right[1]).toBe(items[1])
    expect(footprintBox(right[0]).maxX).toBe(350)
  })

  it('counts a table by its chairs, or by its top when asked', () => {
    const items: Item[] = [round('t', 0, 0), fixture('f', 400, 0)]
    const byChairs = alignItems(items, 'left')
    expect(footprintBox(byChairs[1]).minX).toBeCloseTo(-76.2 - CHAIR_DEPTH_CM, 9)
    const byTop = alignItems(items, 'left', itemBox)
    expect(itemBox(byTop[1]).minX).toBeCloseTo(-76.2, 9)
  })

  it('moves nothing for one item and keeps unmoved items as they were', () => {
    expect(alignItems([three[0]], 'left')[0]).toBe(three[0])
    const items = [fixture('a', 0, 0), fixture('b', 0, 300)]
    const left = alignItems(items, 'left')
    expect(left[0]).toBe(items[0])
    expect(left[1]).toBe(items[1])
    expect(alignDeltas([], 'top')).toEqual([])
  })
})

describe('distribute', () => {
  it('leaves equal gaps between neighbors, first and last fixed', () => {
    const items = [fixture('a', 0, 0, 100), fixture('b', 120, 50, 40), fixture('c', 1000, 0, 200), fixture('d', 300, 0, 60)]
    const out = distributeItems(items, 'horizontal')
    expect(out[0]).toBe(items[0])
    expect(out[2]).toBe(items[2])
    const boxes = out.map(footprintBox).sort((p, q) => p.minX - q.minX)
    const gaps = boxes.slice(1).map((b, i) => b.minX - boxes[i].maxX)
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0], 9)
    // Order along the axis is kept; y is untouched.
    expect(out.map((i) => i.y)).toEqual([0, 50, 0, 0])
  })

  it('works up and down too', () => {
    const items = [fixture('a', 0, 0), fixture('b', 0, 90), fixture('c', 0, 1000)]
    const out = distributeItems(items, 'vertical')
    expect(out[1].y).toBeCloseTo(500, 9)
    expect(out[1].x).toBe(0)
  })

  it('needs three items and leaves locked ones put', () => {
    expect(distributeDeltas([], 'horizontal')).toEqual([])
    const two = [fixture('a', 0, 0), fixture('b', 500, 0)]
    expect(distributeItems(two, 'horizontal')).toEqual(two)
    const items = [fixture('a', 0, 0), fixture('b', 100, 0, 100, 50, true), fixture('c', 1000, 0)]
    expect(distributeItems(items, 'horizontal')[1]).toBe(items[1])
  })
})
