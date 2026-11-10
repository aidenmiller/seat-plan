/**
 * The demo layouts' furniture (scripts/seed.ts), kept apart from the seed so
 * tests can build the same plans without a database.
 */
import { randomUUID } from 'node:crypto'
import { emptyCanvas, type Canvas, type Item } from '../src/domain/canvas-schema'
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
