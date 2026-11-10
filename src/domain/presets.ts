/**
 * What the shape panel adds (spec section 4, "Adding and editing shapes";
 * PLAN section 6, "Tables and seats"; spec section 5, "Blank canvas").
 * Every size is in cm. Shape and note points are offsets from the item's
 * center in its own frame; style stroke widths are in cm too.
 */
import type { Canvas, ChairRow, Fixture, Item, Shape, Table } from './canvas-schema'
import { chairRowLength, type Point } from './geometry'
import { CHAIR_DEPTH_CM, emptySeats, SEAT_DIAMETER_CM } from './seats'

export type TablePresetId = 'round' | 'square' | 'rect' | 'head' | 'sweetheart'
export type ReceptionFixturePresetId = 'food' | 'bar' | 'dj' | 'danceFloor' | 'stage' | 'cake' | 'gifts' | 'photoBooth'
export type CeremonyFixturePresetId = 'ceremonyStructure' | 'officiant' | 'aisleRunner' | 'musicians' | 'soundDesk' | 'welcomeSign' | 'entrance'
export type FixturePresetId = ReceptionFixturePresetId | CeremonyFixturePresetId
export type ShapePresetId = 'box' | 'circle' | 'line' | 'text'
export type WallPresetId = 'wall' | 'room' | 'door' | 'window'
export type PresetId = TablePresetId | FixturePresetId | ShapePresetId | WallPresetId | 'chairRow'
export type PresetGroup = 'tables' | 'fixtures' | 'shapes' | 'walls' | 'rows'

export type TablePreset = {
  id: TablePresetId
  group: 'tables'
  label: string
  shape: Table['shape']
  width: number
  height: number
  seatCount: number
  seatSides: Table['seatSides']
}

export type FixturePreset = {
  id: FixturePresetId
  group: 'fixtures'
  label: string
  type: Fixture['type']
  width: number
  height: number
}

export type ShapePreset = {
  id: ShapePresetId | WallPresetId
  group: 'shapes' | 'walls'
  label: string
  type: Shape['type']
  width: number
  height: number
  points?: Point[]
  text?: string
  style: Shape['style']
}

/** A single ceremony chair row (spec section 8). */
export type ChairRowPreset = {
  id: 'chairRow'
  group: 'rows'
  label: string
  chairCount: number
  spacing: number
  width: number
  height: number
}

export type Preset = TablePreset | FixturePreset | ShapePreset | ChairRowPreset

export const TABLE_PRESETS: readonly TablePreset[] = [
  { id: 'round', group: 'tables', label: 'Round', shape: 'round', width: 152.4, height: 152.4, seatCount: 8, seatSides: 'all' },
  { id: 'square', group: 'tables', label: 'Square', shape: 'square', width: 121.92, height: 121.92, seatCount: 8, seatSides: 'all' },
  { id: 'rect', group: 'tables', label: 'Rectangle', shape: 'rect', width: 243.84, height: 76.2, seatCount: 8, seatSides: 'noEnds' },
  { id: 'head', group: 'tables', label: 'Long head table', shape: 'rect', width: 731.52, height: 76.2, seatCount: 12, seatSides: 'oneSide' },
  // Two seats on a round table sit side by side on the back arc (DECISIONS 6).
  { id: 'sweetheart', group: 'tables', label: 'Sweetheart', shape: 'round', width: 91.44, height: 91.44, seatCount: 2, seatSides: 'all' },
]

export const FIXTURE_PRESETS: readonly FixturePreset[] = [
  { id: 'food', group: 'fixtures', label: 'Food', type: 'food', width: 182.88, height: 76.2 },
  { id: 'bar', group: 'fixtures', label: 'Bar', type: 'bar', width: 182.88, height: 60.96 },
  { id: 'dj', group: 'fixtures', label: 'DJ', type: 'dj', width: 182.88, height: 91.44 },
  { id: 'danceFloor', group: 'fixtures', label: 'Dance floor', type: 'danceFloor', width: 487.68, height: 487.68 },
  { id: 'stage', group: 'fixtures', label: 'Stage', type: 'stage', width: 487.68, height: 243.84 },
  { id: 'cake', group: 'fixtures', label: 'Cake', type: 'cake', width: 91.44, height: 91.44 },
  { id: 'gifts', group: 'fixtures', label: 'Gifts', type: 'gifts', width: 182.88, height: 76.2 },
  { id: 'photoBooth', group: 'fixtures', label: 'Photo booth', type: 'photoBooth', width: 243.84, height: 243.84 },
]

/** Ceremony fixtures (spec section 8). The structure's label is editable: arch, chuppah, altar or anything else. */
export const CEREMONY_FIXTURE_PRESETS: readonly FixturePreset[] = [
  { id: 'ceremonyStructure', group: 'fixtures', label: 'Arch', type: 'ceremonyStructure', width: 243.84, height: 60.96 },
  { id: 'officiant', group: 'fixtures', label: 'Officiant', type: 'officiant', width: 76.2, height: 76.2 },
  { id: 'aisleRunner', group: 'fixtures', label: 'Aisle', type: 'aisleRunner', width: 91.44, height: 914.4 },
  { id: 'musicians', group: 'fixtures', label: 'Musicians', type: 'musicians', width: 243.84, height: 182.88 },
  { id: 'soundDesk', group: 'fixtures', label: 'Sound desk', type: 'soundDesk', width: 121.92, height: 60.96 },
  { id: 'welcomeSign', group: 'fixtures', label: 'Welcome sign', type: 'welcomeSign', width: 121.92, height: 45.72 },
  { id: 'entrance', group: 'fixtures', label: 'Entrance', type: 'entrance', width: 182.88, height: 45.72 },
]

/** 10 chairs, 20 in apart. */
export const CHAIR_ROW_PRESET: ChairRowPreset = {
  id: 'chairRow',
  group: 'rows',
  label: 'Chair row',
  chairCount: 10,
  spacing: 50.8,
  width: chairRowLength({ chairCount: 10, spacing: 50.8 }),
  height: SEAT_DIAMETER_CM,
}

const LINE_COLOR = '#374151'
const SHAPE_STROKE = '#6b7280'
const SHAPE_FILL = '#f3f4f6'
const WALL_THICKNESS_CM = 15

export const SHAPE_PRESETS: readonly ShapePreset[] = [
  { id: 'box', group: 'shapes', label: 'Rectangle', type: 'rect', width: 121.92, height: 121.92, style: { stroke: SHAPE_STROKE, fill: SHAPE_FILL, strokeWidth: 2 } },
  { id: 'circle', group: 'shapes', label: 'Circle', type: 'ellipse', width: 121.92, height: 121.92, style: { stroke: SHAPE_STROKE, fill: SHAPE_FILL, strokeWidth: 2 } },
  {
    id: 'line',
    group: 'shapes',
    label: 'Line',
    type: 'line',
    width: 182.88,
    height: 10,
    points: [
      { x: -91.44, y: 0 },
      { x: 91.44, y: 0 },
    ],
    style: { stroke: LINE_COLOR, fill: 'none', strokeWidth: 3 },
  },
  {
    id: 'text',
    group: 'shapes',
    label: 'Text',
    type: 'text',
    width: 160,
    height: 40,
    text: 'Text',
    style: { stroke: 'none', fill: '#111827', strokeWidth: 0, fontSize: 28 },
  },
]

/** Walls and room shapes: on a blank canvas they are ordinary shapes (spec section 5). */
export const WALL_PRESETS: readonly ShapePreset[] = [
  {
    id: 'wall',
    group: 'walls',
    label: 'Wall',
    type: 'wall',
    width: 304.8,
    height: WALL_THICKNESS_CM,
    points: [
      { x: -152.4, y: 0 },
      { x: 152.4, y: 0 },
    ],
    style: { stroke: LINE_COLOR, fill: 'none', strokeWidth: WALL_THICKNESS_CM },
  },
  {
    id: 'room',
    group: 'walls',
    label: 'Room',
    type: 'room',
    width: 609.6,
    height: 487.68,
    points: [
      { x: -304.8, y: -243.84 },
      { x: 304.8, y: -243.84 },
      { x: 304.8, y: 243.84 },
      { x: -304.8, y: 243.84 },
    ],
    style: { stroke: LINE_COLOR, fill: 'none', strokeWidth: 5 },
  },
  // A door's box holds its swing: as deep as the door is wide.
  { id: 'door', group: 'walls', label: 'Door', type: 'door', width: 91.44, height: 91.44, style: { stroke: LINE_COLOR, fill: 'none', strokeWidth: 3 } },
  {
    id: 'window',
    group: 'walls',
    label: 'Window',
    type: 'window',
    width: 121.92,
    height: WALL_THICKNESS_CM,
    style: { stroke: LINE_COLOR, fill: '#ffffff', strokeWidth: 3 },
  },
]

export const PRESETS: readonly Preset[] = [
  ...TABLE_PRESETS,
  ...FIXTURE_PRESETS,
  ...CEREMONY_FIXTURE_PRESETS,
  CHAIR_ROW_PRESET,
  ...SHAPE_PRESETS,
  ...WALL_PRESETS,
]

const byId = new Map<string, Preset>(PRESETS.map((p) => [p.id, p]))

export function getPreset(id: PresetId): Preset {
  const preset = byId.get(id)
  if (!preset) throw new Error(`Unknown preset ${id}`)
  return preset
}

export function isPresetId(value: unknown): value is PresetId {
  return typeof value === 'string' && byId.has(value)
}

/** The highest table number plus one (PLAN change 3), or 1 for the first table. */
export function nextTableNumber(canvas: Pick<Canvas, 'items'>): number {
  let max = 0
  for (const item of canvas.items) if (item.kind === 'table' && item.number > max) max = item.number
  return max + 1
}

/** The default name for table number n; it follows the number until the table is renamed. */
export function defaultTableName(number: number): string {
  return `Table ${number}`
}

/** The highest chair row number plus one, or 1 for the first row. */
export function nextRowNumber(canvas: Pick<Canvas, 'items'>): number {
  let max = 0
  for (const item of canvas.items) if (item.kind === 'chairRow' && item.rowNumber > max) max = item.rowNumber
  return Math.min(999, max + 1)
}

/** Width and height of what the preset puts on the floor, chairs included, for finding it a free spot. */
export function presetFootprintSize(id: PresetId): { width: number; height: number } {
  const p = getPreset(id)
  if (p.group !== 'tables') return { width: p.width, height: p.height }
  // Chairs counted on every side: never less than their real reach.
  return { width: p.width + 2 * CHAIR_DEPTH_CM, height: p.height + 2 * CHAIR_DEPTH_CM }
}

function copyPoints(points: readonly Point[] | undefined): Point[] | undefined {
  return points?.map((p) => ({ x: p.x, y: p.y }))
}

/**
 * A new item from a preset, centered at `at`, unrotated, unlocked. Tables get
 * the next table number, the name "Table N" and empty seats; a chair row gets
 * the next row number and empty chairs.
 */
export function makeItem(presetId: PresetId, at: Point, id: string, canvas: Pick<Canvas, 'items'>): Item {
  const p = getPreset(presetId)
  const base = { id, x: at.x, y: at.y, rotation: 0, locked: false }
  switch (p.group) {
    case 'tables': {
      const number = nextTableNumber(canvas)
      const table: Table = {
        ...base,
        kind: 'table',
        shape: p.shape,
        width: p.width,
        height: p.height,
        number,
        name: defaultTableName(number),
        seatCount: p.seatCount,
        seatSides: p.seatSides,
        seats: emptySeats(p.seatCount),
      }
      return table
    }
    case 'rows': {
      const row: ChairRow = {
        ...base,
        kind: 'chairRow',
        chairCount: p.chairCount,
        spacing: p.spacing,
        blockId: null,
        blockLabel: null,
        rowNumber: nextRowNumber(canvas),
        rowLabel: '',
        reservedFor: null,
        seats: emptySeats(p.chairCount),
      }
      return row
    }
    case 'fixtures': {
      const fixture: Fixture = { ...base, kind: 'fixture', type: p.type, width: p.width, height: p.height, label: p.label }
      return fixture
    }
    default: {
      const shape: Shape = { ...base, kind: 'shape', type: p.type, width: p.width, height: p.height, style: { ...p.style } }
      const points = copyPoints(p.points)
      if (points) shape.points = points
      if (p.text !== undefined) shape.text = p.text
      return shape
    }
  }
}

/**
 * Copies of items for paste and duplicate (PLAN changes 3 and 9): new ids,
 * moved by `offset`, every seat empty, and tables numbered on from the
 * highest number in the canvas, in the order given. A table still called
 * "Table N" takes its new number's name; a renamed table keeps its name.
 * Notes attached to a copied item follow the copy. Copied chair rows get a
 * new block id, shared by rows copied from the same block.
 */
export function copyItems(items: readonly Item[], canvas: Pick<Canvas, 'items'>, newId: () => string, offset: Point = { x: 0, y: 0 }): Item[] {
  let number = nextTableNumber(canvas)
  const ids = new Map<string, string>()
  const blocks = new Map<string, string>()
  for (const item of items) ids.set(item.id, newId())
  return items.map((item): Item => {
    const moved = { ...item, id: ids.get(item.id) as string, x: item.x + offset.x, y: item.y + offset.y }
    switch (moved.kind) {
      case 'table': {
        const n = number++
        const renamed = moved.name.trim() !== '' && moved.name.trim() !== defaultTableName(moved.number)
        return { ...moved, number: n, name: renamed ? moved.name : defaultTableName(n), seats: emptySeats(moved.seatCount) }
      }
      case 'chairRow': {
        // Copied rows make a block of their own, so Select block never mixes them with the originals.
        let blockId = moved.blockId
        if (blockId !== null) {
          const known = blocks.get(blockId)
          blockId = known ?? newId()
          if (!known) blocks.set(moved.blockId as string, blockId)
        }
        return { ...moved, blockId, seats: emptySeats(moved.chairCount) }
      }
      case 'shape':
        return moved.points ? { ...moved, points: copyPoints(moved.points), style: { ...moved.style } } : { ...moved, style: { ...moved.style } }
      case 'note': {
        const follow = (target: string | null) => (target === null ? null : (ids.get(target) ?? target))
        const note = { ...moved, attachedTo: { start: follow(moved.attachedTo.start), end: follow(moved.attachedTo.end) } }
        return moved.points ? { ...note, points: copyPoints(moved.points) } : note
      }
      default:
        return moved
    }
  })
}
