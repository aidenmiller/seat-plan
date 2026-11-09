import { describe, expect, it } from 'vitest'
import { emptyCanvas, type Table } from '@/domain/canvas-schema'
import { makeItem } from '@/domain/presets'
import { fitText, iconAndLabel, labelRotation, MIN_ITEM_FONT_CM, seatCountText, tableCenterLabels, textWidthEm, uprightAngle } from './text-fit'

const GUEST = '11111111-1111-4111-8111-111111111111'

function table(preset: 'round' | 'rect' | 'head' | 'sweetheart', patch: Partial<Table> = {}): Table {
  return { ...(makeItem(preset, { x: 0, y: 0 }, 't1', emptyCanvas()) as Table), ...patch }
}

describe('fitText', () => {
  it('uses the largest size up to the cap', () => {
    expect(fitText('Hi', 1000, 40)).toEqual({ text: 'Hi', fontSize: 40 })
    const f = fitText('Table 12', 100, 40)
    expect(f.text).toBe('Table 12')
    expect(f.fontSize * textWidthEm('Table 12')).toBeLessThanOrEqual(100 + 1e-9)
  })

  it('cuts long text short with an ellipsis at the smallest size', () => {
    const f = fitText('The long family table by the window', 60, 30)
    expect(f.fontSize).toBe(MIN_ITEM_FONT_CM)
    expect(f.text.endsWith('…')).toBe(true)
    expect(textWidthEm(f.text) * f.fontSize).toBeLessThanOrEqual(60 + 1e-9)
  })

  it('trims, and keeps an empty label empty', () => {
    expect(fitText('  Bar  ', 500, 20).text).toBe('Bar')
    expect(fitText('   ', 500, 20).text).toBe('')
  })
})

describe('uprightAngle and labelRotation', () => {
  it('never turns text upside down', () => {
    expect(uprightAngle(0)).toBe(0)
    expect(uprightAngle(90)).toBe(90)
    expect(uprightAngle(91)).toBe(-89)
    expect(uprightAngle(180)).toBe(0)
    expect(uprightAngle(270)).toBe(90)
    expect(uprightAngle(-90)).toBe(90)
    expect(uprightAngle(-135)).toBe(45)
    for (let a = -720; a <= 720; a += 15) {
      const u = uprightAngle(a)
      expect(u).toBeGreaterThan(-90)
      expect(u).toBeLessThanOrEqual(90)
      expect((((u - a) % 180) + 180) % 180).toBeCloseTo(0)
    }
  })

  it('keeps round tables level and runs other labels along the long side', () => {
    expect(labelRotation({ rotation: 33, width: 100, height: 100 }, true)).toBe(-33)
    // Upside down on the canvas: flipped back.
    expect(labelRotation({ rotation: 180, width: 300, height: 80 })).toBe(-180)
    // A tall item: the label runs along its height, reading upright.
    const r = labelRotation({ rotation: 0, width: 80, height: 300 })
    expect(Math.abs(r)).toBe(90)
  })
})

describe('tableCenterLabels', () => {
  it('shows the name above a taken/seats count', () => {
    const t = table('round')
    t.seats[0] = { index: 0, guestId: GUEST }
    expect(seatCountText(t)).toBe('1/8')
    const labels = tableCenterLabels(t)
    expect(labels.name.text).toBe('Table 1')
    expect(labels.count.text).toBe('1/8')
    expect(labels.name.y).toBeLessThan(labels.count.y)
    expect(labels.name.fontSize).toBeLessThanOrEqual(40)
    expect(labels.count.fontSize).toBeLessThan(labels.name.fontSize)
  })

  it('fits both lines inside a narrow head table', () => {
    const t = table('head')
    const labels = tableCenterLabels(t)
    const top = labels.name.y - labels.name.fontSize / 2
    const bottom = labels.count.y + labels.count.fontSize / 2
    expect(bottom - top).toBeLessThanOrEqual(t.height)
  })

  it('falls back to Table N for a blank name and keeps round tables level', () => {
    const t = table('sweetheart', { name: '  ', number: 7, rotation: 45 })
    const labels = tableCenterLabels(t)
    expect(labels.name.text).toBe('Table 7')
    expect(labels.rotation).toBe(-45)
  })
})

describe('iconAndLabel', () => {
  it('puts the icon above the label, both inside the box', () => {
    const box = { width: 182.88, height: 76.2, rotation: 0 }
    const l = iconAndLabel(box, 'Bar')
    expect(l.iconSize).toBeGreaterThan(0)
    expect(l.iconY).toBeLessThan(l.label.y)
    expect(l.label.y + l.label.fontSize / 2).toBeLessThanOrEqual(box.height / 2)
    expect(l.iconY - l.iconSize / 2).toBeGreaterThanOrEqual(-box.height / 2)
  })

  it('drops the icon when the box is too small for it', () => {
    const l = iconAndLabel({ width: 30, height: 12, rotation: 0 }, 'Cake table')
    expect(l.iconSize).toBe(0)
    expect(l.label.y).toBe(0)
  })

  it('shows a larger icon alone when there is no label', () => {
    const withLabel = iconAndLabel({ width: 200, height: 200, rotation: 0 }, 'Stage')
    const alone = iconAndLabel({ width: 200, height: 200, rotation: 0 }, '')
    expect(alone.iconSize).toBeGreaterThan(withLabel.iconSize)
    expect(alone.iconY).toBe(0)
  })
})
