import { describe, expect, it } from 'vitest'
import {
  addFixedItem,
  bringFixedToFront,
  deleteFixedItems,
  duplicateFixedItems,
  emptyTemplateDoc,
  fixedItemLabel,
  fixedItemsInBox,
  makeAtPoint,
  makeFromRect,
  makePolyItem,
  markChecked,
  moveFixedItems,
  nearestSegment,
  patchFixedItem,
  removeVertex,
  resizeBoxItem,
  rotateFixedItem,
  setReferenceOpacity,
  setSideLength,
  setVertex,
  snapOpening,
  templateBox,
  vertexAt,
  type TemplateDoc,
} from './template-commands'
import type { FixedItem } from './venue-schema'

const flags = { unsure: false, unsureNote: '' }
const wall = (id: string, points: [number, number][], thickness = 20): FixedItem => ({
  id,
  type: 'wall',
  points: points.map(([x, y]) => ({ x, y })),
  thickness,
  ...flags,
})

function doc(...items: FixedItem[]): TemplateDoc {
  return { items, reference: null }
}

function get(d: TemplateDoc, id: string) {
  return d.items.find((i) => i.id === id)!
}

describe('making items', () => {
  it('makes a wall from clicked points, dropping repeats', () => {
    const w = makePolyItem('wall', [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 500, y: 0 }], 'w')
    expect(w).toMatchObject({ type: 'wall', points: [{ x: 0, y: 0 }, { x: 500, y: 0 }], thickness: 15 })
  })

  it('needs 3 corners for a room and drops a closing repeat of the first', () => {
    expect(makePolyItem('room', [{ x: 0, y: 0 }, { x: 100, y: 0 }], 'r')).toBeNull()
    const r = makePolyItem('room', [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 0 }], 'r')
    expect(r?.points).toHaveLength(3)
  })

  it('drags a rectangle into a room, a column or a bar', () => {
    const room = makeFromRect('room', { x: 300, y: 200 }, { x: 0, y: 0 }, 'r')
    expect(room).toMatchObject({ type: 'room', points: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 200 }, { x: 0, y: 200 }] })
    expect(makeFromRect('roundColumn', { x: 0, y: 0 }, { x: 40, y: 40 }, 'c')).toMatchObject({ type: 'column', shape: 'round', x: 20, y: 20, width: 40 })
    expect(makeFromRect('bar', { x: 0, y: 0 }, { x: 5, y: 40 }, 'b')).toBeNull()
  })

  it('drops a door near a wall onto it, turned along it', () => {
    const items = [wall('w', [[0, 0], [0, 600]])]
    const door = makeAtPoint('door', { x: 40, y: 300 }, items, 'd')
    expect(door).toMatchObject({ type: 'door', wallId: 'w', x: 0, y: 300, rotation: 90 })
  })

  it('leaves a window far from every wall where it was dropped', () => {
    const items = [wall('w', [[0, 0], [600, 0]])]
    const win = makeAtPoint('window', { x: 300, y: 900 }, items, 'n')
    expect(win).toMatchObject({ wallId: null, x: 300, y: 900, rotation: 0 })
  })

  it('names items plainly', () => {
    expect(fixedItemLabel({ ...(makePolyItem('room', [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], 'r') as FixedItem), name: 'Main Room' })).toBe(
      'Room: Main Room',
    )
    expect(fixedItemLabel(makeAtPoint('roundColumn', { x: 0, y: 0 }, [], 'c')!)).toBe('Round column')
  })
})

describe('editing', () => {
  it('puts rooms under walls when added', () => {
    const w = wall('w', [[0, 0], [100, 0]])
    const room = makeFromRect('room', { x: 0, y: 0 }, { x: 100, y: 100 }, 'r')!
    const d = addFixedItem(doc(w), room)
    expect(d.items.map((i) => i.id)).toEqual(['r', 'w'])
  })

  it('moves a wall and the door on it together', () => {
    const items = [wall('w', [[0, 0], [600, 0]])]
    const door = makeAtPoint('door', { x: 300, y: 10 }, items, 'd')!
    const d = moveFixedItems(doc(...items, door), ['w'], 0, 50)
    expect((get(d, 'w') as Extract<FixedItem, { type: 'wall' }>).points[0]).toEqual({ x: 0, y: 50 })
    expect(get(d, 'd')).toMatchObject({ x: 300, y: 50 })
  })

  it('keeps a door on its wall when a wall point moves', () => {
    const items = [wall('w', [[0, 0], [600, 0]])]
    const door = makeAtPoint('door', { x: 300, y: 0 }, items, 'd')!
    const d = setVertex(doc(...items, door), 'w', 1, { x: 600, y: 600 })
    const moved = get(d, 'd') as Extract<FixedItem, { type: 'door' }>
    // Projected onto the new diagonal line.
    expect(moved.x).toBeCloseTo(150)
    expect(moved.y).toBeCloseTo(150)
    expect(moved.rotation).toBeCloseTo(45)
  })

  it('sets a side length by moving its far end, the closing side of a room included', () => {
    const room = makeFromRect('room', { x: 0, y: 0 }, { x: 400, y: 300 }, 'r')!
    let d = setSideLength(doc(room), 'r', 0, 500)
    expect((get(d, 'r') as Extract<FixedItem, { type: 'room' }>).points[1]).toEqual({ x: 500, y: 0 })
    d = setSideLength(doc(room), 'r', 3, 600)
    expect((get(d, 'r') as Extract<FixedItem, { type: 'room' }>).points[0]).toEqual({ x: 0, y: -300 })
  })

  it('finds the nearest side and a point under the pointer', () => {
    const room = makeFromRect('room', { x: 0, y: 0 }, { x: 400, y: 300 }, 'r') as Extract<FixedItem, { type: 'room' }>
    expect(nearestSegment(room, { x: 200, y: 290 })).toBe(2)
    expect(nearestSegment(room, { x: 5, y: 150 })).toBe(3)
    expect(vertexAt(room, { x: 398, y: 4 }, 10)).toBe(1)
    expect(vertexAt(room, { x: 200, y: 150 }, 10)).toBeNull()
  })

  it('removes a point only while enough remain', () => {
    const w = wall('w', [[0, 0], [100, 0], [100, 100]])
    const d = removeVertex(doc(w), 'w', 1)
    expect((get(d, 'w') as Extract<FixedItem, { type: 'wall' }>).points).toHaveLength(2)
    expect(removeVertex(d, 'w', 0)).toBe(d)
  })

  it('patches fields and refuses invalid ones', () => {
    const d0 = doc(wall('w', [[0, 0], [100, 0]]))
    const d1 = patchFixedItem(d0, 'w', { thickness: 30, name: 'North wall' })
    expect(get(d1, 'w')).toMatchObject({ thickness: 30, name: 'North wall' })
    expect(patchFixedItem(d0, 'w', { thickness: -1 })).toBe(d0)
    expect(patchFixedItem(d0, 'w', { type: 'room' })).toBe(d0)
    expect(patchFixedItem(d1, 'w', { thickness: 30 })).toBe(d1)
  })

  it('unties doors from a deleted wall and keeps them', () => {
    const items = [wall('w', [[0, 0], [600, 0]])]
    const door = makeAtPoint('door', { x: 300, y: 0 }, items, 'd')!
    const d = deleteFixedItems(doc(...items, door), ['w'])
    expect(d.items).toHaveLength(1)
    expect(get(d, 'd')).toMatchObject({ wallId: null })
  })

  it('duplicates a wall with its door, the copy tied to the copied wall', () => {
    const items = [wall('w', [[0, 0], [600, 0]])]
    const door = makeAtPoint('door', { x: 300, y: 0 }, items, 'd')!
    let n = 0
    const r = duplicateFixedItems(doc(...items, door), ['w', 'd'], () => `c${++n}`, 30, 30)
    expect(r.ids).toEqual(['c1', 'c2'])
    expect(get(r.doc, 'c2')).toMatchObject({ wallId: 'c1', x: 330, y: 30 })
  })

  it('moves items to the front', () => {
    const d = doc(wall('a', [[0, 0], [1, 0]]), wall('b', [[0, 0], [1, 0]]))
    expect(bringFixedToFront(d, ['a']).items.map((i) => i.id)).toEqual(['b', 'a'])
    expect(bringFixedToFront(d, ['b'])).toBe(d)
  })

  it('selects whole items inside a box', () => {
    const items = [wall('a', [[0, 0], [100, 0]], 10), wall('b', [[0, 0], [900, 0]], 10)]
    expect(fixedItemsInBox(items, { minX: -10, minY: -10, maxX: 200, maxY: 10 })).toEqual(['a'])
  })

  it('snaps a door back onto the nearest wall', () => {
    const items = [wall('w', [[0, 0], [600, 0]])]
    const door = { ...makeAtPoint('door', { x: 300, y: 0 }, items, 'd')!, x: 200, y: 60 } as Extract<FixedItem, { type: 'door' }>
    expect(snapOpening(door, items)).toMatchObject({ x: 200, y: 0, wallId: 'w' })
  })
})

describe('handles', () => {
  it('resizes a column from a corner, the far corner kept', () => {
    const col = makeAtPoint('column', { x: 0, y: 0 }, [], 'c') as Extract<FixedItem, { type: 'column' }>
    const r = resizeBoxItem(col, 'se', { x: 100, y: 100 })
    expect(r.x - r.width / 2).toBeCloseTo(-col.width / 2)
    expect(r.width).toBeCloseTo(100 + col.width / 2)
  })

  it('turns a bar in 15 degree steps', () => {
    const bar = makeAtPoint('bar', { x: 0, y: 0 }, [], 'b') as Extract<FixedItem, { type: 'bar' }>
    expect(rotateFixedItem(bar, { x: 100, y: 3 }).rotation).toBe(90)
    expect(rotateFixedItem(bar, { x: 0, y: -100 })).toBe(bar)
  })
})

describe('scale and reference', () => {
  it('moves the reference image with the plan when every item moves, so the two still line up', () => {
    const items = [wall('w', [[0, 0], [600, 0]])]
    const door = makeAtPoint('door', { x: 300, y: 0 }, items, 'd')!
    const label = makeAtPoint('label', { x: 50, y: 50 }, [], 'l')!
    const image = { width: 300, height: 100 }
    const d0: TemplateDoc = { items: [...items, door, label], reference: { scaleCmPerPx: 2, offsetX: 0, offsetY: 0, rotation: 0, opacity: 0.5 } }
    const before = templateBox(d0, image)!

    // Select all (the door rides along with its wall either way), dragged 6 m.
    const d = moveFixedItems(d0, ['w', 'l'], 600, -40)
    expect(d.reference).toMatchObject({ offsetX: 600, offsetY: -40, scaleCmPerPx: 2 })
    expect(templateBox(d, image)).toEqual({ minX: before.minX + 600, minY: before.minY - 40, maxX: before.maxX + 600, maxY: before.maxY - 40 })
    // The wall still sits where it did on the image.
    const w = get(d, 'w') as Extract<FixedItem, { type: 'wall' }>
    expect(w.points[0].x - d.reference!.offsetX).toBe(0)

    // Moving part of the plan leaves the image where it is.
    expect(moveFixedItems(d0, ['l'], 100, 0).reference).toBe(d0.reference)
    // No image, nothing to move with it.
    expect(moveFixedItems({ ...d0, reference: null }, ['w', 'l'], 5, 5).reference).toBeNull()
  })

  it('clamps the reference opacity and leaves a template without one alone', () => {
    const d0: TemplateDoc = { items: [], reference: { scaleCmPerPx: 1, offsetX: 0, offsetY: 0, rotation: 0, opacity: 0.5 } }
    expect(setReferenceOpacity(d0, 1.4).reference?.opacity).toBe(1)
    expect(setReferenceOpacity(emptyTemplateDoc(), 0.2)).toEqual(emptyTemplateDoc())
  })

  it('marks an unsure item checked', () => {
    const d0 = doc({ ...wall('w', [[0, 0], [1, 0]]), unsure: true, unsureNote: 'Faint line' })
    expect(get(markChecked(d0, 'w'), 'w')).toMatchObject({ unsure: false, unsureNote: '' })
  })

  it('frames the items and the reference image', () => {
    const d: TemplateDoc = { items: [wall('w', [[0, 0], [100, 0]], 10)], reference: { scaleCmPerPx: 2, offsetX: 0, offsetY: 0, rotation: 0, opacity: 1 } }
    expect(templateBox(d, { width: 400, height: 100 })).toEqual({ minX: -5, minY: -5, maxX: 800, maxY: 200 })
    expect(templateBox(emptyTemplateDoc())).toBeNull()
  })
})
