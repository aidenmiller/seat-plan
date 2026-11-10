import { describe, expect, it } from 'vitest'
import { emptyCanvas, type Canvas, type Table } from '@/domain/canvas-schema'
import { makeItem } from '@/domain/presets'
import { seatCenters } from '@/domain/seating'
import { clientToWorld, LIST_TARGET, NO_TARGET, planDrop, rectContains, resolveDragTarget, sameTarget, seatLabel, targetSeat, type ClientRect } from './drop'

function table(id: string, x: number, guests: (string | null)[] = []): Table {
  const t = makeItem('round', { x, y: 0 }, id, emptyCanvas()) as Table
  return { ...t, seats: t.seats.map((s, i) => ({ index: i, guestId: guests[i] ?? null })) }
}

function canvasOf(...tables: Table[]): Canvas {
  return { ...emptyCanvas(), items: tables }
}

/** The canvas sits at (100, 50) on the page, 1000 by 800; the camera puts world (0, 0) in its middle. */
const viewport: ClientRect = { left: 100, top: 50, width: 1000, height: 800 }
const camera = { zoom: 1, x: 500, y: 400 }
const list: ClientRect = { left: 1100, top: 50, width: 300, height: 800 }
const toClient = (p: { x: number; y: number }) => ({ x: p.x * camera.zoom + camera.x + viewport.left, y: p.y * camera.zoom + camera.y + viewport.top })

describe('where a dragged guest lands', () => {
  const c = canvasOf(table('a', 0, ['x']), table('b', 400, ['p', 'q', 'r', 's', 't', 'u', 'v', 'w']))
  const seatsA = seatCenters(c.items[0] as Table)
  const base = { canvas: c, camera, viewport, listZones: [list], guestId: 'g' }

  it('turns client points into world points through the viewport', () => {
    expect(clientToWorld(camera, viewport, { x: 600, y: 450 })).toEqual({ x: 0, y: 0 })
    expect(rectContains(viewport, { x: 100, y: 50 })).toBe(true)
    expect(rectContains(viewport, { x: 99, y: 50 })).toBe(false)
  })

  it('finds a seat, a taken seat, a table and a full table', () => {
    expect(resolveDragTarget({ ...base, client: toClient(seatsA[2]) })).toEqual({ kind: 'seat', itemId: 'a', seatIndex: 2, occupant: null })
    expect(resolveDragTarget({ ...base, client: toClient(seatsA[0]) })).toEqual({ kind: 'seat', itemId: 'a', seatIndex: 0, occupant: 'x' })
    expect(resolveDragTarget({ ...base, client: toClient({ x: 0, y: 0 }) })).toEqual({ kind: 'table', itemId: 'a', seatIndex: 1 })
    expect(resolveDragTarget({ ...base, client: toClient({ x: 400, y: 0 }) })).toEqual({ kind: 'full', itemId: 'b', label: 'Table 1' })
    expect(resolveDragTarget({ ...base, client: toClient({ x: -300, y: 300 }) })).toEqual(NO_TARGET)
  })

  it('takes the side list first, and nothing outside the canvas', () => {
    expect(resolveDragTarget({ ...base, client: { x: 1200, y: 300 } })).toBe(LIST_TARGET)
    // A sheet over the canvas wins over the table under it.
    expect(resolveDragTarget({ ...base, listZones: [{ left: 0, top: 0, width: 2000, height: 2000 }], client: toClient({ x: 0, y: 0 }) })).toBe(LIST_TARGET)
    expect(resolveDragTarget({ ...base, listZones: [], client: { x: 1200, y: 300 } })).toBe(NO_TARGET)
  })

  it('skips items the pointer cannot reach', () => {
    expect(resolveDragTarget({ ...base, client: toClient({ x: 0, y: 0 }), reachable: () => false })).toEqual(NO_TARGET)
  })

  it('names the growing seat and compares targets', () => {
    expect(targetSeat({ kind: 'table', itemId: 'a', seatIndex: 3 })).toEqual({ itemId: 'a', seatIndex: 3 })
    expect(targetSeat({ kind: 'seat', itemId: 'a', seatIndex: 2, occupant: null })).toEqual({ itemId: 'a', seatIndex: 2 })
    expect(targetSeat(LIST_TARGET)).toBeNull()
    expect(sameTarget({ kind: 'seat', itemId: 'a', seatIndex: 2, occupant: null }, { kind: 'seat', itemId: 'a', seatIndex: 2, occupant: null })).toBe(true)
    expect(sameTarget({ kind: 'seat', itemId: 'a', seatIndex: 2, occupant: null }, { kind: 'table', itemId: 'a', seatIndex: 2 })).toBe(false)
    expect(sameTarget(LIST_TARGET, { kind: 'list' })).toBe(true)
  })
})

describe('what a drop does', () => {
  const c = canvasOf(table('a', 0, ['x', null, 'y']), table('b', 400, ['p', 'q', 'r', 's', 't', 'u', 'v', 'w']))

  it('seats a guest from the list', () => {
    const plan = planDrop(c, 'g', { kind: 'seat', itemId: 'a', seatIndex: 1, occupant: null })
    expect(plan.kind).toBe('change')
    if (plan.kind !== 'change') return
    expect(plan.label).toBe('Seat guest')
    expect((plan.move.canvas.items[0] as Table).seats[1].guestId).toBe('g')
  })

  it('moves a seated guest, and swaps on a taken seat', () => {
    const moved = planDrop(c, 'x', { kind: 'table', itemId: 'a', seatIndex: 1 })
    expect(moved).toMatchObject({ kind: 'change', label: 'Move guest' })
    const swapped = planDrop(c, 'x', { kind: 'seat', itemId: 'b', seatIndex: 0, occupant: 'p' })
    expect(swapped.kind).toBe('change')
    if (swapped.kind !== 'change') return
    expect(swapped.label).toBe('Swap guests')
    expect((swapped.move.canvas.items[0] as Table).seats[0].guestId).toBe('p')
    expect((swapped.move.canvas.items[1] as Table).seats[0].guestId).toBe('x')
  })

  it('unseats a seated guest dropped on the list, and leaves a list guest alone', () => {
    const plan = planDrop(c, 'y', LIST_TARGET)
    expect(plan).toMatchObject({ kind: 'change', label: 'Unseat guest' })
    expect(planDrop(c, 'g', LIST_TARGET)).toEqual({ kind: 'none' })
  })

  it('changes nothing on a full table or nowhere, and names the full table', () => {
    expect(planDrop(c, 'g', { kind: 'full', itemId: 'b', label: 'Table 4' })).toEqual({ kind: 'full', message: 'Table 4 is full' })
    expect(planDrop(c, 'g', NO_TARGET)).toEqual({ kind: 'none' })
    // Already there.
    expect(planDrop(c, 'x', { kind: 'table', itemId: 'a', seatIndex: 0 })).toEqual({ kind: 'none' })
  })

  it('labels each kind of change', () => {
    expect(seatLabel({ canvas: c, changed: true, seat: null, from: { itemId: 'a', seatIndex: 0 }, displaced: null })).toBe('Unseat guest')
    expect(seatLabel({ canvas: c, changed: true, seat: { itemId: 'a', seatIndex: 1 }, from: null, displaced: { guestId: 'x', to: null } })).toBe('Seat guest')
  })
})
