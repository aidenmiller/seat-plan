import { describe, expect, it } from 'vitest'
import { fixedItemsSchema, type FixedItem } from '../venue-schema'
import { makeRoomPdf, PT_PER_M, ROOM } from './__fixtures__/plans'
import { readFirstPage } from './__fixtures__/pdfjs-node'
import { extractWallSegments, type CleanSegment } from './cleanup'
import { emptyDraft, type FloorplanDraft } from './draft-schema'
import { chooseScale, measureDimensionLines } from './scale'
import { DEFAULT_WALL_THICKNESS_CM, draftToFixedItems, MODEL_DRAWN_WALL_NOTE } from './to-fixed-items'

const ok = { unsure: false, unsure_note: '' }
const counter = () => {
  let n = 0
  return () => `f${++n}`
}
type Wall = Extract<FixedItem, { type: 'wall' }>
type Door = Extract<FixedItem, { type: 'door' }>
const walls = (items: FixedItem[]) => items.filter((i): i is Wall => i.type === 'wall')
const pieceLengths = (w: Wall) => w.points.slice(1).map((p, i) => Math.hypot(p.x - w.points[i].x, p.y - w.points[i].y))
const len = (s: CleanSegment) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1)

async function room(options: Parameters<typeof makeRoomPdf>[0] = {}) {
  const page = await readFirstPage(await makeRoomPdf(options))
  const { segments } = extractWallSegments(page)
  const scale = chooseScale(measureDimensionLines(page.texts, page.segments))
  return { page, segments, cmPerPx: scale.cmPerPx! }
}

describe('draftToFixedItems for a vector PDF', () => {
  it('builds the walls from the PDF lines, snaps the door into its opening and keeps unsure items', async () => {
    const { page, segments, cmPerPx } = await room()
    const wallPx = ROOM.wall * PT_PER_M * page.pxPerPt
    const outer = segments.filter((s) => Math.abs(s.thickness - wallPx) < 0.5)
    const partition = segments.find((s) => Math.abs((len(s) * cmPerPx) / 100 - ROOM.partition.length) < 0.01)!
    const leaf = segments.find((s) => s.thickness < wallPx / 2 && Math.abs((len(s) * cmPerPx) / 100 - 0.9) < 0.01)
    expect(outer).toHaveLength(5)
    // The two bottom pieces: the door is in the gap between them.
    const bottomY = Math.max(...outer.map((s) => s.y1))
    const [left, right] = outer.filter((s) => s.y1 === bottomY && s.y2 === bottomY).sort((a, b) => a.x1 - b.x1)
    const gapMiddle = (left.x2 + right.x1) / 2
    const draft: FloorplanDraft = {
      ...emptyDraft(),
      walls: [
        { id: 'w1', segment_ids: outer.map((s) => s.id), points: [], thickness_px: 30, ...ok },
        { id: 'w2', segment_ids: [partition.id, 'nope'], points: [], thickness_px: 0, unsure: true, unsure_note: 'Might be a screen' },
      ],
      // The model's door is a little off the wall and a little narrow.
      doors: [{ position: { x: gapMiddle + 12, y: bottomY - 9 }, width_px: 120, rotation: 0, wall_id: 'w1', segment_ids: leaf ? [leaf.id] : [], swing: 'left', ...ok }],
      rooms: [{ name: 'Main Room', points: [left, outer[0], right].map((s) => ({ x: s.x1, y: s.y1 })), ...ok }],
    }
    const origin = { x: left.x1, y: bottomY }
    const out = draftToFixedItems({ draft, segments, cmPerPx, origin, newId: counter() })
    expect(fixedItemsSchema.safeParse(out.items).success).toBe(true)
    const ws = walls(out.items)
    expect(ws).toHaveLength(2)
    // The outer pieces join into one polyline round the room, from jamb to jamb.
    const loop = ws.find((w) => w.points.length === 6)!
    expect(loop).toBeDefined()
    const pieces = pieceLengths(loop).map((cm) => Math.round(cm))
    expect(pieces.length).toBe(5)
    expect([...pieces].sort((a, b) => a - b)).toEqual([400, 510, 800, 800, 1000])
    for (const cm of pieceLengths(loop)) expect(Math.abs(cm - Math.round(cm / 10) * 10)).toBeLessThan(1)
    expect(loop.thickness).toBeCloseTo(20, 0)
    expect(out.wallIds.w1).toEqual([loop.id])
    // The partition keeps the model's doubt, and its thickness is its 4.24 pt pen at 1:50.
    const part = ws.find((w) => w !== loop)!
    expect(part).toMatchObject({ unsure: true, unsureNote: 'Might be a screen' })
    expect(part.thickness).toBeCloseTo(((6 * Math.SQRT1_2) / PT_PER_M) * 100, 1)
    expect(pieceLengths(part)[0]).toBeCloseTo(ROOM.partition.length * 100, 0)
    expect(out.skipped).toContain('Wall w2: no line nope')
    // Canvas (0, 0) is the room's bottom left corner, y down.
    expect(loop.points.some((p) => Math.abs(p.x) < 0.01 && Math.abs(p.y) < 0.01)).toBe(true)
    // The door sits in the 0.9 m opening, on the wall's line.
    const door = out.items.find((i): i is Door => i.type === 'door')!
    expect(door.wallId).toBe(loop.id)
    expect(door.width).toBeCloseTo(90, 0)
    expect(door.x).toBeCloseTo(((ROOM.doorFrom + ROOM.doorTo) / 2) * 100, 0)
    expect(door.y).toBeCloseTo(0, 1)
    expect(door.rotation).toBe(0)
    expect(door.unsure).toBe(false)
    // Drawing order: rooms under walls under doors.
    expect(out.items.map((i) => i.type)).toEqual(['room', 'wall', 'wall', 'door'])
    expect(out.reference).toEqual({ scaleCmPerPx: cmPerPx, offsetX: -origin.x * cmPerPx, offsetY: -origin.y * cmPerPx, rotation: 0, opacity: 0.5 })
    expect(out.unsure).toBe(1)
  })

  it('turns walls drawn as two thin faces into centre lines 20 cm thick', async () => {
    const { page, segments, cmPerPx } = await room({ doubleLineWalls: true })
    const scale = PT_PER_M * page.pxPerPt
    const faceLengths = [10.2, 9.8, 8.2, 7.8, 4.1, 3.9, 5.2, 5.0]
    const faces = segments.filter((s) => s.y1 !== 194.29 && faceLengths.some((m) => Math.abs(len(s) / scale - m) < 0.005))
    // Ten faces: two for the top, four for the sides, four for the bottom pieces.
    expect(faces).toHaveLength(10)
    const draft: FloorplanDraft = { ...emptyDraft(), walls: [{ id: 'w1', segment_ids: faces.map((s) => s.id), points: [], thickness_px: 0, ...ok }] }
    const out = draftToFixedItems({ draft, segments, cmPerPx, newId: counter() })
    const ws = walls(out.items)
    expect(ws).toHaveLength(1)
    expect(ws[0].thickness).toBeCloseTo(20, 0)
    expect(
      pieceLengths(ws[0])
        .map((cm) => Math.round(cm))
        .sort((a, b) => a - b),
    ).toEqual([400, 510, 800, 800, 1000])
  })
})

describe('draftToFixedItems for walls the model typed out over a vector PDF', () => {
  const line = (id: string, x1: number, y1: number, x2: number, y2: number): CleanSegment => ({ id, x1, y1, x2, y2, thickness: 4, source: 'stroke' })
  const segments = [line('s1', 200, 200, 3800, 200), line('s2', 3800, 200, 3800, 2400), line('s3', 200, 2400, 3800, 2400)]

  it('leaves out a wall that retypes PDF lines another wall already uses', () => {
    const draft: FloorplanDraft = {
      ...emptyDraft(),
      walls: [
        { id: 'w1', segment_ids: ['s1'], points: [], thickness_px: 0, ...ok },
        // The same line, retyped a few pixels off.
        { id: 'w2', segment_ids: [], points: [{ x: 206, y: 201 }, { x: 3794, y: 201 }], thickness_px: 0, ...ok },
      ],
    }
    const out = draftToFixedItems({ draft, segments, cmPerPx: 1, newId: counter() })
    const ws = walls(out.items)
    expect(ws).toHaveLength(1)
    expect(ws[0]).toMatchObject({ points: [{ x: 200, y: 200 }, { x: 3800, y: 200 }], unsure: false })
    expect(out.skipped).toEqual(['Wall w2: repeats PDF lines another wall already uses'])
    expect(out.wallIds).toEqual({ w1: [ws[0].id] })
  })

  it('keeps a wall the model drew itself, marked unsure, so it is checked against the plan', () => {
    const draft: FloorplanDraft = {
      ...emptyDraft(),
      walls: [
        { id: 'w1', segment_ids: ['s1'], points: [], thickness_px: 0, ...ok },
        // Over a line no wall uses: still the model's typing, not the PDF's.
        { id: 'w2', segment_ids: [], points: [{ x: 3801, y: 205 }, { x: 3799, y: 2395 }], thickness_px: 0, ...ok },
        // Nowhere near a line.
        { id: 'w3', segment_ids: [], points: [{ x: 1000, y: 1000 }, { x: 2000, y: 1000 }], thickness_px: 0, unsure: true, unsure_note: 'Faint' },
      ],
    }
    const out = draftToFixedItems({ draft, segments, cmPerPx: 1, newId: counter() })
    const ws = walls(out.items)
    expect(ws).toHaveLength(3)
    const [fromPdf, typed, alone] = [ws.find((w) => out.wallIds.w1.includes(w.id))!, ws.find((w) => out.wallIds.w2.includes(w.id))!, ws.find((w) => out.wallIds.w3.includes(w.id))!]
    expect(fromPdf.unsure).toBe(false)
    expect(typed).toMatchObject({ unsure: true, unsureNote: MODEL_DRAWN_WALL_NOTE })
    expect(alone).toMatchObject({ unsure: true, unsureNote: `Faint. ${MODEL_DRAWN_WALL_NOTE}` })
    expect(out.unsure).toBe(2)
  })

  it('does not mark walls by points unsure on a picture, where points are the only way', () => {
    const draft: FloorplanDraft = { ...emptyDraft(), walls: [{ id: 'w1', segment_ids: [], points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], thickness_px: 0, ...ok }] }
    const out = draftToFixedItems({ draft, segments: [], cmPerPx: 1, newId: counter() })
    expect(walls(out.items)[0]).toMatchObject({ unsure: false, unsureNote: '' })
  })
})

describe('draftToFixedItems for a picture', () => {
  const draft = (): FloorplanDraft => ({
    ...emptyDraft(),
    walls: [
      // Slightly skewed, with ends that nearly meet.
      { id: 'a', segment_ids: [], points: [{ x: 0, y: 0 }, { x: 200, y: 2 }, { x: 201, y: 150 }], thickness_px: 10, ...ok },
      { id: 'b', segment_ids: [], points: [{ x: 202, y: 151 }, { x: 0, y: 150 }, { x: 1, y: 1 }], thickness_px: 0, ...ok },
      { id: 'c', segment_ids: [], points: [{ x: 5, y: 5 }], thickness_px: 10, ...ok },
      { id: 'd', segment_ids: [], points: [{ x: 500, y: 500 }, { x: 500.1, y: 500 }], thickness_px: 10, ...ok },
    ],
    rooms: [
      { name: 'Hall', points: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 150 }, { x: 0, y: 0 }], ...ok },
      { name: '', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], ...ok },
    ],
    zones: [{ name: '  Patio  ', points: [{ x: 0, y: 200 }, { x: 100, y: 200 }, { x: 100, y: 260 }], unsure: true, unsure_note: 'No edge drawn' }],
    patio_edges: [{ points: [{ x: 0, y: 260 }, { x: 100, y: 260 }], ...ok }],
    doors: [
      { position: { x: 100, y: 3 }, width_px: 18, rotation: 180, wall_id: 'a', segment_ids: [], swing: 'unknown', ...ok },
      { position: { x: 600, y: 600 }, width_px: 18, rotation: 0, wall_id: '', segment_ids: [], swing: 'right', ...ok },
    ],
    windows: [{ position: { x: 3, y: 75 }, width_px: 0, rotation: 90, wall_id: '', segment_ids: [], ...ok }],
    columns: [
      { center: { x: 100, y: 75 }, width_px: 8, height_px: 8, rotation: 0, shape: 'unknown', ...ok },
      { center: { x: 50, y: 75 }, width_px: 0, height_px: 8, rotation: 0, shape: 'round', ...ok },
    ],
    stairs: [{ center: { x: 180, y: 130 }, width_px: 20, height_px: 10, rotation: 450, ...ok }],
    bars: [{ center: { x: 150, y: 20 }, width_px: 40, height_px: 8, rotation: 0, label: 'Main bar', ...ok }],
    labels: [
      { text: 'HALL', position: { x: 100, y: 60 }, height_px: 4, ...ok },
      { text: '   ', position: { x: 0, y: 0 }, height_px: 4, ...ok },
    ],
  })

  it('converts every kind of item to centimeters at the scale', () => {
    const out = draftToFixedItems({ draft: draft(), cmPerPx: 5, newId: counter() })
    expect(fixedItemsSchema.safeParse(out.items).success).toBe(true)
    const ws = walls(out.items)
    expect(ws).toHaveLength(2)
    // Straightened within 2 degrees and the ends that nearly met are joined.
    const a = ws[0]
    expect(a.points[0].y).toBe(a.points[1].y)
    expect(a.points[1].x).toBe(a.points[2].x)
    expect(a.thickness).toBe(50)
    expect(ws[1].thickness).toBe(DEFAULT_WALL_THICKNESS_CM)
    expect(ws[1].points[0]).toEqual(a.points[2])
    expect(ws[1].points.at(-1)).toEqual(a.points[0])
    expect(out.skipped).toEqual(expect.arrayContaining(['Wall c: fewer than 2 points', 'Wall d: too short', 'Room (no name): fewer than 3 corners', 'Column: no size', 'Label: no text']))
    const room = out.items.find((i) => i.type === 'room')!
    expect(room.type === 'room' && room.points).toHaveLength(3)
    expect(room.name).toBe('Hall')
    const zone = out.items.find((i) => i.type === 'zone')!
    expect(zone).toMatchObject({ name: 'Patio', unsure: true, unsureNote: 'No edge drawn' })
    expect(out.items.find((i) => i.type === 'patioEdge')).toBeDefined()
    const column = out.items.find((i) => i.type === 'column')!
    expect(column).toMatchObject({ x: 500, y: 375, width: 40, height: 40, shape: 'rect' })
    expect(out.items.find((i) => i.type === 'stairs')).toMatchObject({ rotation: 90, width: 100, height: 50 })
    expect(out.items.find((i) => i.type === 'bar')).toMatchObject({ label: 'Main bar', width: 200 })
    expect(out.items.find((i) => i.type === 'label')).toMatchObject({ text: 'HALL', fontSize: 20, x: 500, y: 300 })
  })

  it('snaps doors and windows onto their walls, and marks ones far from any wall', () => {
    const out = draftToFixedItems({ draft: draft(), cmPerPx: 5, newId: counter() })
    const ws = walls(out.items)
    const doors = out.items.filter((i): i is Door => i.type === 'door')
    // On wall a's top run, turned to the model's 180 degrees, swing unknown drawn as left.
    expect(doors[0]).toMatchObject({ wallId: ws[0].id, y: ws[0].points[0].y, rotation: 180, swing: 'left', width: 90, unsure: false })
    expect(doors[0].x).toBeCloseTo(500)
    // Far from every wall: left where it was and marked.
    expect(doors[1]).toMatchObject({ wallId: null, x: 3000, y: 3000, unsure: true, unsureNote: 'Not on a wall' })
    // The window had no width: the usual 120 cm, on the left wall, plumb.
    const win = out.items.find((i) => i.type === 'window')!
    expect(win).toMatchObject({ wallId: ws[1].id, width: 120 })
    // The model said 90, and the wall runs at 270: the snap keeps the model's way round.
    expect(win.type === 'window' && win.rotation).toBe(90)
  })

  it('refuses a scale that is not a positive number', () => {
    expect(() => draftToFixedItems({ draft: emptyDraft(), cmPerPx: 0 })).toThrow()
    expect(draftToFixedItems({ draft: emptyDraft(), cmPerPx: 1 }).items).toEqual([])
  })

  it('makes random ids by default', () => {
    const out = draftToFixedItems({ draft: draft(), cmPerPx: 5 })
    const ids = out.items.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/)
  })
})
