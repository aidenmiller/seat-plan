import { describe, expect, it } from 'vitest'
import { emptyCanvas, type Canvas, type Table } from '@/domain/canvas-schema'
import { worldToScreen } from '@/domain/camera'
import { makeItem } from '@/domain/presets'
import { seatCenters } from '@/domain/seating'
import { PLUS_HIT_RADIUS_PX, plusSeatAt, plusShows, type PlusInput } from './plus'

function table(id: string, x: number, y: number, guests: (string | null)[] = []): Table {
  const t = makeItem('round', { x, y }, id, emptyCanvas()) as Table
  return { ...t, seats: t.seats.map((s, i) => ({ index: i, guestId: guests[i] ?? null })) }
}

const camera = { zoom: 1, x: 500, y: 400 }

function input(c: Canvas, o: Partial<PlusInput> = {}): PlusInput {
  return { canvas: c, camera, level: 'close', mode: 'edit', ...o }
}

describe('the + on empty seats', () => {
  it('shows in Edit mode at close and middle level only', () => {
    expect(plusShows('edit', 'close')).toBe(true)
    expect(plusShows('edit', 'middle')).toBe(true)
    expect(plusShows('edit', 'far')).toBe(false)
    expect(plusShows('view', 'close')).toBe(false)
    const c: Canvas = { ...emptyCanvas(), items: [table('a', 0, 0)] }
    const s1 = worldToScreen(camera, seatCenters(c.items[0] as Table)[1])
    expect(plusSeatAt(input(c), s1)).toMatchObject({ itemId: 'a', seatIndex: 1 })
    expect(plusSeatAt(input(c, { level: 'far' }), s1)).toBeNull()
    expect(plusSeatAt(input(c, { mode: 'view' }), s1)).toBeNull()
  })

  it('takes presses within 22 px of an empty seat, the nearest first, never a taken one', () => {
    const c: Canvas = { ...emptyCanvas(), items: [table('a', 0, 0, ['x', null, 'y'])] }
    const centers = seatCenters(c.items[0] as Table)
    const s1 = worldToScreen(camera, centers[1])
    expect(plusSeatAt(input(c), s1)).toEqual({ itemId: 'a', seatIndex: 1, world: centers[1] })
    expect(plusSeatAt(input(c), { x: s1.x, y: s1.y - PLUS_HIT_RADIUS_PX + 1 })).toMatchObject({ seatIndex: 1 })
    // Seat 0 is taken: right on it there is no + (seat 1 is further than 22 px away).
    expect(plusSeatAt(input(c), worldToScreen(camera, centers[0]))).toBeNull()
    // Zoomed out, 22 px reaches further in cm.
    const far = { zoom: 0.5, x: 500, y: 400 }
    const off = worldToScreen(far, { x: centers[1].x + 40, y: centers[1].y })
    expect(plusSeatAt(input(c, { camera: far, level: 'middle' }), off)).toMatchObject({ seatIndex: 1 })
    expect(plusSeatAt(input(c), worldToScreen(camera, { x: centers[1].x + 40, y: centers[1].y }))).toBeNull()
  })

  it('reaches every empty seat, however many there are, and skips items it may not reach (review finding)', () => {
    // 25 ten-seat tables at middle level: 250 empty seats, each with its own +.
    const items = Array.from({ length: 25 }, (_, i) => {
      const t = makeItem('round', { x: (i % 5) * 400 - 800, y: Math.floor(i / 5) * 400 - 800 }, `t${i}`, emptyCanvas()) as Table
      return { ...t, seatCount: 10, seats: Array.from({ length: 10 }, (_, index) => ({ index, guestId: null })) }
    })
    const c: Canvas = { ...emptyCanvas(), items }
    const cam = { zoom: 0.5, x: 720, y: 450 }
    let found = 0
    for (const t of items) {
      seatCenters(t).forEach((w, i) => {
        if (plusSeatAt(input(c, { camera: cam, level: 'middle' }), worldToScreen(cam, w))?.seatIndex === i) found++
      })
    }
    expect(found).toBe(250)
    const corner = worldToScreen(cam, seatCenters(items[24])[3])
    expect(plusSeatAt(input(c, { camera: cam, level: 'middle', reachable: (i) => i.id !== 't24' }), corner)).toBeNull()
  })
})
