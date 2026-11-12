import { describe, expect, it } from 'vitest'
import { canvasSchema, emptyCanvas, type Canvas, type Item } from '../src/domain/canvas-schema'
import { resolveArrow } from '../src/domain/arrows'
import { makeItem, type PresetId } from '../src/domain/presets'
import { addDemoNotes } from './demo-notes'

const START = Date.UTC(2026, 10, 1, 15)
const AUTHOR = { name: 'Dayna', id: '0b9f6a3e-6c1d-4c8e-9f57-2a1d6f1e7a10' }

function tour(): Canvas {
  const placed: [PresetId, number, number][] = [
    ['dj', 520, -820],
    ['head', 0, -470],
    ['sweetheart', -560, -470],
    ['danceFloor', 0, 0],
    ['round', -620, 0],
    ['bar', -1060, 0],
    ['cake', -300, 520],
  ]
  let canvas = emptyCanvas()
  placed.forEach(([preset, x, y], i) => {
    const item: Item = makeItem(preset, { x, y }, `item-${i}`, canvas)
    canvas = { ...canvas, items: [...canvas.items, item] }
  })
  return canvas
}

describe('the demo notes', () => {
  let n = 0
  const canvas = addDemoNotes(tour(), () => `note-${n++}`, START, AUTHOR)
  const notes = canvas.items.filter((i) => i.kind === 'note')

  it('adds sticky notes, text, a box and an arrow by the given author, one done, valid for saving', () => {
    expect(canvasSchema.safeParse(canvas).success).toBe(true)
    expect(new Set(notes.map((note) => note.type))).toEqual(new Set(['sticky', 'text', 'box', 'arrow']))
    expect(new Set(notes.map((note) => note.author))).toEqual(new Set(['Dayna']))
    expect(new Set(notes.map((note) => note.authorId))).toEqual(new Set([AUTHOR.id]))
    expect(notes.filter((note) => note.done)).toHaveLength(1)
    expect(new Set(notes.map((note) => note.color)).size).toBeGreaterThanOrEqual(4)
  })

  it('attaches the arrow to the bar and table 3, drawn between them', () => {
    const arrow = notes.find((note) => note.type === 'arrow')!
    const bar = canvas.items.find((i) => i.kind === 'fixture' && i.type === 'bar')!
    const table3 = canvas.items.find((i) => i.kind === 'table' && i.number === 3)!
    expect(arrow.attachedTo).toEqual({ start: bar.id, end: table3.id })
    const drawn = resolveArrow(arrow, canvas)
    expect(drawn.start.x).toBeGreaterThan(bar.x)
    expect(drawn.end.x).toBeLessThan(table3.x)
  })

  it('leaves the furniture as it was', () => {
    expect(canvas.items.filter((i) => i.kind !== 'note')).toEqual(tour().items)
  })
})
