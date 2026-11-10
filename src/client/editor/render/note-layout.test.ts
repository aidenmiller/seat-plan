import { describe, expect, it } from 'vitest'
import { NOTE_FONT_CM, NOTE_LINE_CM } from '@/domain/notes'
import { arrowParts, layoutNoteText, NOTE_LINE_HEIGHT, NOTE_MIN_FONT_CM, plainTextBox, stickyTextBox, wrapText } from './note-layout'
import { textWidthEm } from './text-fit'

const fits = (line: string, width: number, font: number) => textWidthEm(line) * font <= width + 1e-9

describe('wrapText', () => {
  it('wraps at spaces, keeping each line inside the width', () => {
    const lines = wrapText('Keep Uncle Bob away from the bar please', 100, 18)
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.join(' ')).toBe('Keep Uncle Bob away from the bar please')
    for (const line of lines) expect(fits(line, 100, 18)).toBe(true)
  })

  it('keeps typed line breaks and blank lines, and closes up runs of spaces', () => {
    expect(wrapText('One\n\nTwo   three', 1000, 18)).toEqual(['One', '', 'Two three'])
    expect(wrapText('a\r\nb', 1000, 18)).toEqual(['a', 'b'])
  })

  it('breaks a word too long for a line between characters', () => {
    const lines = wrapText('Supercalifragilisticexpialidocious', 60, 18)
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.join('')).toBe('Supercalifragilisticexpialidocious')
    for (const line of lines) expect(fits(line, 60, 18)).toBe(true)
  })

  it('never splits an emoji', () => {
    const lines = wrapText('🎉🎉🎉🎉🎉🎉🎉🎉', 20, 18)
    for (const line of lines) expect(Array.from(line).every((ch) => ch === '🎉')).toBe(true)
  })
})

describe('layoutNoteText', () => {
  it('uses the full note font when the text fits', () => {
    const l = layoutNoteText('Bar', 100, 100)
    expect(l).toEqual({ lines: ['Bar'], fontSize: NOTE_FONT_CM, lineStep: NOTE_FONT_CM * NOTE_LINE_HEIGHT, cut: false })
  })

  it('shrinks the font until the wrapped lines fit the height', () => {
    const text = 'Seat the band near the stage door so they can get out fast'
    const l = layoutNoteText(text, 100, 90)
    expect(l.cut).toBe(false)
    expect(l.fontSize).toBeLessThan(NOTE_FONT_CM)
    expect(l.fontSize).toBeGreaterThanOrEqual(NOTE_MIN_FONT_CM)
    expect(l.fontSize + (l.lines.length - 1) * l.lineStep).toBeLessThanOrEqual(90 + 1e-9)
    for (const line of l.lines) expect(fits(line, 100, l.fontSize)).toBe(true)
  })

  it('cuts text that cannot fit even at the smallest size, with an ellipsis', () => {
    const l = layoutNoteText('word '.repeat(400), 100, 60)
    expect(l.cut).toBe(true)
    expect(l.fontSize).toBe(NOTE_MIN_FONT_CM)
    expect(l.lines[l.lines.length - 1].endsWith('…')).toBe(true)
    expect(l.fontSize + (l.lines.length - 1) * l.lineStep).toBeLessThanOrEqual(60 + 1e-9)
    for (const line of l.lines) expect(fits(line, 100, l.fontSize)).toBe(true)
  })

  it('draws nothing for blank text, and ignores trailing blank lines', () => {
    expect(layoutNoteText('  \n ', 100, 100).lines).toEqual([])
    expect(layoutNoteText('Hi\n\n\n', 100, 30).lines).toEqual(['Hi'])
  })

  it('always shows at least one line, even in a very short box', () => {
    const l = layoutNoteText('Hello there friend', 100, 2)
    expect(l.lines).toHaveLength(1)
  })
})

describe('text boxes', () => {
  it('keeps a sticky note text clear of its edges and the corner initial', () => {
    const b = stickyTextBox(120, 120)
    expect(b.x).toBeGreaterThan(-60)
    expect(b.y).toBeGreaterThan(-60)
    expect(b.x + b.width).toBeLessThan(60)
    expect(b.y + b.height).toBeLessThan(60 - b.pad)
  })

  it('gives a text note nearly its whole box', () => {
    const b = plainTextBox(200, 50)
    expect(b.width).toBeGreaterThan(190)
    expect(b.height).toBeGreaterThan(40)
  })
})

describe('arrowParts', () => {
  it('ends the shaft inside a head whose tip is the end point', () => {
    const p = arrowParts({ x: 0, y: 0 }, { x: 200, y: 0 }, true)
    expect(p.head).not.toBeNull()
    const [left, tip, right] = p.head!
    expect(tip).toEqual({ x: 200, y: 0 })
    expect(left.x).toBeCloseTo(200 - NOTE_LINE_CM * 5, 6)
    expect(right.x).toBeCloseTo(200 - NOTE_LINE_CM * 5, 6)
    expect(left.y).toBeCloseTo(-right.y, 6)
    expect(p.to.x).toBeLessThan(200)
    expect(p.to.x).toBeGreaterThan(left.x)
  })

  it('gives a short arrow a head at most half its length', () => {
    const p = arrowParts({ x: 0, y: 0 }, { x: 0, y: 10 }, true)
    expect(p.head![0].y).toBeCloseTo(5, 6)
  })

  it('draws a line, or an arrow with no length, with no head', () => {
    expect(arrowParts({ x: 0, y: 0 }, { x: 50, y: 50 }, false)).toEqual({ from: { x: 0, y: 0 }, to: { x: 50, y: 50 }, head: null })
    expect(arrowParts({ x: 5, y: 5 }, { x: 5, y: 5 }, true).head).toBeNull()
  })
})
