import { describe, expect, it } from 'vitest'
import { emptyCanvas, noteSchema, type Item, type Note, type Table } from './canvas-schema'
import { storedEnds, withEnds } from './arrows'
import { itemBox } from './geometry'
import {
  defaultNoteText,
  isTextNote,
  listNotes,
  makeNote,
  NOTE_COLOR_PRESETS,
  NOTE_COLORS,
  NOTE_SIZES,
  NOTE_TYPE_NAMES,
  NOTE_TYPES,
  noteBounds,
  textPreview,
} from './notes'
import { makeItem } from './presets'
import { CHAIR_DEPTH_CM } from './seats'

const NOW = new Date(Date.UTC(2026, 10, 10, 9, 30, 0))

/** WCAG relative luminance of #rrggbb. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('makeNote', () => {
  it('makes each type at its default size, centered, by its author, valid for saving', () => {
    for (const type of NOTE_TYPES) {
      const note = makeNote(type, { x: 300, y: -40 }, 'Aiden', 'pink', NOW, `n-${type}`)
      expect(noteSchema.safeParse(note).success).toBe(true)
      expect(note).toMatchObject({
        id: `n-${type}`,
        kind: 'note',
        type,
        x: 300,
        y: -40,
        rotation: 0,
        locked: false,
        color: 'pink',
        author: 'Aiden',
        done: false,
        createdAt: '2026-11-10T09:30:00.000Z',
        attachedTo: { start: null, end: null },
      })
    }
    expect(makeNote('sticky', { x: 0, y: 0 }, 'Noa', 'yellow', NOW, 'a')).toMatchObject({ width: 120, height: 120, text: '' })
    expect(makeNote('text', { x: 0, y: 0 }, 'Noa', 'yellow', NOW, 'a')).toMatchObject({ width: 200, height: 50, text: 'Text' })
    expect(makeNote('box', { x: 0, y: 0 }, 'Noa', 'yellow', NOW, 'a')).toMatchObject({ width: 200, height: 150 })
    expect(makeNote('circle', { x: 0, y: 0 }, 'Noa', 'yellow', NOW, 'a')).toMatchObject({ width: 150, height: 150 })
  })

  it('runs arrows and lines 200 cm from left to right through the point', () => {
    for (const type of ['arrow', 'line'] as const) {
      const note = makeNote(type, { x: 50, y: 20 }, 'Noa', 'grey', NOW.getTime(), 'a')
      expect(storedEnds(note)).toEqual({ start: { x: -50, y: 20 }, end: { x: 150, y: 20 } })
      expect(note.width).toBe(NOTE_SIZES[type].width)
      expect(note.height).toBeGreaterThan(0)
    }
  })

  it('takes a time as a number too, and survives a bad one', () => {
    expect(makeNote('box', { x: 0, y: 0 }, 'Noa', 'grey', 0, 'a').createdAt).toBe('1970-01-01T00:00:00.000Z')
    expect(makeNote('box', { x: 0, y: 0 }, 'Noa', 'grey', Number.NaN, 'a').createdAt).toBe('1970-01-01T00:00:00.000Z')
  })

  it('knows which notes hold text on the plan', () => {
    expect(NOTE_TYPES.filter((t) => isTextNote({ type: t }))).toEqual(['sticky', 'text'])
    expect(defaultNoteText('sticky')).toBe('')
    expect(defaultNoteText('text')).toBe('Text')
  })
})

describe('colors', () => {
  it('has the six presets in order, with a name each', () => {
    expect(NOTE_COLORS).toEqual(['yellow', 'pink', 'blue', 'green', 'purple', 'grey'])
    for (const color of NOTE_COLORS) {
      expect(NOTE_COLOR_PRESETS[color].id).toBe(color)
      expect(NOTE_COLOR_PRESETS[color].label).toMatch(/^[A-Z][a-z]+$/)
    }
    expect(new Set(NOTE_COLORS.map((c) => NOTE_COLOR_PRESETS[c].fill)).size).toBe(6)
    expect(new Set(NOTE_COLORS.map((c) => NOTE_COLOR_PRESETS[c].stroke)).size).toBe(6)
  })

  it('reads well on a white plan and in print', () => {
    for (const color of NOTE_COLORS) {
      const p = NOTE_COLOR_PRESETS[color]
      // Text on sticky paper: well past the 7:1 for small text.
      expect(contrast(p.text, p.fill)).toBeGreaterThan(7)
      // Lines and outlines on white paper.
      expect(contrast(p.stroke, '#ffffff')).toBeGreaterThan(4.5)
      // Sticky paper stays light, so seats stay the strongest color.
      expect(luminance(p.fill)).toBeGreaterThan(0.6)
    }
  })

  it('names every type', () => {
    expect(NOTE_TYPES.map((t) => NOTE_TYPE_NAMES[t])).toEqual(['Sticky note', 'Text', 'Arrow', 'Line', 'Box', 'Circle'])
  })
})

describe('textPreview', () => {
  it('puts the text on one short line', () => {
    expect(textPreview('  Keep Bob\n\n away   from the bar  ')).toBe('Keep Bob away from the bar')
    expect(textPreview('')).toBe('')
    const long = 'a'.repeat(100)
    expect(textPreview(long, 20)).toBe('a'.repeat(19) + '…')
    expect(Array.from(textPreview('é'.repeat(100), 10))).toHaveLength(10)
    // Emoji are not cut in half.
    expect(textPreview('😀'.repeat(30), 5)).toBe('😀😀😀😀…')
  })
})

describe('listNotes', () => {
  const table = makeItem('round', { x: 0, y: 0 }, 't', emptyCanvas())
  const sticky = { ...makeNote('sticky', { x: 0, y: 0 }, 'Noa', 'yellow', NOW, 's'), text: 'Uncle Bob\nnot near the bar' }
  const arrow = makeNote('arrow', { x: 0, y: 0 }, 'Aiden', 'blue', NOW, 'a')
  const done = { ...makeNote('box', { x: 0, y: 0 }, 'Aiden', 'green', NOW, 'b'), done: true, locked: true }

  it('lists notes in drawing order, with a preview and a title', () => {
    const list = listNotes({ items: [sticky, table, arrow, done] })
    expect(list.map((e) => e.id)).toEqual(['s', 'a', 'b'])
    expect(list[0]).toMatchObject({ type: 'sticky', color: 'yellow', author: 'Noa', done: false, preview: 'Uncle Bob not near the bar', title: 'Uncle Bob not near the bar' })
    expect(list[1]).toMatchObject({ preview: '', title: 'Arrow', author: 'Aiden' })
    expect(list[2]).toMatchObject({ done: true, locked: true, title: 'Box', createdAt: '2026-11-10T09:30:00.000Z' })
    expect(listNotes({ items: [table] })).toEqual([])
  })

  it('keeps each entry while its note is unchanged', () => {
    const one = listNotes({ items: [sticky, arrow] })
    const two = listNotes({ items: [sticky, { ...arrow, done: true }] })
    expect(two[0]).toBe(one[0])
    expect(two[1]).not.toBe(one[1])
    expect(two[1].done).toBe(true)
  })
})

describe('noteBounds', () => {
  it('boxes a turned note by its body', () => {
    const sticky: Note = { ...makeNote('sticky', { x: 100, y: 100 }, 'Noa', 'yellow', NOW, 's'), rotation: 45 }
    expect(noteBounds(sticky, { items: [sticky] })).toEqual(itemBox(sticky))
    const half = 60 * Math.SQRT2
    expect(noteBounds(sticky, { items: [sticky] }).maxX).toBeCloseTo(100 + half, 6)
  })

  it('boxes an attached arrow by its drawn ends', () => {
    const table = makeItem('round', { x: 0, y: 0 }, 't', emptyCanvas()) as Table
    const base = makeNote('arrow', { x: 0, y: 0 }, 'Noa', 'blue', NOW, 'a')
    const arrow = withEnds({ ...base, attachedTo: { start: 't', end: null } }, { x: 0, y: 0 }, { x: 600, y: 0 })
    const items: Item[] = [table, arrow]
    const box = noteBounds(arrow, { items })
    expect(box.minX).toBeCloseTo(76.2 + CHAIR_DEPTH_CM, 6)
    expect(box.maxX).toBeCloseTo(600, 6)
  })
})
