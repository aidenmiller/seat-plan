import { describe, expect, it, vi } from 'vitest'
import { emptyCanvas, type Canvas, type Table } from '@/domain/canvas-schema'
import { addRoundTable } from '@/domain/round-table'
import { clearDroppedSeats, createDocStore } from './doc-store'

const GUEST = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'

function seated(canvas: Canvas, tableIndex: number, seatIndex: number, guestId: string): Canvas {
  return {
    ...canvas,
    items: canvas.items.map((item, i) => {
      if (i !== tableIndex || item.kind !== 'table') return item
      const seats = item.seats.map((s) => (s.index === seatIndex ? { ...s, guestId } : s))
      return { ...item, seats }
    }),
  }
}

describe('createDocStore', () => {
  it('records edits, undoes and redoes them, and tells subscribers', () => {
    const store = createDocStore(emptyCanvas())
    const listener = vi.fn()
    store.subscribe(listener)
    expect(store.getState().canUndo).toBe(false)

    const one = store.edit('Add table', (c) => addRoundTable(c, 'a'))
    const two = store.edit('Add table', (c) => addRoundTable(c, 'b'))
    expect(two?.items).toHaveLength(2)
    expect(listener).toHaveBeenCalledTimes(2)
    expect(store.getState().canUndo).toBe(true)

    expect(store.undo()).toBe(one)
    expect(store.getState().canRedo).toBe(true)
    expect(store.undo()?.items).toHaveLength(0)
    expect(store.undo()).toBeNull()
    expect(store.redo()).toBe(one)
    expect(store.redo()).toBe(two)
    expect(store.redo()).toBeNull()
  })

  it('ignores an edit that changes nothing', () => {
    const store = createDocStore(emptyCanvas())
    expect(store.edit('Nothing', (c) => c)).toBeNull()
    expect(store.getState().canUndo).toBe(false)
  })

  it('replace() loads a server copy and clears the history', () => {
    const store = createDocStore(emptyCanvas())
    store.edit('Add table', (c) => addRoundTable(c, 'a'))
    const theirs = addRoundTable(addRoundTable(emptyCanvas(), 'x'), 'y')
    store.replace(theirs)
    expect(store.getState().canvas).toBe(theirs)
    expect(store.getState().canUndo).toBe(false)
    expect(store.getState().canRedo).toBe(false)
    expect(store.undo()).toBeNull()
  })

  it('patchOutsideHistory changes the canvas without adding an undo step', () => {
    const store = createDocStore(seated(addRoundTable(emptyCanvas(), 'a'), 0, 0, GUEST))
    store.edit('Add table', (c) => addRoundTable(c, 'b'))
    const patched = store.patchOutsideHistory((c) =>
      clearDroppedSeats(c, [{ itemId: 'a', seatIndex: 0, guestId: GUEST, reason: 'removed-guest' }]),
    )
    expect((patched!.items[0] as Table).seats[0].guestId).toBeNull()
    expect(store.getState().history.past).toHaveLength(1)
    // Undo the table add; redo returns to the patched canvas, not the one before the patch.
    store.undo()
    expect(store.redo()).toBe(patched)
  })
})

describe('clearDroppedSeats', () => {
  const base = seated(seated(addRoundTable(addRoundTable(emptyCanvas(), 'a'), 'b'), 0, 2, GUEST), 1, 5, OTHER)

  it('empties the named seats and keeps other items as they were', () => {
    const out = clearDroppedSeats(base, [{ itemId: 'a', seatIndex: 2, guestId: GUEST, reason: 'second-seat' }])
    expect((out.items[0] as Table).seats[2].guestId).toBeNull()
    expect(out.items[1]).toBe(base.items[1])
  })

  it('leaves a seat alone when someone else sits there now', () => {
    const out = clearDroppedSeats(base, [{ itemId: 'a', seatIndex: 2, guestId: OTHER, reason: 'removed-guest' }])
    expect(out).toBe(base)
  })

  it('ignores unknown items and seats', () => {
    expect(clearDroppedSeats(base, [{ itemId: 'zzz', seatIndex: 0, guestId: GUEST, reason: 'unknown-guest' }])).toBe(base)
    expect(clearDroppedSeats(base, [{ itemId: 'a', seatIndex: 99, guestId: GUEST, reason: 'unknown-guest' }])).toBe(base)
    expect(clearDroppedSeats(base, [])).toBe(base)
  })
})
