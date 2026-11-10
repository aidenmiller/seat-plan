/**
 * The demo layouts' furniture (scripts/seed.ts), kept apart from the seed so
 * tests can build the same plans without a database: two reception plans and
 * a ceremony.
 */
import { randomUUID } from 'node:crypto'
import { emptyCanvas, type Canvas, type Item } from '../src/domain/canvas-schema'
import { blockDepth, generateSeatingBlock } from '../src/domain/ceremony'
import { makeItem, type PresetId } from '../src/domain/presets'
import { addRoundTable } from '../src/domain/round-table'
import { PLAN_A_TABLES } from './demo-guests'

/** Five Round preset tables (60 in, 8 seats), numbered 1 to 5 and set side by side, every seat empty. */
export function receptionPlanA(newId: () => string = randomUUID): Canvas {
  let canvas = emptyCanvas()
  for (let i = 0; i < PLAN_A_TABLES.length; i++) canvas = addRoundTable(canvas, newId())
  return canvas
}

/**
 * One of every table preset and fixture, set out like a small reception (cm,
 * centers): the head table seated along its back edge facing the dance
 * floor, the sweetheart table beside it, round, square and rectangle tables
 * around the floor, and the fixtures at the edges. Tables are numbered in the
 * order they are placed, every seat empty.
 */
export function canvasTour(newId: () => string = randomUUID): Canvas {
  const placed: [PresetId, number, number, number?][] = [
    ['stage', 0, -820],
    ['dj', 520, -820],
    ['head', 0, -470],
    ['sweetheart', -560, -470],
    ['danceFloor', 0, 0],
    ['round', -620, 0],
    ['round', 620, 0],
    ['square', -620, 480],
    ['rect', 620, 480],
    ['bar', -1060, 0, 90],
    ['food', 1060, 0, 90],
    ['cake', -300, 520],
    ['gifts', 0, 700],
    ['photoBooth', 1060, 560],
    ['text', 0, 1000],
  ]
  let canvas = emptyCanvas()
  for (const [preset, x, y, rotation = 0] of placed) {
    let item: Item = { ...makeItem(preset, { x, y }, newId(), canvas), rotation }
    if (item.kind === 'shape' && item.type === 'text') item = { ...item, text: 'Entrance', width: 240 }
    canvas = { ...canvas, items: [...canvas.items, item] }
  }
  return canvas
}

export const CEREMONY_FAMILY_ROW = 'Family, row 1'

/**
 * A ceremony on a blank canvas (spec section 8): the chuppah, the officiant
 * and the musicians at the front, the aisle runner, the seating block tool's
 * defaults (8 rows of 6 chairs each side of a 6 ft aisle, 20 in per chair,
 * 36 in from row to row) and the entrance and welcome sign at the back.
 * Row 1 on Noa's side is reserved for family without naming anyone; `named`
 * guests sit on row 1 of Aiden's side from the aisle out, in order (at most
 * one row's worth).
 */
export function ceremonyPlan(named: readonly string[] = [], newId: () => string = randomUUID): Canvas {
  const rows = generateSeatingBlock({ rows: 8, chairsPerRow: 6, origin: { x: 0, y: 0 } }, newId)
  const front = rows.filter((row) => row.rowNumber === 1)
  const seated = rows.map((row) => {
    if (row === front[0]) return { ...row, reservedFor: CEREMONY_FAMILY_ROW }
    if (row !== front[1]) return row
    // Aiden's side: seat 1 is at the aisle end ("left").
    return { ...row, seats: row.seats.map((seat, i) => ({ ...seat, guestId: named[i] ?? null })) }
  })
  const back = blockDepth(8)
  const fixtures: [PresetId, number, number, string?][] = [
    ['ceremonyStructure', 0, -420, 'Chuppah'],
    ['officiant', 0, -300],
    ['musicians', 520, -360],
    ['aisleRunner', 0, back / 2 - 60],
    ['welcomeSign', -300, back + 260],
    ['entrance', 0, back + 300],
  ]
  let canvas: Canvas = { ...emptyCanvas(), items: seated }
  for (const [preset, x, y, label] of fixtures) {
    let item: Item = makeItem(preset, { x, y }, newId(), canvas)
    if (label && item.kind === 'fixture') item = { ...item, label }
    canvas = { ...canvas, items: [...canvas.items, item] }
  }
  return canvas
}
