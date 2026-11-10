import { describe, expect, it } from 'vitest'
import { canvasSchema, emptyCanvas, type Canvas, type Item, type Note, type Shape, type Table } from '@/domain/canvas-schema'
import { resolveArrow, storedEnds, withEnds } from '@/domain/arrows'
import { distance, footprintBox } from '@/domain/geometry'
import { makeNote } from '@/domain/notes'
import { handlePoint } from '@/domain/resize'
import { makeItem } from '@/domain/presets'
import { seatLayout, seatLocalLayout, sideSeatCounts } from '@/domain/seats'
import {
  addArrow,
  addItem,
  addNote,
  addSeat,
  alignItems,
  attachArrowEnd,
  detachArrowEnd,
  moveArrowEnd,
  setNoteColor,
  setNoteDone,
  setNoteText,
  toggleNoteDone,
  bringToFront,
  deleteItems,
  distributeItems,
  duplicateItems,
  fitSeats,
  moveItems,
  nudgeItems,
  pasteItems,
  removeSeat,
  renameTable,
  resizeItem,
  resizeItemFromCenter,
  rotateItem,
  sendToBack,
  setItemBox,
  setLabel,
  setLocked,
  setSeatCount,
  setSeatSides,
  setStyle,
  setTableNumber,
  snapPoint,
} from './commands'

const G = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const FT = 30.48

function canvasOf(items: Item[]): Canvas {
  return { ...emptyCanvas(), items }
}

function tableAt(preset: 'round' | 'square' | 'rect' | 'head' | 'sweetheart', id: string, x = 0, y = 0, canvas: Canvas = emptyCanvas()): Table {
  return makeItem(preset, { x, y }, id, canvas) as Table
}

function seatGuests(table: Table, guests: number): Table {
  return { ...table, seats: table.seats.map((s, i) => (i < guests ? { ...s, guestId: G(i + 1) } : s)) }
}

function tableIn(canvas: Canvas, id: string): Table {
  const t = canvas.items.find((i) => i.id === id)
  if (t?.kind !== 'table') throw new Error(`no table ${id}`)
  return t
}

function itemIn(canvas: Canvas, id: string): Item {
  const t = canvas.items.find((i) => i.id === id)
  if (!t) throw new Error(`no item ${id}`)
  return t
}

/** Gaps between neighboring seats around a round table, in cm. */
function roundGaps(table: Table): number[] {
  const seats = seatLocalLayout(table)
  return seats.map((s, i) => distance(s, seats[(i + 1) % seats.length]))
}

function counter(prefix = 'n') {
  let n = 0
  return () => `${prefix}${++n}`
}

describe('adding', () => {
  it('adds a numbered table from a preset at a point, on top', () => {
    let c = addItem(emptyCanvas(), 'round', { x: 100, y: 50 }, 'a')
    c = addItem(c, 'bar', { x: 0, y: 0 }, 'b')
    c = addItem(c, 'square', { x: 400, y: 0 }, 'c')
    expect(c.items.map((i) => i.id)).toEqual(['a', 'b', 'c'])
    expect(tableIn(c, 'a')).toMatchObject({ x: 100, y: 50, number: 1, name: 'Table 1', seatCount: 8 })
    expect(tableIn(c, 'c')).toMatchObject({ number: 2, name: 'Table 2' })
    expect(canvasSchema.safeParse(c).success).toBe(true)
  })

  it('snaps a point to the grid, without float noise', () => {
    expect(snapPoint({ x: 100, y: -20 }, FT)).toEqual({ x: 91.44, y: -30.48 })
    expect(snapPoint({ x: 12.3, y: 4 }, 0)).toEqual({ x: 12.3, y: 4 })
    expect(snapPoint({ x: -10, y: 10 }, 50)).toEqual({ x: 0, y: 0 })
  })
})

describe('moving', () => {
  const c = canvasOf([tableAt('round', 'a'), { ...tableAt('round', 'b', 500), locked: true }, tableAt('square', 'c', 1000)])

  it('moves the items and leaves locked ones where they are', () => {
    const next = moveItems(c, ['a', 'b'], 10, -20)
    expect(itemIn(next, 'a')).toMatchObject({ x: 10, y: -20 })
    expect(itemIn(next, 'b')).toBe(itemIn(c, 'b'))
    expect(itemIn(next, 'c')).toBe(itemIn(c, 'c'))
  })

  it('returns the same canvas when nothing moves', () => {
    expect(moveItems(c, ['a'], 0, 0)).toBe(c)
    expect(moveItems(c, ['b'], 10, 10)).toBe(c)
    expect(moveItems(c, ['missing'], 10, 10)).toBe(c)
  })

  it('nudges one grid step, or five with Shift, with no float noise', () => {
    let next = nudgeItems(c, ['a'], 'right', FT)
    next = nudgeItems(next, ['a'], 'right', FT)
    next = nudgeItems(next, ['a'], 'right', FT)
    expect(itemIn(next, 'a')).toMatchObject({ x: 91.44, y: 0 })
    next = nudgeItems(c, ['a', 'c'], 'up', 50, true)
    expect(itemIn(next, 'a')).toMatchObject({ x: 0, y: -250 })
    expect(itemIn(next, 'c')).toMatchObject({ x: 1000, y: -250 })
    expect(nudgeItems(c, ['b'], 'left', FT)).toBe(c)
  })
})

describe('size and turn', () => {
  it('keeps round tables round and every table at least 24 in on a side', () => {
    const c = canvasOf([tableAt('round', 'r'), tableAt('rect', 'x', 500)])
    expect(tableIn(setItemBox(c, 'r', { width: 182.88 }), 'r')).toMatchObject({ width: 182.88, height: 182.88 })
    expect(tableIn(setItemBox(c, 'r', { height: 100 }), 'r')).toMatchObject({ width: 100, height: 100 })
    expect(tableIn(setItemBox(c, 'x', { width: 10, height: 5 }), 'x')).toMatchObject({ width: 60.96, height: 60.96 })
    expect(tableIn(setItemBox(c, 'x', { x: 1, y: 2, rotation: -90 }), 'x')).toMatchObject({ x: 1, y: 2, rotation: 270 })
  })

  it('leaves locked items alone and returns the same canvas for no change', () => {
    const c = canvasOf([{ ...tableAt('round', 'r'), locked: true }, tableAt('square', 's', 400)])
    expect(setItemBox(c, 'r', { x: 50 })).toBe(c)
    expect(setItemBox(c, 's', { x: 400, rotation: 0 })).toBe(c)
    expect(resizeItem(c, 'r', 'e', { x: 200, y: 0 })).toBe(c)
    expect(rotateItem(c, 'r', { x: 100, y: 0 })).toBe(c)
    expect(resizeItemFromCenter(c, 'r', { x: 50, y: 0 }, { x: 100, y: 0 })).toBe(c)
  })

  it('scales shape points with the shape', () => {
    const line = makeItem('line', { x: 0, y: 0 }, 'l', emptyCanvas()) as Shape
    const next = setItemBox(canvasOf([line]), 'l', { width: line.width * 2 })
    expect((itemIn(next, 'l') as Shape).points).toEqual([
      { x: -182.88, y: 0 },
      { x: 182.88, y: 0 },
    ])
  })

  it('resizes from the drag start, so the drag never drifts', () => {
    const start = tableAt('rect', 'x')
    let c = canvasOf([start])
    for (const px of [300, 350, 400]) c = resizeItem(c, 'x', 'e', { x: px, y: 0 }, {}, start)
    // The west edge stays at -121.92; the east edge follows the pointer.
    expect(tableIn(c, 'x').width).toBeCloseTo(400 + 121.92, 6)
  })

  it('resizes a round table about its center with Shift+drag on its body (acceptance 11)', () => {
    const c = canvasOf([tableAt('round', 'r', 100, 100)])
    const next = tableIn(resizeItemFromCenter(c, 'r', { x: 150, y: 100 }, { x: 200, y: 100 }), 'r')
    expect(next).toMatchObject({ x: 100, y: 100 })
    // 50 cm further out: the edge follows, so the table is 100 cm wider.
    expect(next.width).toBeCloseTo(252.4, 6)
    expect(next.height).toBeCloseTo(252.4, 6)
  })

  it('turns in 15 degree steps, or freely with Alt', () => {
    const c = canvasOf([tableAt('rect', 'x')])
    // A pointer to the right of the center turns the top toward it: 90 degrees.
    expect(itemIn(rotateItem(c, 'x', { x: 100, y: 4 }), 'x').rotation).toBe(90)
    const free = itemIn(rotateItem(c, 'x', { x: 100, y: 4 }, null), 'x').rotation
    expect(free).toBeGreaterThan(90)
    expect(free).toBeLessThan(93)
  })
})

describe('delete, duplicate, paste and order', () => {
  it('deletes all but locked items and lets attached notes go', () => {
    const note: Note = {
      id: 'n',
      kind: 'note',
      type: 'arrow',
      x: 0,
      y: 0,
      rotation: 0,
      locked: false,
      width: 100,
      height: 10,
      text: '',
      color: 'yellow',
      author: 'Noa',
      done: false,
      createdAt: '2026-11-09T12:00:00.000Z',
      attachedTo: { start: 'a', end: 'b' },
    }
    const c = canvasOf([tableAt('round', 'a'), { ...tableAt('round', 'b', 500), locked: true }, note])
    const next = deleteItems(c, ['a', 'b'])
    expect(next.items.map((i) => i.id)).toEqual(['b', 'n'])
    expect((itemIn(next, 'n') as Note).attachedTo).toEqual({ start: null, end: 'b' })
    expect(deleteItems(c, ['b'])).toBe(c)
  })

  it('duplicates one grid step away with new ids, empty seats and the next numbers (PLAN changes 3 and 9)', () => {
    const a = seatGuests(tableAt('round', 'a'), 3)
    const b = { ...tableAt('square', 'b', 500, 0, canvasOf([a])), name: 'Family', locked: true }
    const c = canvasOf([a, b, makeItem('bar', { x: 0, y: 500 }, 'bar', emptyCanvas())])
    const { canvas, ids } = duplicateItems(c, ['b', 'a'], counter(), FT)
    expect(ids).toEqual(['n1', 'n2'])
    const [ca, cb] = ids.map((id) => tableIn(canvas, id))
    expect(ca).toMatchObject({ x: FT, y: FT, number: 3, name: 'Table 3', locked: false })
    expect(ca.seats.every((s) => s.guestId === null)).toBe(true)
    expect(cb).toMatchObject({ x: 500 + FT, y: FT, number: 4, name: 'Family', locked: false })
    expect(canvas.items.slice(0, 3)).toEqual(c.items)
    expect(canvasSchema.safeParse(canvas).success).toBe(true)
  })

  it('pastes centered on a point, snapped to the grid, numbered on', () => {
    const copied = [seatGuests(tableAt('round', 'a', 0, 0), 2), tableAt('round', 'b', 300, 0)]
    const target = canvasOf([{ ...tableAt('rect', 'x', -800, 0), number: 7, name: 'Table 7' }])
    const { canvas, ids } = pasteItems(target, copied, counter('p'), { at: { x: 1000, y: 1000 }, gridStep: 50 })
    const [pa, pb] = ids.map((id) => tableIn(canvas, id))
    // The pair's center (150, 0) moves to (1000, 1000): a move of (850, 1000), already on the grid.
    expect(pa).toMatchObject({ x: 850, y: 1000, number: 8 })
    expect(pb).toMatchObject({ x: 1150, y: 1000, number: 9 })
    expect(pa.seats.some((s) => s.guestId !== null)).toBe(false)
    expect(pasteItems(target, [], counter()).canvas).toBe(target)
  })

  it('pastes with an offset', () => {
    const { canvas, ids } = pasteItems(emptyCanvas(), [tableAt('round', 'a', 10, 10)], counter(), { offset: { x: FT * 2, y: FT * 2 } })
    expect(itemIn(canvas, ids[0])).toMatchObject({ x: 70.96, y: 70.96, number: 1 })
  })

  it('locks and unlocks', () => {
    const c = canvasOf([tableAt('round', 'a')])
    const locked = setLocked(c, ['a'], true)
    expect(itemIn(locked, 'a').locked).toBe(true)
    expect(setLocked(locked, ['a'], true)).toBe(locked)
  })

  it('brings to front and sends to back, keeping order among the moved items', () => {
    const c = canvasOf(['a', 'b', 'c', 'd'].map((id, i) => tableAt('round', id, i * 300)))
    expect(bringToFront(c, ['b', 'a']).items.map((i) => i.id)).toEqual(['c', 'd', 'a', 'b'])
    expect(sendToBack(c, ['d', 'c']).items.map((i) => i.id)).toEqual(['c', 'd', 'a', 'b'])
    expect(bringToFront(c, ['d'])).toBe(c)
    expect(sendToBack(c, ['a'])).toBe(c)
  })
})

describe('align and distribute', () => {
  it('lines up left edges of footprints and leaves locked items', () => {
    const c = canvasOf([tableAt('round', 'a', 0, 0), tableAt('round', 'b', 300, 400), { ...tableAt('round', 'c', 600, 800), locked: true }])
    const next = alignItems(c, ['a', 'b', 'c'], 'left')
    expect(footprintBox(itemIn(next, 'b')).minX).toBeCloseTo(footprintBox(itemIn(c, 'a')).minX, 6)
    expect(itemIn(next, 'a')).toBe(itemIn(c, 'a'))
    expect(itemIn(next, 'c')).toBe(itemIn(c, 'c'))
    expect(alignItems(c, ['a'], 'left')).toBe(c)
  })

  it('spreads three tables with equal gaps', () => {
    const c = canvasOf([tableAt('round', 'a', 0, 0), tableAt('round', 'b', 100, 0), tableAt('round', 'c', 1000, 0)])
    const next = distributeItems(c, ['a', 'b', 'c'], 'horizontal')
    expect(itemIn(next, 'b').x).toBeCloseTo(500, 6)
    expect(distributeItems(c, ['a', 'b'], 'horizontal')).toBe(c)
  })
})

describe('table names and numbers', () => {
  it('renames, and a blank name goes back to Table N', () => {
    const c = canvasOf([tableAt('round', 'a')])
    const named = renameTable(c, 'a', '  Family  ')
    expect(tableIn(named, 'a').name).toBe('Family')
    expect(tableIn(renameTable(named, 'a', '   '), 'a').name).toBe('Table 1')
    expect(renameTable(c, 'a', 'Table 1')).toBe(c)
  })

  it('lets the default name follow a new number, and keeps a chosen name (PLAN change 3)', () => {
    const c = canvasOf([tableAt('round', 'a')])
    expect(tableIn(setTableNumber(c, 'a', 5), 'a')).toMatchObject({ number: 5, name: 'Table 5' })
    const named = renameTable(c, 'a', 'Family')
    expect(tableIn(setTableNumber(named, 'a', 5), 'a')).toMatchObject({ number: 5, name: 'Family' })
    expect(tableIn(setTableNumber(c, 'a', 0), 'a').number).toBe(1)
    expect(setTableNumber(c, 'a', 1)).toBe(c)
  })
})

describe('seats', () => {
  it('gives 9 evenly spaced seats after + on an 8-seat round (acceptance 7)', () => {
    const c = canvasOf([tableAt('round', 'a')])
    const t = tableIn(addSeat(c, 'a'), 'a')
    expect(t.seatCount).toBe(9)
    expect(t.seats).toHaveLength(9)
    const gaps = roundGaps(t)
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0], 6)
  })

  it('spaces 12 seats evenly (acceptance 12)', () => {
    const c = canvasOf([{ ...tableAt('round', 'a'), width: 182.88, height: 182.88 }])
    const { canvas, refused } = setSeatCount(c, 'a', 12)
    expect(refused).toBe(false)
    const gaps = roundGaps(tableIn(canvas, 'a'))
    expect(gaps).toHaveLength(12)
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0], 6)
  })

  it('asks before dropping 12 seats with 10 seated to 8, naming 2 guests (acceptance 12)', () => {
    const t = { ...tableAt('round', 'a'), width: 182.88, height: 182.88 }
    const twelve = tableIn(setSeatCount(canvasOf([t]), 'a', 12).canvas, 'a')
    expect(twelve.seats).toHaveLength(12)
    const c = canvasOf([seatGuests(twelve, 10)])
    const asked = setSeatCount(c, 'a', 8)
    expect(asked.refused).toBe(true)
    expect(asked.canvas).toBe(c)
    expect(asked.unseated).toEqual([G(10), G(9)])
    const done = setSeatCount(c, 'a', 8, { allowUnseat: true })
    expect(done.refused).toBe(false)
    expect(done.unseated).toEqual([G(10), G(9)])
    const after = tableIn(done.canvas, 'a')
    expect(after.seatCount).toBe(8)
    expect(after.seats.filter((s) => s.guestId !== null)).toHaveLength(8)
  })

  it('removes an empty seat first, and refuses when every seat is taken', () => {
    const c = canvasOf([seatGuests(tableAt('round', 'a'), 7)])
    const one = removeSeat(c, 'a')
    expect(one).toMatchObject({ refused: false, unseated: [] })
    expect(tableIn(one.canvas, 'a').seats.filter((s) => s.guestId !== null)).toHaveLength(7)

    const full = canvasOf([seatGuests(tableAt('round', 'a'), 8)])
    const asked = removeSeat(full, 'a')
    expect(asked).toMatchObject({ refused: true, unseated: [G(8)] })
    expect(asked.canvas).toBe(full)
    expect(tableIn(removeSeat(full, 'a', { allowUnseat: true }).canvas, 'a').seatCount).toBe(7)
  })

  it('takes − from the side of a 4 + 4 rect that holds the empty seat, by button or typed count (A3)', () => {
    // Seat 1 (top) is the empty one.
    const rect = tableAt('rect', 'r')
    const t = { ...rect, seats: rect.seats.map((s, i) => (i === 1 ? s : { ...s, guestId: G(i + 1) })) }
    const sides = (table: Table) => {
      const places = seatLocalLayout(table)
      return table.seats.filter((s) => s.guestId !== null).map((s) => `${s.guestId}:${places[s.index].side}`)
    }
    for (const change of [removeSeat(canvasOf([t]), 'r'), setSeatCount(canvasOf([t]), 'r', 7)]) {
      expect(change).toMatchObject({ refused: false, unseated: [] })
      const after = tableIn(change.canvas, 'r')
      expect(sideSeatCounts(after)).toMatchObject({ top: 3, bottom: 4 })
      expect(sides(after)).toEqual(sides(t))
      expect(canvasSchema.safeParse(change.canvas).success).toBe(true)
    }
  })

  it('stops + at the seat cap', () => {
    const c = canvasOf([{ ...tableAt('round', 'a'), seatCount: 30, seats: Array.from({ length: 30 }, (_, index) => ({ index, guestId: null })) }])
    expect(addSeat(c, 'a')).toBe(c)
  })

  it('stretches the rect preset to 24 ft and fits 12 per long side, then 12 on one side (acceptance 10, Q3)', () => {
    const start = tableAt('rect', 'x')
    let c = canvasOf([start])
    // Drag the east handle out until the table is 24 ft long; the west end stays put.
    const west = -start.width / 2
    c = resizeItem(c, 'x', 'e', { x: west + 24 * FT, y: 0 }, {}, start)
    expect(tableIn(c, 'x').width).toBeCloseTo(731.52, 6)
    expect(tableIn(c, 'x').seatCount).toBe(8)

    const fitted = fitSeats(c, 'x')
    expect(fitted.refused).toBe(false)
    const t = tableIn(fitted.canvas, 'x')
    expect(t.seatCount).toBe(24)
    expect(sideSeatCounts(t)).toMatchObject({ top: 12, bottom: 12, left: 0, right: 0 })

    const oneSide = setSeatSides(fitted.canvas, 'x', 'oneSide')
    const refit = tableIn(fitSeats(oneSide, 'x', { allowUnseat: true }).canvas, 'x')
    expect(refit.seatCount).toBe(12)
    expect(sideSeatCounts(refit)).toMatchObject({ top: 12, bottom: 0 })
  })

  it('makes a round table shrunk to 36 in with 2 seats a sweetheart table (acceptance 10)', () => {
    const start = tableAt('round', 'r')
    let c = canvasOf([start])
    // Drag the south-east corner inward until the table is 91.44 cm across.
    const nw = handlePoint(start, 'nw')
    c = resizeItem(c, 'r', 'se', { x: nw.x + 91.44, y: nw.y + 91.44 }, {}, start)
    expect(tableIn(c, 'r').width).toBeCloseTo(91.44, 6)
    c = setSeatCount(c, 'r', 2).canvas
    const t = tableIn(c, 'r')
    const seats = seatLayout(t)
    expect(seats).toHaveLength(2)
    // Both on the back arc (above the center), side by side, facing the room (down).
    for (const s of seats) expect(s.y).toBeLessThan(t.y)
    expect(seats[0].y).toBeCloseTo(seats[1].y, 6)
    expect(seats[0].x - t.x).toBeCloseTo(-(seats[1].x - t.x), 6)
    expect(seats[0].x).toBeLessThan(seats[1].x)
    for (const s of seats) expect(Math.sin((s.angle * Math.PI) / 180)).toBeGreaterThan(0.5)
  })

  it('keeps guests on their side when the sides change', () => {
    // The rect preset: 4 on top (seats 0-3), 4 on the bottom (4-7). Guests on top.
    const t = { ...tableAt('rect', 'x'), seats: tableAt('rect', 'x').seats.map((s, i) => (i < 4 ? { ...s, guestId: G(i + 1) } : s)) }
    const next = tableIn(setSeatSides(canvasOf([t]), 'x', 'oneSide'), 'x')
    const layout = seatLocalLayout(next)
    next.seats.forEach((s, i) => {
      if (s.guestId !== null) expect(layout[i].side).toBe('top')
    })
    expect(next.seats.filter((s) => s.guestId !== null)).toHaveLength(4)
  })

  it('keeps guests in their seats when a table is resized', () => {
    const t = seatGuests(tableAt('square', 's'), 8)
    const next = tableIn(setItemBox(canvasOf([t]), 's', { width: 300 }), 's')
    expect(next.seats.filter((s) => s.guestId !== null)).toHaveLength(8)
  })

  it('ignores seat commands on items that are not tables', () => {
    const c = canvasOf([makeItem('bar', { x: 0, y: 0 }, 'b', emptyCanvas())])
    expect(addSeat(c, 'b')).toBe(c)
    expect(removeSeat(c, 'b').canvas).toBe(c)
    expect(fitSeats(c, 'b').canvas).toBe(c)
    expect(setSeatCount(c, 'b', 3).canvas).toBe(c)
  })
})

describe('labels and styles', () => {
  it('sets a fixture label and a shape text, cleaned', () => {
    const c = canvasOf([makeItem('bar', { x: 0, y: 0 }, 'b', emptyCanvas()), makeItem('text', { x: 0, y: 0 }, 't', emptyCanvas())])
    let next = setLabel(c, 'b', '  Open bar\u0000 ')
    expect(itemIn(next, 'b')).toMatchObject({ label: 'Open bar' })
    next = setLabel(next, 't', 'Hello')
    expect(itemIn(next, 't')).toMatchObject({ text: 'Hello' })
  })

  it('sets a shape style and refuses bad numbers', () => {
    const c = canvasOf([makeItem('box', { x: 0, y: 0 }, 's', emptyCanvas())])
    const next = setStyle(c, 's', { fill: '#ff0000', strokeWidth: -3 })
    expect((itemIn(next, 's') as Shape).style).toMatchObject({ fill: '#ff0000', strokeWidth: 0 })
    expect(setStyle(c, 's', { strokeWidth: Number.NaN })).toBe(c)
  })
})

// ---------------------------------------------------------------- notes

const NOW = Date.UTC(2026, 10, 10, 18, 0, 0)
/** The chair ring of a 60 in round table with seats: 76.2 + 8 + 45 cm from its center. */
const RING = 76.2 + 53

function noteIn(canvas: Canvas, id: string): Note {
  const n = canvas.items.find((i) => i.id === id)
  if (n?.kind !== 'note') throw new Error(`no note ${id}`)
  return n
}

function arrowNote(id: string, start: { x: number; y: number }, end: { x: number; y: number }, attachedTo: Note['attachedTo'] = { start: null, end: null }): Note {
  return withEnds({ ...makeNote('arrow', { x: 0, y: 0 }, 'Noa', 'blue', NOW, id), attachedTo }, start, end)
}

function expectAt(p: { x: number; y: number }, x: number, y: number) {
  expect(p.x).toBeCloseTo(x, 6)
  expect(p.y).toBeCloseTo(y, 6)
}

describe('notes', () => {
  it('adds a note on top, with its author, color and time', () => {
    const c = canvasOf([tableAt('round', 'a')])
    const next = addNote(c, { id: 'n', type: 'sticky', at: { x: 10, y: 20 }, author: 'Aiden', color: 'green', now: NOW })
    expect(next.items.map((i) => i.id)).toEqual(['a', 'n'])
    expect(noteIn(next, 'n')).toMatchObject({ x: 10, y: 20, width: 120, height: 120, author: 'Aiden', color: 'green', createdAt: '2026-11-10T18:00:00.000Z' })
    expect(canvasSchema.safeParse(next).success).toBe(true)
  })

  it('adds a drawn box at least 10 cm a side, and the default size for no box', () => {
    const drawn = addNote(emptyCanvas(), { id: 'n', type: 'box', at: { x: 0, y: 0 }, author: 'Noa', color: 'blue', now: NOW, size: { width: 300, height: 4 } })
    expect(noteIn(drawn, 'n')).toMatchObject({ width: 300, height: 10 })
    const none = addNote(emptyCanvas(), { id: 'n', type: 'circle', at: { x: 0, y: 0 }, author: 'Noa', color: 'blue', now: NOW, size: { width: 0, height: 0 } })
    expect(noteIn(none, 'n')).toMatchObject({ width: 150, height: 150 })
    // Arrows keep their length.
    const arrow = addNote(emptyCanvas(), { id: 'n', type: 'arrow', at: { x: 0, y: 0 }, author: 'Noa', color: 'blue', now: NOW, size: { width: 50, height: 50 } })
    expect(storedEnds(noteIn(arrow, 'n'))).toEqual({ start: { x: -100, y: 0 }, end: { x: 100, y: 0 } })
  })

  it('adds a drawn arrow with its ends on the items given', () => {
    const c = canvasOf([tableAt('round', 'a'), makeItem('bar', { x: 600, y: 0 }, 'bar', emptyCanvas())])
    const next = addArrow(c, { id: 'n', type: 'arrow', start: { x: 10, y: 0 }, end: { x: 590, y: 5 }, startOn: 'a', endOn: 'bar', author: 'Noa', color: 'blue', now: NOW })
    const n = noteIn(next, 'n')
    expect(n.attachedTo).toEqual({ start: 'a', end: 'bar' })
    const ends = resolveArrow(n, next)
    expectAt(ends.start, RING, 0)
    expectAt(ends.end, 600 - 91.44, 0)
    // The stored ends are where it is drawn.
    expectAt(storedEnds(n).start, RING, 0)
    expect(canvasSchema.safeParse(next).success).toBe(true)
    const free = addArrow(c, { id: 'f', type: 'line', start: { x: 0, y: 300 }, end: { x: 50, y: 400 }, author: 'Noa', color: 'grey', now: NOW })
    expect(noteIn(free, 'f')).toMatchObject({ type: 'line', attachedTo: { start: null, end: null } })
    expect(storedEnds(noteIn(free, 'f'))).toEqual({ start: { x: 0, y: 300 }, end: { x: 50, y: 400 } })
  })

  it('gives a drawn arrow whose free ends meet its default length', () => {
    const c = canvasOf([tableAt('round', 'a')])
    const short = addArrow(c, { id: 'n', type: 'line', start: { x: 0, y: 300 }, end: { x: 0.4, y: 300 }, author: 'Noa', color: 'grey', now: NOW })
    expect(storedEnds(noteIn(short, 'n'))).toEqual({ start: { x: 0, y: 300 }, end: { x: 200, y: 300 } })
    // Held at the start, it still runs from the table's chairs.
    const held = addArrow(c, { id: 'n', type: 'arrow', start: { x: 10, y: 0 }, end: { x: 10, y: 0 }, startOn: 'a', author: 'Noa', color: 'grey', now: NOW })
    const n = noteIn(held, 'n')
    expect(n.attachedTo).toEqual({ start: 'a', end: null })
    expectAt(storedEnds(n).end, 210, 0)
    expectAt(resolveArrow(n, held).start, RING, 0)
  })

  it('edits text as typed, cleaned and cut at 5,000 characters', () => {
    const c = canvasOf([makeNote('sticky', { x: 0, y: 0 }, 'Noa', 'yellow', NOW, 'n'), tableAt('round', 'a')])
    const next = setNoteText(c, 'n', 'Keep Bob\r\naway  \u0000')
    expect(noteIn(next, 'n').text).toBe('Keep Bob\naway  ')
    expect(setNoteText(next, 'n', 'Keep Bob\naway  ')).toBe(next)
    expect(noteIn(setNoteText(c, 'n', 'x'.repeat(6000)), 'n').text).toHaveLength(5000)
    // A cut through an emoji leaves no broken half.
    const cut = noteIn(setNoteText(c, 'n', 'x'.repeat(4999) + '😀'), 'n').text
    expect(cut.isWellFormed()).toBe(true)
    expect(setNoteText(c, 'a', 'Table')).toBe(c)
    // A locked note still takes text (DECISIONS 56).
    const locked = canvasOf([{ ...makeNote('sticky', { x: 0, y: 0 }, 'Noa', 'yellow', NOW, 'n'), locked: true }])
    expect(noteIn(setNoteText(locked, 'n', 'Hi'), 'n').text).toBe('Hi')
  })

  it('changes color and done on notes only', () => {
    const c = canvasOf([makeNote('sticky', { x: 0, y: 0 }, 'Noa', 'yellow', NOW, 'n'), makeNote('box', { x: 0, y: 0 }, 'Noa', 'yellow', NOW, 'm'), tableAt('round', 'a')])
    const colored = setNoteColor(c, ['n', 'm', 'a'], 'purple')
    expect(noteIn(colored, 'n').color).toBe('purple')
    expect(noteIn(colored, 'm').color).toBe('purple')
    expect(itemIn(colored, 'a')).toBe(itemIn(c, 'a'))
    expect(setNoteColor(colored, ['n'], 'purple')).toBe(colored)
    expect(setNoteColor(c, ['n'], 'orange' as never)).toBe(c)
    const done = setNoteDone(c, ['n'], true)
    expect(noteIn(done, 'n').done).toBe(true)
    expect(setNoteDone(done, ['n'], true)).toBe(done)
    expect(noteIn(toggleNoteDone(done, 'n'), 'n').done).toBe(false)
    expect(toggleNoteDone(c, 'a')).toBe(c)
  })

  it('moves an arrow end onto a table, and off it', () => {
    const c = canvasOf([tableAt('round', 'a'), arrowNote('n', { x: -400, y: 300 }, { x: 400, y: 300 })])
    const on = moveArrowEnd(c, 'n', 'end', { x: 20, y: 20 }, 'a')
    expect(noteIn(on, 'n').attachedTo).toEqual({ start: null, end: 'a' })
    expect(distance(resolveArrow(noteIn(on, 'n'), on).end, { x: 0, y: 0 })).toBeCloseTo(RING, 6)
    const off = moveArrowEnd(on, 'n', 'end', { x: 30, y: 600 }, null)
    expect(noteIn(off, 'n').attachedTo).toEqual({ start: null, end: null })
    expectAt(storedEnds(noteIn(off, 'n')).end, 30, 600)
    expect(moveArrowEnd(c, 'n', 'end', { x: Number.NaN, y: 0 }, null)).toBe(c)
  })

  it('attaches and detaches ends, never both on one item, never on a locked arrow', () => {
    const c = canvasOf([tableAt('round', 'a'), makeItem('bar', { x: 0, y: 900 }, 'bar', emptyCanvas()), makeItem('box', { x: 900, y: 0 }, 'box', emptyCanvas()), arrowNote('n', { x: 400, y: 300 }, { x: 400, y: 600 })])
    const one = attachArrowEnd(c, 'n', 'start', 'a')
    expect(noteIn(one, 'n').attachedTo).toEqual({ start: 'a', end: null })
    expect(attachArrowEnd(one, 'n', 'end', 'a')).toBe(one)
    expect(attachArrowEnd(one, 'n', 'start', 'a')).toBe(one)
    expect(attachArrowEnd(one, 'n', 'end', 'box')).toBe(one)
    expect(attachArrowEnd(one, 'n', 'end', 'missing')).toBe(one)
    const both = attachArrowEnd(one, 'n', 'end', 'bar')
    expect(noteIn(both, 'n').attachedTo).toEqual({ start: 'a', end: 'bar' })
    // Detached where it is drawn.
    const drawn = resolveArrow(noteIn(both, 'n'), both)
    const freed = detachArrowEnd(both, 'n', 'start')
    expect(noteIn(freed, 'n').attachedTo).toEqual({ start: null, end: 'bar' })
    expectAt(storedEnds(noteIn(freed, 'n')).start, drawn.start.x, drawn.start.y)
    expect(detachArrowEnd(freed, 'n', 'start')).toBe(freed)
    const locked = canvasOf([tableAt('round', 'a'), { ...arrowNote('n', { x: 400, y: 300 }, { x: 400, y: 600 }), locked: true }])
    expect(attachArrowEnd(locked, 'n', 'start', 'a')).toBe(locked)
    expect(moveArrowEnd(locked, 'n', 'start', { x: 0, y: 0 }, null)).toBe(locked)
    // Not an arrow: nothing to attach.
    const sticky = canvasOf([tableAt('round', 'a'), makeNote('sticky', { x: 0, y: 0 }, 'Noa', 'yellow', NOW, 's')])
    expect(attachArrowEnd(sticky, 's', 'start', 'a')).toBe(sticky)
  })

  it('keeps an arrow on a table that moves, resizes or turns, with no change to the arrow', () => {
    const t = tableAt('rect', 't')
    const n = arrowNote('n', { x: 0, y: 0 }, { x: 800, y: 0 }, { start: 't', end: null })
    let c = canvasOf([t, n])
    expectAt(resolveArrow(n, c).start, 121.92, 0)
    c = moveItems(c, ['t'], 0, 300)
    c = rotateItem(c, 't', { x: 1000, y: 300 })
    c = setItemBox(c, 't', { width: 400 })
    expect(noteIn(c, 'n')).toBe(n)
    const table = tableIn(c, 't')
    expect(table).toMatchObject({ x: 0, y: 300, rotation: 90, width: 400 })
    // Turned a quarter: its long side, chairs and all, faces the arrow's free end at (800, 0).
    const start = resolveArrow(n, c).start
    expect(start.x).toBeGreaterThan(38.1 + 53 - 1e-6)
    expect(start.x).toBeLessThan(38.1 + 53 + 1e-6)
    expect((start.y - 300) / start.x).toBeCloseTo(-300 / 800, 6)
  })

  it('moves a free arrow whole, pivots one held at one end, and leaves one held at both ends', () => {
    const c = canvasOf([
      tableAt('round', 'a'),
      tableAt('round', 'b', 600),
      arrowNote('free', { x: 0, y: 400 }, { x: 200, y: 400 }),
      arrowNote('one', { x: 0, y: 0 }, { x: 300, y: 400 }, { start: 'a', end: null }),
      arrowNote('both', { x: 0, y: 0 }, { x: 600, y: 0 }, { start: 'a', end: 'b' }),
    ])
    const moved = moveItems(c, ['free', 'one', 'both'], 50, 0)
    expect(storedEnds(noteIn(moved, 'free'))).toEqual({ start: { x: 50, y: 400 }, end: { x: 250, y: 400 } })
    const one = resolveArrow(noteIn(moved, 'one'), moved)
    expect(distance(one.start, { x: 0, y: 0 })).toBeCloseTo(RING, 6)
    expectAt(one.end, 350, 400)
    expect(noteIn(moved, 'both')).toBe(noteIn(c, 'both'))
    // Moving with its items, it moves along.
    const all = moveItems(c, ['a', 'b', 'both'], 50, 0)
    expect(noteIn(all, 'both').x).toBe(noteIn(c, 'both').x + 50)
  })

  it('stores a moved arrow’s ends where they are drawn', () => {
    const c = canvasOf([tableAt('round', 'a'), arrowNote('one', { x: 0, y: 0 }, { x: 300, y: 400 }, { start: 'a', end: null })])
    const moved = moveItems(c, ['one'], 50, 0)
    const n = noteIn(moved, 'one')
    const drawn = resolveArrow(n, moved)
    expectAt(storedEnds(n).start, drawn.start.x, drawn.start.y)
    expectAt(storedEnds(n).end, 350, 400)
    expect(n.attachedTo).toEqual({ start: 'a', end: null })
    expect(canvasSchema.safeParse(moved).success).toBe(true)
  })

  it('never turns or sizes an arrow by its box: it changes by its ends', () => {
    const c = canvasOf([arrowNote('n', { x: 0, y: 0 }, { x: 200, y: 0 })])
    expect(rotateItem(c, 'n', { x: 300, y: 0 })).toBe(c)
    expect(setItemBox(c, 'n', { rotation: 45 })).toBe(c)
    expect(setItemBox(c, 'n', { width: 500, height: 80 })).toBe(c)
    expect(resizeItem(c, 'n', 'e', { x: 400, y: 0 })).toBe(c)
    expect(resizeItemFromCenter(c, 'n', { x: 100, y: 0 }, { x: 300, y: 0 })).toBe(c)
    expect(noteIn(setItemBox(c, 'n', { x: 300 }), 'n').x).toBe(300)
    // Sticky notes turn like shapes.
    const s = canvasOf([makeNote('sticky', { x: 0, y: 0 }, 'Noa', 'yellow', NOW, 's')])
    expect(noteIn(rotateItem(s, 's', { x: 300, y: 0 }), 's').rotation).toBe(90)
  })

  it('leaves the ends of a deleted table where they were drawn, after it moved and turned', () => {
    const t = tableAt('rect', 't')
    const n = arrowNote('n', { x: 0, y: 0 }, { x: 800, y: 0 }, { start: 't', end: null })
    let c = canvasOf([t, n])
    c = rotateItem(moveItems(c, ['t'], 100, 200), 't', { x: 900, y: 200 })
    const drawn = resolveArrow(noteIn(c, 'n'), c)
    const next = deleteItems(c, ['t'])
    expect(next.items.map((i) => i.id)).toEqual(['n'])
    const left = noteIn(next, 'n')
    expect(left.attachedTo).toEqual({ start: null, end: null })
    expectAt(storedEnds(left).start, drawn.start.x, drawn.start.y)
    expectAt(storedEnds(left).end, 800, 0)
    expect(canvasSchema.safeParse(next).success).toBe(true)
  })

  it('duplicates an arrow with its table attached to the copy, and alone as a free arrow', () => {
    const t = tableAt('round', 't')
    const n = arrowNote('n', { x: 0, y: 0 }, { x: 500, y: 0 }, { start: 't', end: null })
    const c = canvasOf([t, n])
    const both = duplicateItems(c, ['t', 'n'], counter('c'), FT)
    const [ct, cn] = both.ids
    expect(noteIn(both.canvas, cn).attachedTo).toEqual({ start: ct, end: null })
    expectAt(resolveArrow(noteIn(both.canvas, cn), both.canvas).end, 500 + FT, FT)
    const alone = duplicateItems(c, ['n'], counter('c'), FT)
    const copy = noteIn(alone.canvas, alone.ids[0])
    expect(copy.attachedTo).toEqual({ start: null, end: null })
    expectAt(storedEnds(copy).start, RING + FT, FT)
    expect(noteIn(alone.canvas, 'n')).toBe(n)
  })

  it('pastes arrows holding only what was pasted with them', () => {
    const t = tableAt('round', 't')
    const n = arrowNote('n', { x: 0, y: 0 }, { x: 500, y: 0 }, { start: 't', end: 'gone' })
    const target = canvasOf([tableAt('round', 'gone', 900)])
    const { canvas, ids } = pasteItems(target, [t, n], counter('p'), { offset: { x: 0, y: 0 } })
    expect(noteIn(canvas, ids[1]).attachedTo).toEqual({ start: ids[0], end: null })
  })

  it('moves, resizes and deletes sticky notes like other items', () => {
    const s = makeNote('sticky', { x: 0, y: 0 }, 'Noa', 'yellow', NOW, 's')
    let c = canvasOf([s])
    c = moveItems(c, ['s'], 30, 40)
    expect(noteIn(c, 's')).toMatchObject({ x: 30, y: 40 })
    c = resizeItem(c, 's', 'se', { x: 30 + 100, y: 40 + 100 })
    expect(noteIn(c, 's')).toMatchObject({ width: 160, height: 160 })
    expect(deleteItems(c, ['s']).items).toEqual([])
  })
})
