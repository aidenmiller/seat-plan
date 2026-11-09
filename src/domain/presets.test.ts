import { describe, expect, it } from 'vitest'
import { canvasSchema, emptyCanvas, type Canvas, type Item, type Note, type Table } from './canvas-schema'
import { boxCenter, boxOfPoints } from './geometry'
import {
  copyItems,
  FIXTURE_PRESETS,
  getPreset,
  isPresetId,
  makeItem,
  nextTableNumber,
  presetFootprintSize,
  PRESETS,
  SHAPE_PRESETS,
  TABLE_PRESETS,
  WALL_PRESETS,
  type PresetId,
} from './presets'
import { fitSeatCount, isTight } from './seats'

const G1 = '00000000-0000-4000-8000-000000000001'

function canvasOf(items: Item[]): Canvas {
  return { ...emptyCanvas(), items }
}

describe('presets', () => {
  it('match the spec sizes and seats, in cm', () => {
    const t = Object.fromEntries(TABLE_PRESETS.map((p) => [p.id, p]))
    expect(t.round).toMatchObject({ shape: 'round', width: 152.4, height: 152.4, seatCount: 8, seatSides: 'all' })
    expect(t.square).toMatchObject({ shape: 'square', width: 121.92, height: 121.92, seatCount: 8, seatSides: 'all' })
    expect(t.rect).toMatchObject({ shape: 'rect', width: 243.84, height: 76.2, seatCount: 8, seatSides: 'noEnds' })
    expect(t.head).toMatchObject({ shape: 'rect', width: 731.52, height: 76.2, seatCount: 12, seatSides: 'oneSide' })
    expect(t.sweetheart).toMatchObject({ shape: 'round', width: 91.44, height: 91.44, seatCount: 2 })
    const f = Object.fromEntries(FIXTURE_PRESETS.map((p) => [p.id, p]))
    expect(f.food).toMatchObject({ width: 182.88, height: 76.2, label: 'Food' })
    expect(f.bar).toMatchObject({ width: 182.88, height: 60.96, label: 'Bar' })
    expect(f.dj).toMatchObject({ width: 182.88, height: 91.44, label: 'DJ' })
    expect(f.danceFloor).toMatchObject({ width: 487.68, height: 487.68, label: 'Dance floor' })
    expect(f.stage).toMatchObject({ width: 487.68, height: 243.84, label: 'Stage' })
    expect(f.cake).toMatchObject({ width: 91.44, height: 91.44, label: 'Cake' })
    expect(f.gifts).toMatchObject({ width: 182.88, height: 76.2, label: 'Gifts' })
    expect(f.photoBooth).toMatchObject({ width: 243.84, height: 243.84, label: 'Photo booth' })
    const s = Object.fromEntries([...SHAPE_PRESETS, ...WALL_PRESETS].map((p) => [p.id, p]))
    expect(s.box).toMatchObject({ type: 'rect', width: 121.92, height: 121.92 })
    expect(s.circle).toMatchObject({ type: 'ellipse', width: 121.92, height: 121.92 })
    expect(s.line).toMatchObject({ type: 'line', width: 182.88 })
    expect(s.text).toMatchObject({ type: 'text', text: 'Text' })
    expect(s.wall).toMatchObject({ type: 'wall', width: 304.8, height: 15 })
    expect(s.room).toMatchObject({ type: 'room', width: 609.6, height: 487.68 })
    expect(s.door).toMatchObject({ type: 'door', width: 91.44 })
    expect(s.window).toMatchObject({ type: 'window', width: 121.92 })
  })

  it('give tables that hold their seats without a yellow outline', () => {
    for (const p of TABLE_PRESETS) {
      const t = makeItem(p.id, { x: 0, y: 0 }, p.id, emptyCanvas()) as Table
      expect(isTight(t), p.id).toBe(false)
      expect(fitSeatCount(t), p.id).toBeGreaterThanOrEqual(p.seatCount)
    }
  })

  it('have unique ids and keep shape points centered inside their box', () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length)
    for (const p of [...SHAPE_PRESETS, ...WALL_PRESETS]) {
      if (!p.points) continue
      const b = boxOfPoints(p.points)!
      expect(boxCenter(b), p.id).toEqual({ x: 0, y: 0 })
      expect(b.maxX).toBeLessThanOrEqual(p.width / 2)
      expect(b.maxY).toBeLessThanOrEqual(p.height / 2)
    }
  })

  it('know their ids', () => {
    expect(isPresetId('round')).toBe(true)
    expect(isPresetId('danceFloor')).toBe(true)
    expect(isPresetId('nope')).toBe(false)
    expect(isPresetId(3)).toBe(false)
    expect(() => getPreset('nope' as PresetId)).toThrow()
  })

  it('size a table footprint with its chairs', () => {
    expect(presetFootprintSize('round')).toEqual({ width: 152.4 + 106, height: 152.4 + 106 })
    expect(presetFootprintSize('stage')).toEqual({ width: 487.68, height: 243.84 })
  })
})

describe('makeItem', () => {
  it('makes a valid item from every preset, all together in one canvas', () => {
    let canvas = emptyCanvas()
    for (const p of PRESETS) {
      const item = makeItem(p.id, { x: 10, y: -20 }, `id-${p.id}`, canvas)
      expect(item).toMatchObject({ id: `id-${p.id}`, x: 10, y: -20, rotation: 0, locked: false })
      canvas = { ...canvas, items: [...canvas.items, item] }
    }
    const parsed = canvasSchema.safeParse(canvas)
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true)
    const numbers = canvas.items.filter((i): i is Table => i.kind === 'table').map((t) => [t.number, t.name])
    expect(numbers).toEqual([
      [1, 'Table 1'],
      [2, 'Table 2'],
      [3, 'Table 3'],
      [4, 'Table 4'],
      [5, 'Table 5'],
    ])
  })

  it('numbers a new table after the highest number, gaps and all', () => {
    const canvas = canvasOf([makeItem('round', { x: 0, y: 0 }, 'a', emptyCanvas())])
    const third = { ...(canvas.items[0] as Table), id: 'b', number: 7 }
    const t = makeItem('square', { x: 0, y: 0 }, 'c', canvasOf([...canvas.items, third])) as Table
    expect(t.number).toBe(8)
    expect(t.name).toBe('Table 8')
    expect(t.seats.every((s, i) => s.index === i && s.guestId === null)).toBe(true)
    expect(nextTableNumber(emptyCanvas())).toBe(1)
  })

  it('does not share points or style between items', () => {
    const a = makeItem('wall', { x: 0, y: 0 }, 'a', emptyCanvas())
    const b = makeItem('wall', { x: 0, y: 0 }, 'b', emptyCanvas())
    if (a.kind !== 'shape' || b.kind !== 'shape') throw new Error('walls are shapes')
    expect(a.points).not.toBe(b.points)
    expect(a.style).not.toBe(b.style)
  })
})

describe('copyItems (PLAN changes 3 and 9)', () => {
  it('empties seats, numbers on, and keeps renamed tables their name', () => {
    const t1 = { ...(makeItem('round', { x: 0, y: 0 }, 't1', emptyCanvas()) as Table) }
    t1.seats = t1.seats.map((s, i) => (i === 0 ? { ...s, guestId: G1 } : s))
    const t2 = { ...(makeItem('rect', { x: 500, y: 0 }, 't2', canvasOf([t1])) as Table), name: 'Family' }
    const canvas = canvasOf([t1, t2])
    let n = 0
    const copies = copyItems([t1, t2], canvas, () => `new-${++n}`, { x: 30, y: 40 })
    const [c1, c2] = copies as Table[]
    expect(c1).toMatchObject({ id: 'new-1', x: 30, y: 40, number: 3, name: 'Table 3' })
    expect(c2).toMatchObject({ id: 'new-2', x: 530, y: 40, number: 4, name: 'Family' })
    expect(c1.seats.every((s) => s.guestId === null)).toBe(true)
    expect(t1.seats[0].guestId).toBe(G1)
    expect(canvasSchema.safeParse(canvasOf([...canvas.items, ...copies])).success).toBe(true)
  })

  it('points copied notes at copied items, and leaves other links alone', () => {
    const t = makeItem('round', { x: 0, y: 0 }, 't', emptyCanvas())
    const arrow: Note = {
      id: 'n',
      kind: 'note',
      type: 'arrow',
      x: 0,
      y: 0,
      rotation: 0,
      locked: false,
      width: 100,
      height: 10,
      points: [
        { x: -50, y: 0 },
        { x: 50, y: 0 },
      ],
      text: '',
      color: 'yellow',
      author: 'Noa',
      done: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      attachedTo: { start: 't', end: 'elsewhere' },
    }
    const [, copy] = copyItems([t, arrow], canvasOf([t, arrow]), () => `c-${Math.random()}`)
    if (copy.kind !== 'note') throw new Error('note expected')
    expect(copy.attachedTo.start).not.toBe('t')
    expect(copy.attachedTo.end).toBe('elsewhere')
    expect(copy.points).not.toBe(arrow.points)
  })
})
