import { describe, expect, it } from 'vitest'
import {
  canRedo,
  canUndo,
  clearHistory,
  emptyHistory,
  record,
  redo,
  redoLabel,
  undo,
  undoLabel,
  type History,
} from './history'

type Doc = { items: { id: string; x: number }[] }

const a = { id: 'a', x: 0 }
const b = { id: 'b', x: 0 }
const doc0: Doc = { items: [a, b] }
const doc1: Doc = { items: [{ ...a, x: 10 }, b] }
const doc2: Doc = { items: [doc1.items[0], { ...b, x: 5 }] }

describe('history', () => {
  it('starts empty', () => {
    const h = emptyHistory<Doc>()
    expect(h.limit).toBe(200)
    expect(canUndo(h)).toBe(false)
    expect(canRedo(h)).toBe(false)
    expect(undo(h, doc0)).toBeNull()
    expect(redo(h, doc0)).toBeNull()
  })

  it('rejects a limit below 1', () => {
    expect(() => emptyHistory(0)).toThrow()
    expect(() => emptyHistory(1.5)).toThrow()
  })

  it('undoes and redoes in order', () => {
    let h = emptyHistory<Doc>()
    h = record(h, doc0, doc1, 'Move table')
    h = record(h, doc1, doc2, 'Move chair')
    expect(undoLabel(h)).toBe('Move chair')

    const u1 = undo(h, doc2)!
    expect(u1.doc).toBe(doc1)
    expect(redoLabel(u1.history)).toBe('Move chair')
    const u2 = undo(u1.history, u1.doc)!
    expect(u2.doc).toBe(doc0)
    expect(canUndo(u2.history)).toBe(false)
    expect(canRedo(u2.history)).toBe(true)

    const r1 = redo(u2.history, u2.doc)!
    expect(r1.doc).toBe(doc1)
    const r2 = redo(r1.history, r1.doc)!
    expect(r2.doc).toBe(doc2)
    expect(canRedo(r2.history)).toBe(false)
    expect(undoLabel(r2.history)).toBe('Move chair')
  })

  it('shares unchanged parts by reference', () => {
    let h = emptyHistory<Doc>()
    h = record(h, doc0, doc1, 'Move a')
    h = record(h, doc1, doc2, 'Move b')
    const back = undo(h, doc2)!
    expect(back.doc.items[0]).toBe(doc2.items[0])
    expect(back.doc.items[1]).toBe(doc0.items[1])
  })

  it('never changes the history it is given', () => {
    const h0 = emptyHistory<Doc>()
    const h1 = record(h0, doc0, doc1, 'Move')
    expect(h0.past).toHaveLength(0)
    const u = undo(h1, doc1)!
    expect(h1.past).toHaveLength(1)
    expect(h1.future).toHaveLength(0)
    redo(u.history, u.doc)
    expect(u.history.future).toHaveLength(1)
  })

  it('clears redo when a new step is recorded', () => {
    let h = emptyHistory<Doc>()
    h = record(h, doc0, doc1, 'Move')
    const u = undo(h, doc1)!
    expect(canRedo(u.history)).toBe(true)
    const h2 = record(u.history, doc0, doc2, 'Other')
    expect(canRedo(h2)).toBe(false)
    expect(h2.past).toHaveLength(1)
  })

  it('ignores a step that changed nothing', () => {
    const h = emptyHistory<Doc>()
    expect(record(h, doc0, doc0, 'Nothing')).toBe(h)
  })

  it('drops the oldest steps past the limit', () => {
    let h: History<number> = emptyHistory<number>(3)
    for (let i = 0; i < 5; i++) h = record(h, i, i + 1, `step ${i}`)
    expect(h.past.map((e) => e.label)).toEqual(['step 2', 'step 3', 'step 4'])
    let doc = 5
    let steps = 0
    for (let r = undo(h, doc); r; r = undo(h, doc)) {
      h = r.history
      doc = r.doc
      steps++
    }
    expect(steps).toBe(3)
    expect(doc).toBe(2)
  })

  it('keeps 200 steps by default', () => {
    let h = emptyHistory<number>()
    for (let i = 0; i < 250; i++) h = record(h, i, i + 1, 'step')
    expect(h.past).toHaveLength(200)
    expect(h.past[0].before).toBe(50)
  })

  it('redo returns to the document on screen, keeping changes made outside the history', () => {
    let h = emptyHistory<Doc>()
    h = record(h, doc0, doc1, 'Move')
    const outside: Doc = { items: [doc1.items[0]] } // the server emptied something
    const u = undo(h, outside)!
    expect(u.doc).toBe(doc0)
    expect(redo(u.history, u.doc)!.doc).toBe(outside)
  })

  it('merges a run of steps that share a key', () => {
    let h = emptyHistory<number>()
    h = record(h, 0, 1, 'Nudge', { mergeKey: 'nudge:t1' })
    h = record(h, 1, 2, 'Nudge', { mergeKey: 'nudge:t1' })
    h = record(h, 2, 3, 'Nudge', { mergeKey: 'nudge:t1' })
    expect(h.past).toHaveLength(1)
    expect(undo(h, 3)!.doc).toBe(0)
  })

  it('does not merge across a different key or a gap', () => {
    let h = emptyHistory<number>()
    h = record(h, 0, 1, 'Nudge', { mergeKey: 'nudge:t1' })
    h = record(h, 1, 2, 'Nudge', { mergeKey: 'nudge:t2' })
    expect(h.past).toHaveLength(2)
    // The document changed outside the history between the two steps.
    h = record(h, 5, 6, 'Nudge', { mergeKey: 'nudge:t2' })
    expect(h.past).toHaveLength(3)
    h = record(h, 6, 7, 'Move')
    h = record(h, 7, 8, 'Nudge', { mergeKey: 'nudge:t2' })
    expect(h.past).toHaveLength(5)
  })

  it('clearHistory forgets every step and keeps the limit', () => {
    let h = emptyHistory<number>(10)
    h = record(h, 0, 1, 'a')
    const u = undo(h, 1)!
    const cleared = clearHistory(record(u.history, 0, 2, 'b'))
    expect(canUndo(cleared)).toBe(false)
    expect(canRedo(cleared)).toBe(false)
    expect(cleared.limit).toBe(10)
  })
})
