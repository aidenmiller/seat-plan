import { describe, expect, it } from 'vitest'
import { emptyCanvas, type Item, type Table } from '@/domain/canvas-schema'
import { makeItem } from '@/domain/presets'
import { seatLayout } from '@/domain/seats'
import { defaultLayers } from '../state/device-view'
import { hitTest, itemsInBox, selectableIds } from './hit-test'

const G1 = '00000000-0000-4000-8000-000000000001'

function canvasOf(items: Item[]) {
  return { ...emptyCanvas(), items }
}

describe('hit testing', () => {
  const t = makeItem('round', { x: 0, y: 0 }, 't', emptyCanvas()) as Table
  const seated: Table = { ...t, seats: t.seats.map((s, i) => (i === 0 ? { ...s, guestId: G1 } : s)) }

  it('finds a seat before the table body, and the body itself', () => {
    const c = canvasOf([seated])
    const seat0 = seatLayout(seated)[0]
    expect(hitTest(c, seat0)).toEqual({ kind: 'seat', itemId: 't', seatIndex: 0, guestId: G1, locked: false })
    expect(hitTest(c, { x: 10, y: 10 })).toEqual({ kind: 'item', itemId: 't', itemKind: 'table', locked: false })
    expect(hitTest(c, { x: 500, y: 500 })).toEqual({ kind: 'empty' })
  })

  it('takes the topmost item', () => {
    const box = makeItem('box', { x: 0, y: 0 }, 'b', emptyCanvas())
    expect(hitTest(canvasOf([t, box]), { x: 0, y: 0 })).toMatchObject({ itemId: 'b' })
    expect(hitTest(canvasOf([box, t]), { x: 0, y: 0 })).toMatchObject({ itemId: 't' })
  })

  it('reaches a few pixels past the edge with a tolerance', () => {
    const c = canvasOf([makeItem('box', { x: 0, y: 0 }, 'b', emptyCanvas())])
    expect(hitTest(c, { x: 64, y: 0 }).kind).toBe('empty')
    expect(hitTest(c, { x: 64, y: 0 }, { tolerance: 4 }).kind).toBe('item')
  })

  it('skips hidden and locked layers', () => {
    const c = canvasOf([t])
    const layers = defaultLayers()
    layers.furniture.visible = false
    expect(hitTest(c, { x: 0, y: 0 }, { layers }).kind).toBe('empty')
    layers.furniture = { visible: true, locked: true }
    expect(hitTest(c, { x: 0, y: 0 }, { layers }).kind).toBe('empty')
    expect(selectableIds(c, layers)).toEqual([])
  })

  it('boxes only unlocked items held whole', () => {
    const a = makeItem('box', { x: 0, y: 0 }, 'a', emptyCanvas())
    const b = { ...makeItem('box', { x: 200, y: 0 }, 'b', emptyCanvas()), locked: true }
    const c = canvasOf([a, b])
    expect(itemsInBox(c, { minX: -100, minY: -100, maxX: 300, maxY: 100 })).toEqual(['a'])
    expect(itemsInBox(c, { minX: -10, minY: -10, maxX: 300, maxY: 100 })).toEqual([])
  })
})
