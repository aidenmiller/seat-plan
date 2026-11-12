import { describe, expect, it } from 'vitest'
import { emptyCanvas, type ChairRow, type Item, type Table } from '@/domain/canvas-schema'
import { resolveArrow, withEnds } from '@/domain/arrows'
import { makeNote } from '@/domain/notes'
import { makeItem } from '@/domain/presets'
import { chairRowSeatCenters } from '@/domain/seating'
import { seatLayout } from '@/domain/seats'
import { defaultLayers } from '../state/device-view'
import { hitTest, isTableTarget, itemsInBox, selectableIds, unlockedLayers } from './hit-test'

/** A note author: the signed-in user's name and account id. */
const NOA = { name: 'Noa', id: '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a' }

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

  it('finds a ceremony chair as a seat, and the row between its chairs (review finding)', () => {
    const row: ChairRow = {
      id: 'r',
      kind: 'chairRow',
      x: 0,
      y: 300,
      rotation: 0,
      locked: false,
      chairCount: 5,
      spacing: 50.8,
      blockId: null,
      blockLabel: null,
      rowNumber: 1,
      rowLabel: '',
      reservedFor: null,
      seats: Array.from({ length: 5 }, (_, index) => ({ index, guestId: index === 2 ? G1 : null })),
    }
    const c = canvasOf([row])
    const chairs = chairRowSeatCenters(row)
    const jane = hitTest(c, chairs[2])
    expect(jane).toEqual({ kind: 'seat', itemId: 'r', seatIndex: 2, guestId: G1, locked: false, itemKind: 'chairRow' })
    expect(isTableTarget(jane)).toBe(false)
    expect(hitTest(c, { x: chairs[1].x + 2, y: chairs[1].y })).toMatchObject({ kind: 'seat', seatIndex: 1, guestId: null })
    // Turned rows too.
    const turned = { ...row, rotation: 90 }
    expect(hitTest(canvasOf([turned]), chairRowSeatCenters(turned)[2])).toMatchObject({ kind: 'seat', seatIndex: 2, guestId: G1 })
    // A table's seat is still a table target.
    expect(isTableTarget(hitTest(canvasOf([seated]), seatLayout(seated)[0]))).toBe(true)
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
    const c = canvasOf([seated])
    const layers = defaultLayers()
    layers.furniture.visible = false
    expect(hitTest(c, { x: 0, y: 0 }, { layers }).kind).toBe('empty')
    layers.furniture = { visible: true, locked: true }
    expect(hitTest(c, { x: 10, y: 10 }, { layers }).kind).toBe('empty')
    expect(hitTest(c, seatLayout(seated)[0], { layers }).kind).toBe('empty')
    // With the locks off (View mode), the table is there again.
    expect(hitTest(c, { x: 10, y: 10 }, { layers: unlockedLayers(layers) })).toEqual({ kind: 'item', itemId: 't', itemKind: 'table', locked: false })
    expect(selectableIds(c, layers)).toEqual([])
    expect(itemsInBox(c, { minX: -500, minY: -500, maxX: 500, maxY: 500 }, layers)).toEqual([])
  })

  describe('notes', () => {
    const NOW = Date.UTC(2026, 10, 10)
    const sticky = makeNote('sticky', { x: 0, y: 0 }, NOA, 'yellow', NOW, 'n')

    it('finds notes above the furniture, but not on a hidden notes layer', () => {
      const c = canvasOf([t, sticky])
      expect(hitTest(c, { x: 10, y: 10 }, { layers: defaultLayers() })).toEqual({ kind: 'item', itemId: 'n', itemKind: 'note', locked: false })
      const hidden = defaultLayers()
      hidden.notes.visible = false
      expect(hitTest(c, { x: 10, y: 10 }, { layers: hidden })).toMatchObject({ itemId: 't' })
      expect(selectableIds(c, hidden)).toEqual(['t'])
      expect(itemsInBox(c, { minX: -500, minY: -500, maxX: 500, maxY: 500 }, hidden)).toEqual(['t'])
    })

    it('lets a finger reach further to an arrow or line than to anything else', () => {
      const line = makeNote('line', { x: 0, y: 1000 }, NOA, 'grey', NOW, 'l')
      const box = makeItem('box', { x: 0, y: 2000 }, 'b', emptyCanvas())
      const c = canvasOf([line, box])
      const options = { tolerance: 4, lineTolerance: 20 }
      expect(hitTest(c, { x: 0, y: 1015 }, { tolerance: 4 }).kind).toBe('empty')
      expect(hitTest(c, { x: 0, y: 1015 }, options)).toMatchObject({ itemId: 'l' })
      // Other items keep the plain reach.
      // 15 cm past the 4 ft box.
      expect(hitTest(c, { x: 0, y: 2000 - 60.96 - 15 }, options).kind).toBe('empty')
    })

    it('finds a note before a table added after it, as the notes layer draws on top', () => {
      const c = canvasOf([sticky, t])
      expect(hitTest(c, { x: 10, y: 10 }, { layers: defaultLayers() })).toMatchObject({ itemId: 'n' })
      // Off the note, the table is still there.
      expect(hitTest(c, { x: 100, y: 0 }, { layers: defaultLayers() })).toMatchObject({ itemId: 't' })
    })

    it('passes through notes on a locked notes layer to the furniture under them', () => {
      const c = canvasOf([t, sticky])
      const locked = defaultLayers()
      locked.notes.locked = true
      expect(hitTest(c, { x: 10, y: 10 }, { layers: locked })).toMatchObject({ itemId: 't', locked: false })
      expect(hitTest(c, { x: 100, y: 0 }, { layers: locked })).toMatchObject({ itemId: 't', locked: false })
      expect(hitTest(c, { x: 10, y: 10 }, { layers: unlockedLayers(locked) })).toMatchObject({ itemId: 'n', locked: false })
      expect(selectableIds(c, locked)).toEqual(['t'])
      expect(itemsInBox(c, { minX: -500, minY: -500, maxX: 500, maxY: 500 }, locked)).toEqual(['t'])
    })

    it('finds a note above a chair row and a table seat, and a locked notes layer lets the press through to the seat', () => {
      const row: ChairRow = {
        id: 'r',
        kind: 'chairRow',
        x: 0,
        y: 600,
        rotation: 0,
        locked: false,
        chairCount: 3,
        spacing: 50.8,
        blockId: null,
        blockLabel: null,
        rowNumber: 1,
        rowLabel: '',
        reservedFor: null,
        seats: Array.from({ length: 3 }, (_, index) => ({ index, guestId: index === 1 ? G1 : null })),
      }
      const chair = chairRowSeatCenters(row)[1]
      const seat = seatLayout(seated)[0]
      // Notes added first: the notes layer still draws, and is hit, above both.
      const onChair = makeNote('sticky', chair, NOA, 'yellow', NOW, 'nc')
      const onSeat = makeNote('sticky', seat, NOA, 'yellow', NOW, 'ns')
      const c = canvasOf([onChair, onSeat, seated, row])
      const open = defaultLayers()
      expect(hitTest(c, chair, { layers: open })).toMatchObject({ kind: 'item', itemId: 'nc', itemKind: 'note' })
      expect(hitTest(c, seat, { layers: open })).toMatchObject({ kind: 'item', itemId: 'ns', itemKind: 'note' })
      const locked = defaultLayers()
      locked.notes.locked = true
      expect(hitTest(c, chair, { layers: locked })).toEqual({ kind: 'seat', itemId: 'r', seatIndex: 1, guestId: G1, locked: false, itemKind: 'chairRow' })
      expect(hitTest(c, seat, { layers: locked })).toEqual({ kind: 'seat', itemId: 't', seatIndex: 0, guestId: G1, locked: false })
      // A locked arrow over the row lets the press through too.
      const arrow = withEnds(makeNote('arrow', { x: 0, y: 0 }, NOA, 'blue', NOW, 'a'), { x: -300, y: chair.y }, { x: 300, y: chair.y })
      expect(hitTest(canvasOf([row, arrow]), chair, { layers: open })).toMatchObject({ itemId: 'a' })
      expect(hitTest(canvasOf([row, arrow]), chair, { layers: locked })).toMatchObject({ kind: 'seat', itemId: 'r', seatIndex: 1 })
    })

    it('hits an attached arrow where it is drawn, not where it was stored', () => {
      const base = makeNote('arrow', { x: 0, y: 0 }, NOA, 'blue', NOW, 'a')
      // Stored running along y = 500; its start holds table t, so it is drawn from t's chairs to (600, 500).
      const arrow = withEnds({ ...base, attachedTo: { start: 't', end: null } }, { x: -600, y: 500 }, { x: 600, y: 500 })
      const c = canvasOf([t, arrow])
      const drawn = resolveArrow(arrow, c)
      const mid = { x: (drawn.start.x + drawn.end.x) / 2, y: (drawn.start.y + drawn.end.y) / 2 }
      expect(hitTest(c, mid, { tolerance: 2 })).toMatchObject({ itemId: 'a' })
      expect(hitTest(c, { x: -500, y: 500 }, { tolerance: 2 }).kind).toBe('empty')
      expect(itemsInBox(c, { minX: 50, minY: 0, maxX: 700, maxY: 600 })).toEqual(['a'])
      // The stored start at (-600, 500) is not part of it.
      expect(itemsInBox(c, { minX: -700, minY: 400, maxX: -500, maxY: 600 })).toEqual([])
    })
  })

  it('boxes only unlocked items held whole', () => {
    const a = makeItem('box', { x: 0, y: 0 }, 'a', emptyCanvas())
    const b = { ...makeItem('box', { x: 200, y: 0 }, 'b', emptyCanvas()), locked: true }
    const c = canvasOf([a, b])
    expect(itemsInBox(c, { minX: -100, minY: -100, maxX: 300, maxY: 100 })).toEqual(['a'])
    expect(itemsInBox(c, { minX: -10, minY: -10, maxX: 300, maxY: 100 })).toEqual([])
  })
})
