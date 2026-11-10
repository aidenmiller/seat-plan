import { describe, expect, it } from 'vitest'
import type { Item, Table } from './canvas-schema'
import { itemFootprint, type Footprint, type Point } from './geometry'
import {
  fullLabel,
  initialsFor,
  LABEL_GAP_CM,
  labelCorners,
  labelsOverlap,
  layoutLabels,
  MAX_LABEL_FONT_CM,
  MAX_LABEL_ROOM_CM,
  shortLabel,
  wallSegments,
  type LabelName,
  type MeasureText,
  type SeatLabel,
  type Segment,
} from './labels'
import { seatLayout, SEAT_RADIUS_CM } from './seats'
import type { FixedItem } from './venue-schema'

const G = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
/** A fixed-width stand-in: every character is 0.6 em. */
const measure: MeasureText = (text, size) => [...text].length * 0.6 * size
const START = SEAT_RADIUS_CM + LABEL_GAP_CM

function table(overrides: Partial<Table> = {}): Table {
  const seatCount = overrides.seatCount ?? 8
  return {
    id: 't1',
    kind: 'table',
    shape: 'round',
    x: 0,
    y: 0,
    rotation: 0,
    locked: false,
    width: 152.4,
    height: 152.4,
    number: 1,
    name: 'Table 1',
    seatCount,
    seatSides: 'all',
    seats: Array.from({ length: seatCount }, (_, index) => ({ index, guestId: null })),
    ...overrides,
  }
}

/** Seats every seat with guests named "First<n> Last<n>"-ish from `names`, starting at guest number `from`. */
function seatAll(t: Table, from: number, names: Map<string, LabelName>, name = (n: number): LabelName => ({ firstName: `Ann${n}`, lastName: `Lee${n}` })): Table {
  const seats = t.seats.map((s, i) => {
    const id = G(from + i)
    names.set(id, name(from + i))
    return { index: s.index, guestId: id }
  })
  return { ...t, seats }
}

function labelsOf(map: Map<string, SeatLabel[]>, id: string): SeatLabel[] {
  return map.get(id) ?? []
}

function insideFootprint(f: Footprint, p: Point): boolean {
  if (f.kind === 'circle') return Math.hypot(p.x - f.x, p.y - f.y) < f.r - 1e-6
  const r = (-f.rotation * Math.PI) / 180
  const dx = p.x - f.x
  const dy = p.y - f.y
  const lx = dx * Math.cos(r) - dy * Math.sin(r)
  const ly = dx * Math.sin(r) + dy * Math.cos(r)
  return Math.abs(lx) < f.halfW - 1e-6 && Math.abs(ly) < f.halfH - 1e-6
}

/** Points along a label's text box: its four edges, sampled. */
function boxSamples(label: SeatLabel): Point[] {
  const c = labelCorners(label)
  const out: Point[] = []
  for (let e = 0; e < c.length; e++) {
    const a = c[e]
    const b = c[(e + 1) % c.length]
    for (let k = 0; k <= 10; k++) out.push({ x: a.x + ((b.x - a.x) * k) / 10, y: a.y + ((b.y - a.y) * k) / 10 })
  }
  return out
}

describe('names on labels', () => {
  it('gives initials, the full name, and first name with last initial', () => {
    expect(initialsFor({ firstName: 'Zoë', lastName: 'Kowalczyk' })).toBe('ZK')
    expect(initialsFor({ firstName: 'Anna', lastName: 'van der Berg' })).toBe('AV')
    expect(fullLabel({ firstName: ' Jane ', lastName: 'Doe ' })).toBe('Jane Doe')
    expect(shortLabel({ firstName: 'Jane', lastName: 'Doe' })).toBe('Jane D.')
    expect(shortLabel({ firstName: 'Łukasz', lastName: 'łowicki' })).toBe('Łukasz Ł.')
    expect(shortLabel({ firstName: 'Prince', lastName: '—' })).toBe('Prince')
  })
})

describe('layoutLabels (PLAN "Name labels")', () => {
  it('runs names straight out from the center of a round table, full size when nothing is in the way', () => {
    const names = new Map<string, LabelName>()
    const t = seatAll(table(), 1, names)
    const labels = labelsOf(layoutLabels({ tables: [t], zoom: 1, measure, names }), 't1')
    expect(labels).toHaveLength(8)
    const places = seatLayout(t)
    for (const label of labels) {
      const seat = places[label.seatIndex]
      const out = Math.atan2(seat.y - t.y, seat.x - t.x)
      expect((label.direction * Math.PI) / 180).toBeCloseTo(out, 9)
      expect(label.x).toBeCloseTo(seat.x + Math.cos(out) * START, 9)
      expect(label.y).toBeCloseTo(seat.y + Math.sin(out) * START, 9)
      expect(label.form).toBe('full')
      expect(label.fontSize).toBe(MAX_LABEL_FONT_CM)
      expect(label.room).toBe(MAX_LABEL_ROOM_CM)
      expect(label.length).toBeCloseTo(measure(label.text, label.fontSize), 9)
    }
  })

  it('never reads upside down: left and upward names turn round and end beside their seat', () => {
    const names = new Map<string, LabelName>()
    const t = seatAll(table({ seatCount: 12 }), 1, names)
    const labels = labelsOf(layoutLabels({ tables: [t], zoom: 1, measure, names }), 't1')
    for (const label of labels) {
      expect(label.rotation).toBeGreaterThan(-90)
      expect(label.rotation).toBeLessThanOrEqual(90)
      const flipped = !(label.direction > -90 && label.direction <= 90)
      expect(label.anchor).toBe(flipped ? 'end' : 'start')
    }
    // Seat 0 is at the top: the line points up and the text reads down toward the seat.
    expect(labels[0].direction).toBeCloseTo(-90, 9)
    expect(labels[0].rotation).toBeCloseTo(90, 9)
    expect(labels[0].anchor).toBe('end')
    // Seat 3 is at the right: plain left to right.
    expect(labels[3].direction).toBeCloseTo(0, 9)
    expect(labels[3].anchor).toBe('start')
    // Seat 9 is at the left: turned round.
    expect(Math.abs(labels[9].direction)).toBeCloseTo(180, 9)
    expect(labels[9].rotation).toBeCloseTo(0, 9)
    expect(labels[9].anchor).toBe('end')
  })

  it('runs names straight out from the edge on straight tables, end seats too (change 17)', () => {
    const names = new Map<string, LabelName>()
    const head = seatAll(table({ shape: 'rect', width: 731.52, height: 76.2, seatCount: 12, seatSides: 'oneSide' }), 1, names)
    const labels = labelsOf(layoutLabels({ tables: [head], zoom: 1, measure, names }), 't1')
    expect(labels).toHaveLength(12)
    for (const label of labels) expect(label.direction).toBeCloseTo(-90, 9)
    // Side by side: no two names of one table overlap.
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) expect(labelsOverlap(labels[i], labels[j])).toBe(false)

    const rect = seatAll(table({ shape: 'rect', width: 243.84, height: 76.2, seatCount: 8, seatSides: 'noEnds', rotation: 30 }), 20, names)
    const turned = labelsOf(layoutLabels({ tables: [rect], zoom: 1, measure, names }), 't1')
    for (const label of turned) {
      const top = label.seatIndex < 4
      expect(label.direction).toBeCloseTo(top ? -60 : 120, 9)
      // In the table's own frame the text runs straight up and down on both sides.
      expect(label.local.rotation).toBeCloseTo(-90, 9)
      expect(label.anchor).toBe(top ? 'start' : 'end')
    }
  })

  it('gives the anchor and turn in the table frame too', () => {
    const names = new Map<string, LabelName>()
    const t = seatAll(table({ x: 500, y: -200, rotation: 40 }), 1, names)
    for (const label of labelsOf(layoutLabels({ tables: [t], zoom: 1, measure, names }), 't1')) {
      const r = (40 * Math.PI) / 180
      expect(t.x + label.local.x * Math.cos(r) - label.local.y * Math.sin(r)).toBeCloseTo(label.x, 9)
      expect(t.y + label.local.x * Math.sin(r) + label.local.y * Math.cos(r)).toBeCloseTo(label.y, 9)
      const back = (((label.local.rotation + 40 - label.rotation) % 360) + 360) % 360
      expect(Math.min(back, 360 - back)).toBeCloseTo(0, 9)
    }
  })

  it('stops halfway to the next table chair ring', () => {
    const names = new Map<string, LabelName>()
    // Two 60 in rounds 5 ft apart at their edges; seat 2 of the left one faces the right one.
    const a = seatAll(table({ id: 'a' }), 1, names)
    const b = seatAll(table({ id: 'b', x: 304.8 }), 20, names)
    const out = layoutLabels({ tables: [a, b], zoom: 1, measure, names })
    const facing = labelsOf(out, 'a')[2]
    expect(facing.direction).toBeCloseTo(0, 9)
    const grow = (MAX_LABEL_FONT_CM * 1.2) / 2
    const seatX = 76.2 + 30.5
    const hit = 304.8 - (76.2 + 53 + grow) - seatX
    expect(facing.room).toBeCloseTo((hit - SEAT_RADIUS_CM) / 2 - LABEL_GAP_CM, 6)
    // About 14 cm: no name fits at 10 px or more, so the circle shows initials.
    expect(facing.form).toBe('initials')
    expect(facing.text).toBe('AL')
    expect(facing.fontSize).toBe(0)
    // The seat on the far side has the room it wants.
    expect(labelsOf(out, 'a')[6].form).toBe('full')
    // The matching seat on the other table gets the same room.
    expect(labelsOf(out, 'b')[6].room).toBeCloseTo(facing.room, 6)
  })

  it('stops halfway to a wall, and fits the full name at full size, then first name and initial shrunk to 10 px, then initials (spec order)', () => {
    const names = new Map<string, LabelName>()
    const t = table()
    const guest = G(1)
    names.set(guest, { firstName: 'Alexandra', lastName: 'Smith' })
    const seated = { ...t, seats: t.seats.map((s) => (s.index === 2 ? { ...s, guestId: guest } : s)) }
    const grow = (MAX_LABEL_FONT_CM * 1.2) / 2
    const seatX = 76.2 + 30.5
    /** A wall that leaves `room` cm for the name: hit at 2 * room + 30.5 cm from the seat. */
    const wallFor = (room: number): Segment[] => {
      const wallX = seatX + 2 * room + 30.5 + grow
      return [{ a: { x: wallX, y: -1000 }, b: { x: wallX, y: 1000 } }]
    }
    const at = (zoom: number, room = 100) => labelsOf(layoutLabels({ tables: [seated], walls: wallFor(room), zoom, measure, names }), 't1')[0]
    expect(at(1).room).toBeCloseTo(100, 6)
    // "Alexandra Smith" is 9 em: 144 cm at full size (16 cm) fits in 150 cm of room.
    expect(at(1, 150)).toMatchObject({ form: 'full', text: 'Alexandra Smith', fontSize: MAX_LABEL_FONT_CM })
    expect(at(0.8, 150)).toMatchObject({ form: 'full', fontSize: MAX_LABEL_FONT_CM })
    // In 100 cm it would fit at 11.1 cm, but the full name is never shrunk: "Alexandra S." (7.2 em) at 13.9 cm.
    expect(at(1)).toMatchObject({ form: 'short', text: 'Alexandra S.' })
    expect(at(1).fontSize).toBeCloseTo(100 / 7.2, 6)
    expect(at(1).length).toBeLessThanOrEqual(100 + 1e-6)
    expect(at(3)).toMatchObject({ form: 'short' })
    // At 75% 10 px is 13.3 cm: the short form still fits at 13.9 cm.
    expect(at(0.75)).toMatchObject({ form: 'short', text: 'Alexandra S.' })
    // At 70% 10 px is 14.3 cm: nothing fits.
    expect(at(0.7)).toMatchObject({ form: 'initials', text: 'AS', fontSize: 0, length: 0 })
    // A name with no shorter form shrinks itself, down to 10 px.
    names.set(guest, { firstName: 'Alexandrina', lastName: '' })
    expect(at(1)).toMatchObject({ form: 'full', text: 'Alexandrina' })
    expect(at(1).fontSize).toBeCloseTo(100 / 6.6, 6)
    names.set(guest, { firstName: 'Alexandra', lastName: 'Smith' })
    // Every fitted font is at least 10 px on screen.
    for (const zoom of [0.7, 0.8, 0.85, 0.9, 1, 1.5, 3, 8]) {
      const l = at(zoom)
      if (l.form !== 'initials') expect(l.fontSize * zoom).toBeGreaterThanOrEqual(10 - 1e-6)
    }
  })

  it('keeps names thinner than the space between seats on a crowded side', () => {
    const names = new Map<string, LabelName>()
    const t = seatAll(table({ shape: 'rect', width: 243.84, height: 76.2, seatCount: 30, seatSides: 'noEnds' }), 1, names)
    const labels = labelsOf(layoutLabels({ tables: [t], zoom: 2, measure, names }), 't1')
    const spacing = 243.84 / 15
    for (const l of labels) {
      expect(l.fontSize).toBeLessThanOrEqual(spacing * 0.8 + 1e-9)
      expect(l.form).not.toBe('initials')
    }
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) expect(labelsOverlap(labels[i], labels[j])).toBe(false)
  })

  it('skips empty seats and guests it has no name for, and gives seats inside another table no room', () => {
    const names = new Map<string, LabelName>([[G(1), { firstName: 'Ann', lastName: 'Lee' }]])
    const t = table({ seats: table().seats.map((s) => (s.index === 0 ? { ...s, guestId: G(1) } : s.index === 1 ? { ...s, guestId: G(2) } : s)) })
    const labels = labelsOf(layoutLabels({ tables: [t], zoom: 1, measure, names }), 't1')
    expect(labels.map((l) => l.seatIndex)).toEqual([0])
    // A second table on top of the first: the seat starts inside it.
    const over = layoutLabels({ tables: [t, table({ id: 't2', x: 10 })], zoom: 1, measure, names })
    expect(labelsOf(over, 't1')[0].form).toBe('initials')
    expect(labelsOf(over, 't2')).toEqual([])
  })

  it('leaves no two names overlapping, and none over another table, in a crowded mixed layout', () => {
    const names = new Map<string, LabelName>()
    const tables: Table[] = []
    let guest = 1
    const longName = (n: number): LabelName => ({ firstName: n % 3 === 0 ? 'Alexandrina' : 'Bo', lastName: n % 2 === 0 ? 'Montgomery-Smith' : 'Ng' })
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        const kind = (row + col) % 3
        const base =
          kind === 0
            ? table({ seatCount: 10, width: 182.88, height: 182.88 })
            : kind === 1
              ? table({ shape: 'rect', width: 243.84, height: 76.2, seatSides: 'noEnds', rotation: (row * 15) % 90 })
              : table({ shape: 'square', width: 121.92, height: 121.92, rotation: 45 })
        const t = seatAll({ ...base, id: `t${row}-${col}`, x: col * 380 + (row % 2) * 60, y: row * 360 }, guest, names, longName)
        guest += t.seats.length
        tables.push(t)
      }
    }
    tables.push(
      seatAll(table({ id: 'head', shape: 'rect', width: 731.52, height: 76.2, seatCount: 12, seatSides: 'oneSide', x: 600, y: -300 }), guest, names, longName),
    )
    const walls = wallSegments([
      {
        type: 'wall',
        id: 'w',
        unsure: false,
        unsureNote: '',
        thickness: 20,
        points: [
          { x: -300, y: -600 },
          { x: 1800, y: -600 },
          { x: 1800, y: 1500 },
          { x: -300, y: 1500 },
          { x: -300, y: -600 },
        ],
      },
    ])
    for (const zoom of [0.7, 1, 2, 5]) {
      const out = layoutLabels({ tables, walls, zoom, measure, names })
      const all: { table: Table; label: SeatLabel }[] = []
      for (const t of tables) for (const label of labelsOf(out, t.id)) all.push({ table: t, label })
      expect(all.length).toBe(tables.reduce((n, t) => n + t.seatCount, 0))
      const shown = all.filter((x) => x.label.form !== 'initials')
      expect(shown.length).toBeGreaterThan(0)
      for (let i = 0; i < shown.length; i++) {
        for (let j = i + 1; j < shown.length; j++) {
          expect(labelsOverlap(shown[i].label, shown[j].label), `${shown[i].table.id}:${shown[i].label.seatIndex} and ${shown[j].table.id}:${shown[j].label.seatIndex} at ${zoom}`).toBe(false)
        }
      }
      for (const { table: own, label } of shown) {
        expect(label.fontSize * zoom).toBeGreaterThanOrEqual(10 - 1e-6)
        expect(label.length).toBeLessThanOrEqual(label.room + 1e-6)
        const samples = boxSamples(label)
        for (const other of tables) {
          if (other.id === own.id) continue
          const f = itemFootprint(other)
          for (const p of samples) expect(insideFootprint(f, p), `${own.id}:${label.seatIndex} over ${other.id}`).toBe(false)
        }
      }
    }
  })

  it('reads walls from the venue and from wall and room shapes', () => {
    const fixed: FixedItem[] = [
      { type: 'wall', id: 'w1', unsure: false, unsureNote: '', thickness: 20, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }] },
      { type: 'room', id: 'r1', unsure: false, unsureNote: '', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] },
      { type: 'zone', id: 'z1', unsure: false, unsureNote: '', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] },
    ]
    const items: Item[] = [
      {
        id: 's1',
        kind: 'shape',
        type: 'wall',
        x: 100,
        y: 100,
        rotation: 90,
        locked: false,
        width: 200,
        height: 15,
        style: { stroke: '#000', fill: 'none', strokeWidth: 2 },
      },
    ]
    const segs = wallSegments(fixed, items)
    expect(segs).toHaveLength(2 + 3 + 1)
    expect(segs[0]).toEqual({ a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, halfWidth: 10 })
    const last = segs[5]
    expect(last.halfWidth).toBe(7.5)
    expect(last.a.x).toBeCloseTo(100, 9)
    expect(last.a.y).toBeCloseTo(0, 9)
    expect(last.b.y).toBeCloseTo(200, 9)
  })

  it('labels 400 seats at 40 tables in under 4 ms', () => {
    const names = new Map<string, LabelName>()
    const tables: Table[] = []
    for (let i = 0; i < 40; i++) {
      const t = table({ id: `t${i}`, seatCount: 10, width: 182.88, height: 182.88, x: (i % 8) * 420, y: Math.floor(i / 8) * 420, rotation: (i * 7) % 360 })
      tables.push(seatAll(t, i * 10 + 1, names, (n) => ({ firstName: `Guestname${n}`, lastName: `Family${n}` })))
    }
    const walls: Segment[] = [
      { a: { x: -300, y: -300 }, b: { x: 3300, y: -300 }, halfWidth: 10 },
      { a: { x: 3300, y: -300 }, b: { x: 3300, y: 2000 }, halfWidth: 10 },
      { a: { x: 3300, y: 2000 }, b: { x: -300, y: 2000 }, halfWidth: 10 },
      { a: { x: -300, y: 2000 }, b: { x: -300, y: -300 }, halfWidth: 10 },
    ]
    const run = () => layoutLabels({ tables, walls, zoom: 1, measure, names })
    for (let i = 0; i < 30; i++) run()
    const times: number[] = []
    for (let i = 0; i < 31; i++) {
      const start = performance.now()
      run()
      times.push(performance.now() - start)
    }
    times.sort((a, b) => a - b)
    // The quickest quarter: other test files share the CPU while this runs, and a busy moment must not decide it.
    expect(times[Math.floor(times.length / 4)]).toBeLessThan(4)
    expect([...run().values()].reduce((n, l) => n + l.length, 0)).toBe(400)
  })
})
