/** Plain names for what is on the canvas, for panel headings and menus. */
import type { Fixture, Item, Shape } from '@/domain/canvas-schema'
import type { AlignMode, DistributeAxis } from '@/domain/align'

export const FIXTURE_NAMES: Record<Fixture['type'], string> = {
  food: 'Food station',
  bar: 'Bar',
  dj: 'DJ booth',
  danceFloor: 'Dance floor',
  stage: 'Stage',
  cake: 'Cake table',
  gifts: 'Gift table',
  photoBooth: 'Photo booth',
  ceremonyStructure: 'Arch',
  officiant: 'Officiant',
  aisleRunner: 'Aisle',
  musicians: 'Musicians',
  soundDesk: 'Sound desk',
  welcomeSign: 'Welcome sign',
  entrance: 'Entrance',
  custom: 'Fixture',
}

export const SHAPE_NAMES: Record<Shape['type'], string> = {
  rect: 'Rectangle',
  ellipse: 'Circle',
  line: 'Line',
  text: 'Text',
  wall: 'Wall',
  room: 'Room',
  door: 'Door',
  window: 'Window',
}

/** An item kind by kind, without its place on the canvas (x and y). */
export type WithoutPosition<T> = T extends unknown ? Omit<T, 'x' | 'y'> : never

/** What the panels show of an item: every field but x and y, which change on every frame of a drag. */
export type ItemFields = WithoutPosition<Item>

/** "Table 3", "Family (table 3)", "Bar", "Wall". */
export function itemName(item: ItemFields): string {
  switch (item.kind) {
    case 'table': {
      const name = item.name.trim()
      return name === '' ? `Table ${item.number}` : name
    }
    case 'fixture':
      return item.label.trim() || FIXTURE_NAMES[item.type]
    case 'shape':
      return SHAPE_NAMES[item.type]
    case 'chairRow':
      return item.rowLabel.trim() || `Row ${item.rowNumber}`
    case 'note':
      return 'Note'
  }
}

export const ALIGN_BUTTONS: readonly { mode: AlignMode; label: string }[] = [
  { mode: 'left', label: 'Left' },
  { mode: 'center', label: 'Center' },
  { mode: 'right', label: 'Right' },
  { mode: 'top', label: 'Top' },
  { mode: 'middle', label: 'Middle' },
  { mode: 'bottom', label: 'Bottom' },
]

export const DISTRIBUTE_BUTTONS: readonly { axis: DistributeAxis; label: string }[] = [
  { axis: 'horizontal', label: 'Space across' },
  { axis: 'vertical', label: 'Space down' },
]

/** Shapes whose own words show inside them. */
export function shapeTakesText(type: Shape['type']): boolean {
  return type === 'text' || type === 'rect' || type === 'ellipse' || type === 'room'
}

/** Shapes measured by one length along their x axis. */
export function shapeIsLinear(type: Shape['type']): boolean {
  return type === 'line' || type === 'wall' || type === 'window'
}
