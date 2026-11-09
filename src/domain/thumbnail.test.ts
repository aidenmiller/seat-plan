import { describe, expect, it } from 'vitest'
import { canvasSchema, type Canvas, type Item, type Table } from './canvas-schema'
import { fullnessColor, renderThumbnailSvg } from './thumbnail'
import { fixedItemsSchema, type FixedItem } from './venue-schema'

const EVIL = '"/><script>alert(1)</script><text>Uncle Bob'
const G1 = '00000000-0000-4000-8000-000000000001'
const G2 = '00000000-0000-4000-8000-000000000002'

const base = { x: 0, y: 0, rotation: 0, locked: false }

function table(id: string, extra: Partial<Table> = {}): Table {
  return {
    ...base,
    id,
    kind: 'table',
    shape: 'round',
    width: 152.4,
    height: 152.4,
    number: 1,
    name: 'Table 1',
    seatCount: 2,
    seatSides: 'all',
    seats: [
      { index: 0, guestId: null },
      { index: 1, guestId: null },
    ],
    ...extra,
  }
}

/** Runs the canvas through the real schema, so the fixtures are canvases the server would store. */
function canvas(...items: Item[]): Canvas {
  return canvasSchema.parse({ schemaVersion: 1, items })
}

function viewBox(svg: string): number[] {
  const m = /viewBox="([^"]+)"/.exec(svg)
  return m![1]!.split(' ').map(Number)
}

function tagNames(svg: string): string[] {
  return [...svg.matchAll(/<([a-zA-Z]+)/g)].map((m) => m[1]!)
}

describe('renderThumbnailSvg', () => {
  it('draws an empty canvas as a plain light rectangle', () => {
    const svg = renderThumbnailSvg(canvas())
    expect(svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid meet">' +
        '<rect width="320" height="200" fill="#f8fafc"/></svg>',
    )
  })

  it('leaves notes out, so a canvas of notes alone is empty too', () => {
    const svg = renderThumbnailSvg(
      canvas({
        ...base,
        id: 'n1',
        kind: 'note',
        type: 'sticky',
        width: 100,
        height: 100,
        text: 'keep Uncle Bob away from the bar',
        color: 'yellow',
        author: 'Noa',
        done: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        attachedTo: { start: null, end: null },
      }),
    )
    expect(svg).toBe(renderThumbnailSvg(canvas()))
  })

  it('is 320 by 200, fits the content with padding and keeps the same shape', () => {
    const svg = renderThumbnailSvg(canvas(table('t1', { x: 1000, y: 500 }), table('t2', { x: 3000, y: 700 })))
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="320" height="200" /)
    expect(svg).toContain('preserveAspectRatio="xMidYMid meet"')
    const [x, y, w, h] = viewBox(svg)
    expect(w! / h!).toBeCloseTo(1.6, 2)
    // Both tables (radius 76.2) sit inside, with room to spare.
    expect(x!).toBeLessThan(1000 - 76.2)
    expect(x! + w!).toBeGreaterThan(3000 + 76.2)
    expect(y!).toBeLessThan(500 - 76.2)
    expect(y! + h!).toBeGreaterThan(700 + 76.2)
    // Not wildly larger than the content.
    expect(w!).toBeLessThan(2152.4 * 1.5)
  })

  it('fills tables darker the fuller they are', () => {
    expect(fullnessColor(0, 8)).toBe('#dbeafe')
    expect(fullnessColor(8, 8)).toBe('#1e3a8a')
    expect(fullnessColor(0, 0)).toBe('#dbeafe')
    const empty = renderThumbnailSvg(canvas(table('t1')))
    const full = renderThumbnailSvg(
      canvas(
        table('t1', {
          seats: [
            { index: 0, guestId: G1 },
            { index: 1, guestId: G2 },
          ],
        }),
      ),
    )
    expect(empty).toContain('fill="#dbeafe"')
    expect(full).toContain('fill="#1e3a8a"')
    const half = renderThumbnailSvg(
      canvas(
        table('t1', {
          seats: [
            { index: 0, guestId: G1 },
            { index: 1, guestId: null },
          ],
        }),
      ),
    )
    expect(half).toContain(`fill="${fullnessColor(1, 2)}"`)
    expect(fullnessColor(1, 2)).not.toBe('#dbeafe')
  })

  it('draws round tables as circles and others as rotated rectangles', () => {
    const svg = renderThumbnailSvg(
      canvas(table('t1'), table('t2', { shape: 'rect', width: 243.84, height: 76.2, x: 400, rotation: 30 })),
    )
    expect(svg).toMatch(/<circle cx="0" cy="0" r="76.2" /)
    expect(svg).toMatch(/<rect x="-121.9" y="-38.1" width="243.8" height="76.2" transform="translate\(400 0\) rotate\(30\)"/)
  })

  it('draws fixtures, chair rows, walls and rooms', () => {
    const fixed: FixedItem[] = fixedItemsSchema.parse([
      { id: 'w1', type: 'wall', unsure: false, unsureNote: '', thickness: 20, points: [{ x: -500, y: -500 }, { x: 500, y: -500 }] },
      {
        id: 'r1',
        type: 'room',
        unsure: false,
        unsureNote: '',
        points: [
          { x: -500, y: -500 },
          { x: 500, y: -500 },
          { x: 500, y: 500 },
        ],
      },
    ])
    const svg = renderThumbnailSvg(
      canvas(
        { ...base, id: 'f1', kind: 'fixture', type: 'danceFloor', width: 300, height: 300, label: 'Dance', rotation: 45 },
        {
          ...base,
          id: 'c1',
          kind: 'chairRow',
          chairCount: 4,
          spacing: 50.8,
          blockId: null,
          blockLabel: null,
          rowNumber: 1,
          rowLabel: 'Row 1',
          reservedFor: null,
          seats: [0, 1, 2, 3].map((index) => ({ index, guestId: null })),
          y: 300,
        },
        {
          ...base,
          id: 's1',
          kind: 'shape',
          type: 'wall',
          width: 400,
          height: 10,
          x: 0,
          y: 450,
          style: { stroke: '#000', fill: 'none', strokeWidth: 2 },
        },
      ),
      fixed,
    )
    expect(svg).toContain('<polyline points="-500,-500 500,-500" fill="none" stroke="#9ca3af"')
    expect(svg).toContain('<polygon points="-500,-500 500,-500 500,500" fill="none" stroke="#9ca3af"')
    expect(svg).toMatch(/<rect [^>]*rotate\(45\)[^>]*fill="#e5e7eb"/)
    expect(svg).toMatch(/<line x1="-76.2" y1="300" x2="76.2" y2="300" /)
    expect(svg).toMatch(/<polyline points="-200,450 200,450" /)
  })

  it('puts nothing a person typed into the output', () => {
    const fixed: FixedItem[] = fixedItemsSchema.parse([
      { id: 'b1', type: 'bar', unsure: true, unsureNote: EVIL, name: EVIL, label: EVIL, x: 0, y: 0, width: 100, height: 50, rotation: 0 },
      { id: 'l1', type: 'label', unsure: false, unsureNote: '', text: EVIL, x: 0, y: 0, rotation: 0, fontSize: 20 },
    ])
    const svg = renderThumbnailSvg(
      canvas(
        table('t1', { name: EVIL }),
        { ...base, id: 'f1', kind: 'fixture', type: 'custom', width: 100, height: 100, label: EVIL },
        {
          ...base,
          id: 's1',
          kind: 'shape',
          type: 'room',
          width: 400,
          height: 300,
          text: EVIL,
          style: { stroke: EVIL.slice(0, 32), fill: EVIL.slice(0, 32), strokeWidth: 1 },
        },
        {
          ...base,
          id: 'c1',
          kind: 'chairRow',
          chairCount: 1,
          spacing: 50.8,
          blockId: 'b',
          blockLabel: EVIL,
          rowNumber: 1,
          rowLabel: EVIL,
          reservedFor: EVIL,
          seats: [{ index: 0, guestId: null }],
        },
      ),
      fixed,
    )
    expect(svg).not.toContain('script')
    expect(svg).not.toContain('Uncle')
    expect(svg).not.toContain('alert')
    for (const tag of tagNames(svg)) expect(['svg', 'rect', 'circle', 'line', 'polygon', 'polyline']).toContain(tag)
    // Every attribute value is a number list, a color or one of the fixed words.
    for (const [, value] of svg.matchAll(/="([^"]*)"/g)) {
      expect(value).toMatch(/^(http:\/\/www\.w3\.org\/2000\/svg|xMidYMid meet|none|round|#[0-9a-f]{6}|[-0-9., ]+|translate\([-0-9.]+ [-0-9.]+\) rotate\([-0-9.]+\))$/)
    }
  })
})
