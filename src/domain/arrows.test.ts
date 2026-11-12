import { describe, expect, it } from 'vitest'
import { emptyCanvas, type Canvas, type Fixture, type Item, type Note, type Table } from './canvas-schema'
import {
  anchorOutline,
  anchorPoint,
  arrowBox,
  arrowsAttachedTo,
  attachedIds,
  attachedItem,
  attachTargetAt,
  detachDeleted,
  detachOutside,
  isArrowNote,
  isAttachable,
  otherEnd,
  outlineContains,
  placeArrowEnd,
  releaseEnds,
  resolveArrow,
  resolveArrowLocal,
  resolvedItems,
  storedEnds,
  withEnds,
  withResolvedEnds,
} from './arrows'
import { distance, localToWorld, worldToLocal, type Point } from './geometry'
import { makeNote } from './notes'
import { makeItem } from './presets'
import { CHAIR_DEPTH_CM } from './seats'

/** A note author: the signed-in user's name and account id. */
const NOA = { name: 'Noa', id: '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a' }

const NOW = Date.UTC(2026, 10, 10, 12, 0, 0)

function canvasOf(items: Item[]): Canvas {
  return { ...emptyCanvas(), items }
}

const round = (id: string, x = 0, y = 0, patch: Partial<Table> = {}): Table => ({ ...(makeItem('round', { x, y }, id, emptyCanvas()) as Table), ...patch })
const rect = (id: string, x = 0, y = 0, patch: Partial<Table> = {}): Table => ({ ...(makeItem('rect', { x, y }, id, emptyCanvas()) as Table), ...patch })
const head = (id: string, x = 0, y = 0): Table => makeItem('head', { x, y }, id, emptyCanvas()) as Table
const bar = (id: string, x = 0, y = 0, rotation = 0): Fixture => ({ ...(makeItem('bar', { x, y }, id, emptyCanvas()) as Fixture), rotation })

function arrow(id: string, start: Point, end: Point, attachedTo: Note['attachedTo'] = { start: null, end: null }): Note {
  const note = makeNote('arrow', { x: 0, y: 0 }, NOA, 'blue', NOW, id)
  return withEnds({ ...note, attachedTo }, start, end)
}

function expectPoint(p: Point, x: number, y: number) {
  expect(p.x).toBeCloseTo(x, 6)
  expect(p.y).toBeCloseTo(y, 6)
}

/** On the outline: one local coordinate at its half size, the other within it. */
function expectOnOutline(item: Item, p: Point) {
  const o = anchorOutline(item)
  if (o.kind === 'circle') {
    expect(distance(p, o)).toBeCloseTo(o.r, 6)
    return
  }
  const l = worldToLocal({ x: o.x, y: o.y, rotation: o.rotation }, p)
  const onX = Math.abs(Math.abs(l.x) - o.halfW) < 1e-6 && Math.abs(l.y) <= o.halfH + 1e-6
  const onY = Math.abs(Math.abs(l.y) - o.halfH) < 1e-6 && Math.abs(l.x) <= o.halfW + 1e-6
  expect(onX || onY).toBe(true)
}

/** On the ray from the item's center through `towards`. */
function expectOnRay(item: Item, towards: Point, p: Point) {
  const dx = towards.x - item.x
  const dy = towards.y - item.y
  const px = p.x - item.x
  const py = p.y - item.y
  expect(dx * py - dy * px).toBeCloseTo(0, 4)
  expect(dx * px + dy * py).toBeGreaterThan(0)
}

describe('kinds', () => {
  it('knows arrows, lines and what they attach to', () => {
    expect(isArrowNote(makeNote('arrow', { x: 0, y: 0 }, NOA, 'blue', NOW, 'a'))).toBe(true)
    expect(isArrowNote(makeNote('line', { x: 0, y: 0 }, NOA, 'blue', NOW, 'a'))).toBe(true)
    expect(isArrowNote(makeNote('sticky', { x: 0, y: 0 }, NOA, 'blue', NOW, 'a'))).toBe(false)
    expect(isArrowNote(undefined)).toBe(false)
    expect(isAttachable(round('t'))).toBe(true)
    expect(isAttachable(bar('b'))).toBe(true)
    expect(isAttachable(makeItem('box', { x: 0, y: 0 }, 's', emptyCanvas()))).toBe(false)
    expect(isAttachable(makeNote('sticky', { x: 0, y: 0 }, NOA, 'blue', NOW, 'n'))).toBe(false)
    expect(otherEnd('start')).toBe('end')
    expect(otherEnd('end')).toBe('start')
  })
})

describe('anchorPoint', () => {
  it('touches the chair ring of a round table, in any direction', () => {
    const t = round('t', 100, 50)
    const r = 152.4 / 2 + CHAIR_DEPTH_CM
    expectPoint(anchorPoint(t, { x: 1000, y: 50 }), 100 + r, 50)
    expectPoint(anchorPoint(t, { x: 100, y: -900 }), 100, 50 - r)
    const diag = anchorPoint(t, { x: 600, y: 550 })
    expect(distance(diag, t)).toBeCloseTo(r, 6)
    expectOnRay(t, { x: 600, y: 550 }, diag)
  })

  it('uses the table edge when a round table has no seats', () => {
    const t = round('t', 0, 0, { seatCount: 0, seats: [] })
    expectPoint(anchorPoint(t, { x: 0, y: 500 }), 0, 76.2)
  })

  it('takes chairs only on the sides that have them', () => {
    // 8 ft by 30 in, seats on the long sides only.
    const t = rect('t')
    expectPoint(anchorPoint(t, { x: 1000, y: 0 }), 243.84 / 2, 0)
    expectPoint(anchorPoint(t, { x: 0, y: 1000 }), 0, 38.1 + CHAIR_DEPTH_CM)
    expectPoint(anchorPoint(t, { x: 0, y: -1000 }), 0, -(38.1 + CHAIR_DEPTH_CM))
    // A head table seats its back edge only: chairs above, none below.
    const h = head('h')
    expectPoint(anchorPoint(h, { x: 0, y: -1000 }), 0, -(38.1 + CHAIR_DEPTH_CM))
    expectPoint(anchorPoint(h, { x: 0, y: 1000 }), 0, 38.1)
  })

  it('turns with the table', () => {
    const towards = { x: 1000, y: 0 }
    // Turned a quarter: the long side with chairs faces right.
    expectPoint(anchorPoint(rect('t', 0, 0, { rotation: 90 }), towards), 38.1 + CHAIR_DEPTH_CM, 0)
    expectPoint(anchorPoint(rect('t', 0, 0, { rotation: 180 }), towards), 243.84 / 2, 0)
    for (const rotation of [0, 15, 30, 45, 60, 90, 135, 200, 315]) {
      for (const aim of [towards, { x: -300, y: 700 }, { x: 50, y: -40 }]) {
        const t = rect('t', 20, -30, { rotation })
        const p = anchorPoint(t, aim)
        expectOnOutline(t, p)
        expectOnRay(t, aim, p)
      }
    }
  })

  it('works from a head table center that is not its footprint center', () => {
    for (const rotation of [0, 30, 120, 270]) {
      const h = { ...head('h', 300, 300), rotation }
      for (const aim of [{ x: 300, y: -500 }, { x: 900, y: 320 }, { x: 250, y: 900 }]) {
        const p = anchorPoint(h, aim)
        expectOnOutline(h, p)
        expectOnRay(h, aim, p)
      }
    }
  })

  it('uses a fixture body, turned', () => {
    const b = bar('b', 100, 100)
    expectPoint(anchorPoint(b, { x: 100, y: 1000 }), 100, 100 + 60.96 / 2)
    for (const rotation of [0, 45, 100, 330]) {
      const f = bar('b', 100, 100, rotation)
      const aim = { x: -400, y: 260 }
      const p = anchorPoint(f, aim)
      expectOnOutline(f, p)
      expectOnRay(f, aim, p)
    }
  })

  it('gives the center when aimed at the center', () => {
    expectPoint(anchorPoint(round('t', 5, 6), { x: 5, y: 6 }), 5, 6)
    expectPoint(anchorPoint(rect('t', 5, 6), { x: 5, y: 6 }), 5, 6)
  })

  it('tells when a point is inside an outline', () => {
    const t = round('t')
    expect(outlineContains(anchorOutline(t), { x: 120, y: 0 })).toBe(true)
    expect(outlineContains(anchorOutline(t), { x: 135, y: 0 })).toBe(false)
    expect(outlineContains(anchorOutline(t), { x: 135, y: 0 }, 10)).toBe(true)
    const r = rect('r', 0, 0, { rotation: 90 })
    expect(outlineContains(anchorOutline(r), { x: 0, y: 120 })).toBe(true)
    expect(outlineContains(anchorOutline(r), { x: 120, y: 0 })).toBe(false)
  })
})

describe('resolveArrow', () => {
  it('draws free ends where they are stored', () => {
    const a = arrow('a', { x: -50, y: 10 }, { x: 150, y: 90 })
    expect(resolveArrow(a, canvasOf([a]))).toEqual(storedEnds(a))
    expectPoint(storedEnds(a).start, -50, 10)
    expectPoint(storedEnds(a).end, 150, 90)
  })

  it('puts an attached end on the chair ring, aimed at the free end', () => {
    const t = round('t')
    const a = arrow('a', { x: 0, y: 0 }, { x: 500, y: 0 }, { start: 't', end: null })
    const r = resolveArrow(a, canvasOf([t, a]))
    expectPoint(r.start, 76.2 + CHAIR_DEPTH_CM, 0)
    expectPoint(r.end, 500, 0)
    expect(attachedItem(a, 'start', canvasOf([t, a]))).toBe(t)
    expect(attachedItem(a, 'end', canvasOf([t, a]))).toBeNull()
  })

  it('aims two attached ends at each other', () => {
    const t = round('t')
    const b = bar('b', 600, 0)
    const a = arrow('a', { x: 0, y: 0 }, { x: 0, y: 0 }, { start: 't', end: 'b' })
    const r = resolveArrow(a, canvasOf([t, b, a]))
    expectPoint(r.start, 76.2 + CHAIR_DEPTH_CM, 0)
    expectPoint(r.end, 600 - 182.88 / 2, 0)
  })

  it('falls back to the stored point when the item is gone or cannot hold an arrow', () => {
    const box = makeItem('box', { x: 0, y: 0 }, 's', emptyCanvas())
    const a = arrow('a', { x: 10, y: 20 }, { x: 300, y: 20 }, { start: 'gone', end: 's' })
    expect(resolveArrow(a, canvasOf([box, a]))).toEqual(storedEnds(a))
    // An arrow never attaches to itself.
    const self = arrow('a', { x: 10, y: 20 }, { x: 300, y: 20 }, { start: 'a', end: null })
    expect(resolveArrow(self, canvasOf([self]))).toEqual(storedEnds(self))
  })

  it('follows a table that moves, with no change to the arrow', () => {
    const t = round('t')
    const a = arrow('a', { x: 0, y: 0 }, { x: 600, y: 0 }, { start: 't', end: null })
    const moved = canvasOf([{ ...t, x: 0, y: 400 }, a])
    const r = resolveArrow(a, moved)
    const ring = 76.2 + CHAIR_DEPTH_CM
    expect(distance(r.start, { x: 0, y: 400 })).toBeCloseTo(ring, 6)
    expectOnRay(moved.items[0], { x: 600, y: 0 }, r.start)
    expectPoint(r.end, 600, 0)
  })

  it('follows a table that turns and resizes', () => {
    const t = rect('t')
    const a = arrow('a', { x: 0, y: 0 }, { x: 800, y: 0 }, { start: 't', end: null })
    expectPoint(resolveArrow(a, canvasOf([t, a])).start, 243.84 / 2, 0)
    const turned = { ...t, rotation: 90 }
    expectPoint(resolveArrow(a, canvasOf([turned, a])).start, 38.1 + CHAIR_DEPTH_CM, 0)
    const wider = { ...t, width: 400 }
    expectPoint(resolveArrow(a, canvasOf([wider, a])).start, 200, 0)
  })

  it('gives the ends in the note frame too', () => {
    const t = round('t')
    const a = arrow('a', { x: 0, y: 0 }, { x: 500, y: 0 }, { start: 't', end: null })
    const local = resolveArrowLocal(a, canvasOf([t, a]))
    expectPoint(localToWorld(a, local.start), 76.2 + CHAIR_DEPTH_CM, 0)
    expectPoint(localToWorld(a, local.end), 500, 0)
  })

  it('lists the ids an arrow holds', () => {
    expect(attachedIds(arrow('a', { x: 0, y: 0 }, { x: 1, y: 0 }, { start: 't', end: 'b' }))).toEqual(['t', 'b'])
    expect(attachedIds(arrow('a', { x: 0, y: 0 }, { x: 1, y: 0 }))).toEqual([])
  })
})

describe('withEnds', () => {
  it('centers the note between its ends, unrotated, boxed by them', () => {
    const a = arrow('a', { x: 0, y: 0 }, { x: 100, y: 40 })
    expect(a).toMatchObject({ x: 50, y: 20, rotation: 0, width: 100, height: 40, points: [{ x: -50, y: -20 }, { x: 50, y: 20 }] })
    // A vertical arrow keeps a positive width.
    expect(withEnds(a, { x: 0, y: 0 }, { x: 0, y: 200 })).toMatchObject({ width: 1, height: 200 })
  })

  it('gives the same note when the ends do not move', () => {
    const a = arrow('a', { x: 0, y: 0 }, { x: 100, y: 40 })
    expect(withEnds(a, { x: 0, y: 0 }, { x: 100, y: 40 })).toBe(a)
  })

  it('bakes a turned note into rotation 0', () => {
    const a = { ...arrow('a', { x: -100, y: 0 }, { x: 100, y: 0 }), rotation: 90 }
    const ends = storedEnds(a)
    const b = withEnds(a, ends.start, ends.end)
    expect(b.rotation).toBe(0)
    expectPoint(storedEnds(b).start, 0, -100)
    expectPoint(storedEnds(b).end, 0, 100)
  })
})

describe('resolved items', () => {
  it('moves attached arrows to their drawn ends and keeps the rest', () => {
    const t = round('t')
    const free = arrow('f', { x: 0, y: 500 }, { x: 100, y: 500 })
    const a = arrow('a', { x: 0, y: 0 }, { x: 500, y: 0 }, { start: 't', end: null })
    const canvas = canvasOf([t, free, a])
    const items = resolvedItems(canvas)
    expect(items[0]).toBe(t)
    expect(items[1]).toBe(free)
    const r = items[2] as Note
    expect(r.attachedTo).toEqual({ start: 't', end: null })
    expectPoint(storedEnds(r).start, 76.2 + CHAIR_DEPTH_CM, 0)
    expect(resolvedItems(canvas)).toBe(items)
    expect(resolvedItems(canvasOf([t, free]))).toEqual([t, free])
  })

  it('keeps the same resolved object while the drawn ends stay put', () => {
    const t = round('t')
    const a = arrow('a', { x: 0, y: 0 }, { x: 500, y: 0 }, { start: 't', end: null })
    const other = round('o', 0, 900)
    const one = withResolvedEnds(a, canvasOf([t, other, a]))
    const two = withResolvedEnds(a, canvasOf([t, { ...other, x: 50 }, a]))
    expect(two).toBe(one)
    const three = withResolvedEnds(a, canvasOf([{ ...t, y: 10 }, other, a]))
    expect(three).not.toBe(one)
  })

  it('boxes an arrow by its drawn ends', () => {
    const t = round('t')
    const a = arrow('a', { x: 0, y: 0 }, { x: 500, y: 100 }, { start: 't', end: null })
    const box = arrowBox(a, canvasOf([t, a]))
    expect(box.maxX).toBeCloseTo(500, 6)
    expect(box.maxY).toBeCloseTo(100, 6)
    expect(box.minX).toBeGreaterThan(100)
  })
})

describe('letting go', () => {
  it('leaves a deleted item’s end as a free point where it was drawn', () => {
    const t = { ...rect('t', 0, 0), rotation: 30 }
    const a = arrow('a', { x: 0, y: 0 }, { x: 700, y: 50 }, { start: 't', end: null })
    const canvas = canvasOf([t, a])
    const drawn = resolveArrow(a, canvas)
    const out = detachDeleted(canvas, new Set(['t']))
    const freed = out.items[1] as Note
    expect(freed.attachedTo).toEqual({ start: null, end: null })
    const ends = storedEnds(freed)
    expectPoint(ends.start, drawn.start.x, drawn.start.y)
    expectPoint(ends.end, 700, 50)
    expect(out.items[0]).toBe(t)
  })

  it('keeps the canvas when no arrow pointed at the deleted items', () => {
    const t = round('t')
    const a = arrow('a', { x: 0, y: 0 }, { x: 700, y: 50 }, { start: 't', end: null })
    const canvas = canvasOf([t, round('u', 900), a])
    expect(detachDeleted(canvas, new Set(['u']))).toBe(canvas)
    expect(detachDeleted(canvas, new Set())).toBe(canvas)
  })

  it('keeps the other end attached', () => {
    const t = round('t')
    const b = bar('b', 600, 0)
    const a = arrow('a', { x: 0, y: 0 }, { x: 0, y: 0 }, { start: 't', end: 'b' })
    const out = detachDeleted(canvasOf([t, b, a]), new Set(['t']))
    expect((out.items[2] as Note).attachedTo).toEqual({ start: null, end: 'b' })
  })

  it('lets go only of items not copied along', () => {
    const t = round('t')
    const b = bar('b', 600, 0)
    const a = arrow('a', { x: 0, y: 0 }, { x: 0, y: 0 }, { start: 't', end: 'b' })
    const canvas = canvasOf([t, b, a])
    const [, copied] = detachOutside([t, a], canvas) as [Table, Note]
    expect(copied.attachedTo).toEqual({ start: 't', end: null })
    expectPoint(storedEnds(copied).end, resolveArrow(a, canvas).end.x, 0)
    const sticky = makeNote('sticky', { x: 0, y: 0 }, NOA, 'yellow', NOW, 'n')
    expect(detachOutside([sticky], canvas)[0]).toBe(sticky)
  })

  it('releases ends of a non-arrow note without moving it', () => {
    const sticky = { ...makeNote('sticky', { x: 0, y: 0 }, NOA, 'yellow', NOW, 'n'), attachedTo: { start: 't', end: null } }
    const out = releaseEnds(sticky, canvasOf([sticky]), () => true)
    expect(out).toMatchObject({ x: 0, y: 0, attachedTo: { start: null, end: null } })
  })
})

describe('placeArrowEnd', () => {
  const t = round('t')
  const b = bar('b', 600, 0)
  const base = arrow('a', { x: -300, y: 300 }, { x: 300, y: 300 })
  const canvas = canvasOf([t, b, base])

  it('attaches an end to a table or fixture', () => {
    const a = placeArrowEnd(base, 'end', { x: 10, y: 5 }, 't', canvas)
    expect(a.attachedTo).toEqual({ start: null, end: 't' })
    const ends = storedEnds(a)
    expectPoint(ends.start, -300, 300)
    expect(distance(ends.end, t)).toBeCloseTo(76.2 + CHAIR_DEPTH_CM, 6)
    expectOnRay(t, { x: -300, y: 300 }, ends.end)
  })

  it('frees an end at the point', () => {
    const attached = placeArrowEnd(base, 'end', { x: 0, y: 0 }, 't', canvas)
    const freed = placeArrowEnd(attached, 'end', { x: 40, y: -60 }, null, canvas)
    expect(freed.attachedTo.end).toBeNull()
    expectPoint(storedEnds(freed).end, 40, -60)
  })

  it('never puts both ends on one item, nor an end on a shape, a note or a missing id', () => {
    const one = placeArrowEnd(base, 'start', { x: 0, y: 0 }, 't', canvas)
    const both = placeArrowEnd(one, 'end', { x: 20, y: 0 }, 't', canvas)
    expect(both.attachedTo).toEqual({ start: 't', end: null })
    expectPoint(storedEnds(both).end, 20, 0)
    const box = makeItem('box', { x: 0, y: 900 }, 's', emptyCanvas())
    const withBox = canvasOf([t, b, box, base])
    expect(placeArrowEnd(base, 'end', { x: 0, y: 900 }, 's', withBox).attachedTo.end).toBeNull()
    expect(placeArrowEnd(base, 'end', { x: 0, y: 900 }, 'a', withBox).attachedTo.end).toBeNull()
    expect(placeArrowEnd(base, 'end', { x: 0, y: 900 }, 'nope', withBox).attachedTo.end).toBeNull()
  })

  it('aims the other attached end at the moved free end', () => {
    const one = placeArrowEnd(base, 'start', { x: 0, y: 0 }, 't', canvas)
    const moved = placeArrowEnd(one, 'end', { x: 0, y: 500 }, null, canvas)
    expectPoint(storedEnds(moved).start, 0, 76.2 + CHAIR_DEPTH_CM)
  })
})

describe('attachTargetAt', () => {
  const t = round('t')
  const b = bar('b', 600, 0)
  const top = round('top', 650, 0)
  const canvas = canvasOf([t, b, top, makeNote('sticky', { x: 0, y: 0 }, NOA, 'yellow', NOW, 'n')])

  it('finds the topmost table or fixture, chairs included', () => {
    expect(attachTargetAt(canvas, { x: 0, y: 0 })?.id).toBe('t')
    // In the chair ring, past the table top.
    expect(attachTargetAt(canvas, { x: 120, y: 0 })?.id).toBe('t')
    expect(attachTargetAt(canvas, { x: 140, y: 0 })).toBeNull()
    expect(attachTargetAt(canvas, { x: 140, y: 0 }, 12)?.id).toBe('t')
    expect(attachTargetAt(canvas, { x: 600, y: 0 })?.id).toBe('top')
    expect(attachTargetAt(canvas, { x: 600, y: 0 }, 0, (i) => i.id !== 'top')?.id).toBe('b')
  })

  it('lists arrows attached to items', () => {
    const a = arrow('a', { x: 0, y: 0 }, { x: 1, y: 0 }, { start: null, end: 't' })
    const c = arrow('c', { x: 0, y: 0 }, { x: 1, y: 0 }, { start: 'b', end: null })
    const all = canvasOf([t, b, a, c])
    expect(arrowsAttachedTo(all, new Set(['t'])).map((n) => n.id)).toEqual(['a'])
    expect(arrowsAttachedTo(all, new Set(['t', 'b'])).map((n) => n.id)).toEqual(['a', 'c'])
  })
})
