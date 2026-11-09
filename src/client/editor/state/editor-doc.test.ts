import { describe, expect, it, vi } from 'vitest'
import { emptyCanvas, type Canvas } from '@/domain/canvas-schema'
import { clearDroppedSeats, createDocStore } from '../doc-store'
import { addItem, moveItems, resizeItem } from '../commands'
import { createEditorDoc } from './editor-doc'

function setup(initial: Canvas = addItem(emptyCanvas(), 'round', { x: 0, y: 0 }, 'a')) {
  const store = createDocStore(initial)
  let editable = true
  const onCommit = vi.fn()
  const doc = createEditorDoc({ store, canEdit: () => editable, onCommit })
  return { store, doc, onCommit, setEditable: (v: boolean) => (editable = v) }
}

const xOf = (c: Canvas) => c.items[0].x

describe('the document guard', () => {
  it('records an edit as one undo step and saves it', () => {
    const { store, doc, onCommit } = setup()
    const out = doc.edit('Move', (c) => moveItems(c, ['a'], 10, 0))
    expect(out).not.toBeNull()
    expect(onCommit).toHaveBeenCalledWith(out)
    expect(store.getState().canUndo).toBe(true)
    doc.undo()
    expect(xOf(store.getState().canvas)).toBe(0)
    expect(onCommit).toHaveBeenCalledTimes(2)
  })

  it('refuses every change when editing is off (View mode)', () => {
    const { store, doc, onCommit, setEditable } = setup()
    doc.edit('Move', (c) => moveItems(c, ['a'], 10, 0))
    setEditable(false)
    const before = store.getState().canvas
    expect(doc.edit('Move', (c) => moveItems(c, ['a'], 10, 0))).toBeNull()
    expect(doc.undo()).toBeNull()
    expect(doc.redo()).toBeNull()
    expect(doc.begin('Move')).toBeNull()
    expect(store.getState().canvas).toBe(before)
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('makes a whole drag one undo step, saved once', () => {
    const { store, doc, onCommit } = setup()
    const g = doc.begin('Move')!
    for (const dx of [5, 10, 20, 40]) g.preview((start) => moveItems(start, ['a'], dx, 0))
    expect(xOf(store.getState().canvas)).toBe(40)
    expect(store.getState().canUndo).toBe(false)
    expect(onCommit).not.toHaveBeenCalled()
    const out = g.commit()
    expect(xOf(out!)).toBe(40)
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(store.getState().history.past).toHaveLength(1)
    doc.undo()
    expect(xOf(store.getState().canvas)).toBe(0)
    doc.redo()
    expect(xOf(store.getState().canvas)).toBe(40)
  })

  it('puts the canvas back when a drag is cancelled, with nothing to undo', () => {
    const { store, doc, onCommit } = setup()
    const start = store.getState().canvas
    const g = doc.begin('Move')!
    g.preview((s) => moveItems(s, ['a'], 30, 0))
    g.cancel()
    expect(store.getState().canvas).toBe(start)
    expect(store.getState().canUndo).toBe(false)
    expect(g.commit()).toBeNull()
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('records nothing for a drag that ended where it began', () => {
    const { store, doc } = setup()
    const g = doc.begin('Move')!
    g.preview((s) => moveItems(s, ['a'], 30, 0))
    g.preview((s) => s)
    expect(g.commit()).toBeNull()
    expect(store.getState().canUndo).toBe(false)
  })

  it('drops a drag when the document is replaced under it', () => {
    const { store, doc, onCommit } = setup()
    const g = doc.begin('Move')!
    g.preview((s) => moveItems(s, ['a'], 30, 0))
    const theirs = addItem(emptyCanvas(), 'square', { x: 500, y: 0 }, 'b')
    store.replace(theirs)
    expect(g.preview((s) => moveItems(s, ['a'], 60, 0))).toBe(false)
    expect(g.commit()).toBeNull()
    expect(store.getState().canvas).toBe(theirs)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('cancels a drag when editing turns off mid-drag', () => {
    const { store, doc, setEditable } = setup()
    const start = store.getState().canvas
    const g = doc.begin('Move')!
    g.preview((s) => moveItems(s, ['a'], 30, 0))
    setEditable(false)
    expect(g.preview((s) => moveItems(s, ['a'], 40, 0))).toBe(false)
    expect(store.getState().canvas).toBe(start)
  })

  it('cancels a drag under way before undo or another edit', () => {
    const { store, doc } = setup()
    doc.edit('Move', (c) => moveItems(c, ['a'], 10, 0))
    const g = doc.begin('Move')!
    g.preview((s) => moveItems(s, ['a'], 30, 0))
    doc.undo()
    expect(g.isActive()).toBe(false)
    expect(xOf(store.getState().canvas)).toBe(0)
  })
})

describe('seats the server emptied (A6)', () => {
  const guest = '66666666-6666-4666-8666-666666666666'
  const dropped = [{ itemId: 'a', seatIndex: 0, guestId: guest, reason: 'removed-guest' as const }]
  const seatedCanvas = (): Canvas => {
    const c = addItem(emptyCanvas(), 'round', { x: 0, y: 0 }, 'a')
    return { ...c, items: c.items.map((i) => (i.kind === 'table' ? { ...i, seats: i.seats.map((s) => (s.index === 0 ? { ...s, guestId: guest } : s)) } : i)) }
  }
  const seat0 = (c: Canvas) => (c.items[0].kind === 'table' ? c.items[0].seats[0].guestId : 'not a table')

  it('go into a drag under way: begin, preview, patch, commit is one undo step and one save with the seat empty', () => {
    const { store, doc, onCommit } = setup(seatedCanvas())
    store.routeServerPatches(doc.patchFromServer)
    const g = doc.begin('Move')!
    g.preview((start) => moveItems(start, ['a'], 10, 0))
    store.patchFromServer((c) => clearDroppedSeats(c, dropped))
    expect(seat0(store.getState().canvas)).toBeNull()
    expect(xOf(store.getState().canvas)).toBe(10)
    expect(g.isActive()).toBe(true)
    expect(seat0(g.start)).toBeNull()
    expect(g.preview((start) => moveItems(start, ['a'], 30, 0))).toBe(true)
    expect(seat0(store.getState().canvas)).toBeNull()
    const out = g.commit()!
    expect(xOf(out)).toBe(30)
    expect(seat0(out)).toBeNull()
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(out)
    expect(store.getState().history.past).toHaveLength(1)
    doc.undo()
    expect(xOf(store.getState().canvas)).toBe(0)
    expect(seat0(store.getState().canvas)).toBeNull()
  })

  it('redraw the latest frame from the patched start, and a cancel keeps the seat empty', () => {
    const { store, doc, onCommit } = setup(seatedCanvas())
    store.routeServerPatches(doc.patchFromServer)
    const g = doc.begin('Resize')!
    // A resize re-shares seats, so the guest may sit at another number in the frame than at the start.
    g.preview((start) => resizeItem(start, 'a', 'se', { x: 200, y: 200 }))
    store.patchFromServer((c) => clearDroppedSeats(c, dropped))
    const frame = store.getState().canvas
    expect(frame.items[0].kind === 'table' && frame.items[0].seats.every((s) => s.guestId === null)).toBe(true)
    g.cancel()
    expect(xOf(store.getState().canvas)).toBe(0)
    expect(seat0(store.getState().canvas)).toBeNull()
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('are patched outside the history with no drag, and the store takes them back when the editor lets go', () => {
    const { store, doc } = setup(seatedCanvas())
    const unroute = store.routeServerPatches(doc.patchFromServer)
    expect(store.patchFromServer((c) => clearDroppedSeats(c, dropped))).not.toBeNull()
    expect(seat0(store.getState().canvas)).toBeNull()
    expect(store.getState().canUndo).toBe(false)
    const handler = vi.fn(() => null)
    const unrouteHandler = store.routeServerPatches(handler)
    // Letting go of an older route leaves the newer one in place.
    unroute()
    store.patchFromServer((c) => moveItems(c, ['a'], 5, 0))
    expect(handler).toHaveBeenCalledTimes(1)
    unrouteHandler()
    store.patchFromServer((c) => moveItems(c, ['a'], 5, 0))
    expect(handler).toHaveBeenCalledTimes(1)
    expect(xOf(store.getState().canvas)).toBe(5)
  })
})
