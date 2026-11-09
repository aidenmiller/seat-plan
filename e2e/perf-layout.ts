/**
 * The speed test's layout (PLAN section 6, "Speed target"; acceptance check
 * 27): 40 round tables of 10 seats, every seat taken, and 100 other shapes
 * (rectangles, circles, lines, text, walls, rooms, doors and windows), laid
 * out like a large reception room. Pure: the caller supplies ids and guests.
 */
import { emptyCanvas, type Canvas, type Item, type Table } from '../src/domain/canvas-schema'
import { makeItem, type PresetId } from '../src/domain/presets'

export const PERF_TABLES = 40
export const PERF_SEATS_PER_TABLE = 10
export const PERF_SHAPES = 100

const SHAPE_CYCLE: readonly PresetId[] = ['box', 'circle', 'line', 'text', 'wall', 'room', 'door', 'window', 'box', 'circle']

/** 400 made-up guest names, all different. */
export function perfGuestNames(): [string, string][] {
  const first = ['Ann', 'Ben', 'Cleo', 'Dev', 'Eli', 'Fay', 'Gus', 'Hana', 'Ivo', 'Jade', 'Kai', 'Lena', 'Milo', 'Nia', 'Omar', 'Pia', 'Quinn', 'Rosa', 'Sam', 'Tess']
  const last = ['Lee', 'Ray', 'Cohen', 'Diaz', 'Evans', 'Fox', 'Gold', 'Hart', 'Ito', 'Jones', 'Khan', 'Levi', 'Moss', 'Noor', 'Park', 'Quist', 'Reyes', 'Shaw', 'Tran', 'Vega']
  const names: [string, string][] = []
  for (let i = 0; i < PERF_TABLES * PERF_SEATS_PER_TABLE; i++) names.push([first[i % first.length], `${last[Math.floor(i / first.length) % last.length]}`])
  return names
}

/**
 * The layout: tables in 8 columns and 5 rows, 4 m apart, 72 in across with
 * 10 seats each; shapes in two bands above and below them. `guestIds` (400)
 * fill the seats in order; with none, the seats stay empty.
 */
export function perfCanvas(newId: () => string, guestIds: readonly string[] = []): Canvas {
  let canvas = emptyCanvas()
  const add = (item: Item) => {
    canvas = { ...canvas, items: [...canvas.items, item] }
  }
  for (let i = 0; i < PERF_TABLES; i++) {
    const col = i % 8
    const row = Math.floor(i / 8)
    const table = makeItem('round', { x: col * 400, y: row * 400 }, newId(), canvas) as Table
    const seats = Array.from({ length: PERF_SEATS_PER_TABLE }, (_, s) => ({ index: s, guestId: guestIds[i * PERF_SEATS_PER_TABLE + s] ?? null }))
    add({ ...table, width: 182.88, height: 182.88, seatCount: PERF_SEATS_PER_TABLE, seats })
  }
  for (let i = 0; i < PERF_SHAPES; i++) {
    const col = i % 25
    const band = Math.floor(i / 25)
    const y = band < 2 ? -600 - band * 300 : 2200 + (band - 2) * 300
    add(makeItem(SHAPE_CYCLE[i % SHAPE_CYCLE.length], { x: col * 120, y }, newId(), canvas))
  }
  return canvas
}
