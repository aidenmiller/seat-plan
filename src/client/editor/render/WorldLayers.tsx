'use client'

/**
 * The world SVG's contents (PLAN section 6, "Two drawing layers"): the venue
 * layer, the furniture layer (tables, fixtures, chair rows, shapes), the
 * guest names at close level (NamesLayer.tsx) and the notes layer, in that
 * order. One world unit is one centimeter; the camera
 * writes the world <g>'s transform, so panning and zooming re-render nothing.
 *
 * Each item is a memoized component that reads only its own item by id, so
 * dragging one table re-renders only that table. Notes read theirs with
 * arrows at their drawn ends (useResolvedItem), so dragging a table also
 * re-renders the arrows attached to it, and nothing else.
 */
import { createContext, memo, useCallback, useContext, type RefObject } from 'react'
import type { Canvas } from '@/domain/canvas-schema'
import type { FixedItem } from '@/domain/venue-schema'
import { worldTransform } from '../camera/camera-controller'
import { useCanvas, useEditorState, useItem, useResolvedItem, useUi, useViewState } from '../state/react'
import { shallowEqual } from '../state/store'
import { ChairRowView } from './ChairRowView'
import { FixtureView } from './FixtureView'
import { NamesLayer } from './NamesLayer'
import { NoteView } from './NoteView'
import { ShapeView } from './ShapeView'
import { WORLD_FONT } from './style'
import { TableView } from './TableView'
import { VenueLayer } from './VenueLayer'
import { crossedTables } from './wall-crossings'

const NO_VENUE: readonly FixedItem[] = Object.freeze([])

/** The layout's venue walls, for flagging the tables they run through. */
const VenueItemsContext = createContext<readonly FixedItem[]>(NO_VENUE)

const selectedSets = new WeakMap<readonly string[], Set<string>>()

/** The selection as a set, built once per selection. */
function selectedSet(selection: readonly string[]): Set<string> {
  let set = selectedSets.get(selection)
  if (!set) {
    set = new Set(selection)
    selectedSets.set(selection, set)
  }
  return set
}

export const ItemView = memo(function ItemView({ id }: { id: string }) {
  const item = useItem(id)
  const selected = useUi((s) => selectedSet(s.selection).has(id))
  const venue = useContext(VenueItemsContext)
  // One set per canvas version, shared by every table (wall-crossings.ts).
  const crossed = useCanvas(useCallback((canvas: Canvas) => crossedTables(canvas.items, venue).has(id), [venue, id]))
  if (!item) return null
  switch (item.kind) {
    case 'table':
      return <TableView table={item} selected={selected} crossed={crossed} />
    case 'fixture':
      return <FixtureView fixture={item} selected={selected} />
    case 'shape':
      return <ShapeView shape={item} selected={selected} />
    case 'chairRow':
      return <ChairRowView row={item} selected={selected} />
    case 'note':
      // The notes layer draws notes with NoteItemView, which follows attached arrows.
      return <NoteView note={item} selected={selected} />
  }
})

function furnitureIds(canvas: Canvas): string[] {
  const ids: string[] = []
  for (const item of canvas.items) if (item.kind !== 'note') ids.push(item.id)
  return ids
}

function noteIds(canvas: Canvas): string[] {
  const ids: string[] = []
  for (const item of canvas.items) if (item.kind === 'note') ids.push(item.id)
  return ids
}

const FurnitureLayer = memo(function FurnitureLayer() {
  const ids = useCanvas(furnitureIds, shallowEqual)
  const visible = useViewState((s) => s.layers.furniture.visible)
  const locked = useViewState((s) => s.layers.furniture.locked)
  return (
    <g data-layer="furniture" data-layer-locked={locked ? 'true' : undefined} display={visible ? undefined : 'none'}>
      {ids.map((id) => (
        <ItemView key={id} id={id} />
      ))}
    </g>
  )
})

/**
 * One note. Arrows come with their attached ends where they are drawn, so
 * an arrow re-renders when the table or fixture it holds moves, with no
 * change to the arrow itself. A note being typed into leaves its text to the
 * overlay's text box.
 */
export const NoteItemView = memo(function NoteItemView({ id }: { id: string }) {
  const item = useResolvedItem(id)
  const selected = useUi((s) => selectedSet(s.selection).has(id))
  const editing = useUi((s) => s.noteEdit?.id === id)
  if (item?.kind !== 'note') return null
  return <NoteView note={item} selected={selected} editing={editing} />
})

/** The notes layer (spec section 9): above the furniture, hidden all at once by the device's switch. */
const NotesLayer = memo(function NotesLayer() {
  const ids = useCanvas(noteIds, shallowEqual)
  const visible = useViewState((s) => s.layers.notes.visible)
  return (
    <g data-layer="notes" display={visible ? undefined : 'none'}>
      {ids.map((id) => (
        <NoteItemView key={id} id={id} />
      ))}
    </g>
  )
})

const VenueLayerSwitch = memo(function VenueLayerSwitch({ items }: { items: readonly FixedItem[] }) {
  const visible = useViewState((s) => s.layers.venue.visible)
  return <VenueLayer items={items} visible={visible} />
})

function tableCount(canvas: Canvas): number {
  let n = 0
  for (const item of canvas.items) if (item.kind === 'table') n++
  return n
}

export type WorldSvgProps = {
  worldRef: RefObject<SVGGElement | null>
  svgRef: RefObject<SVGSVGElement | null>
  /** The template's fixed items; empty on a blank canvas. */
  venue: readonly FixedItem[]
}

/**
 * The world SVG. data-detail (far, middle or close) is written straight onto
 * it when the camera settles, so a level change re-renders nothing.
 * Test hooks: data-testid="canvas", data-detail.
 */
export const WorldSvg = memo(function WorldSvg({ worldRef, svgRef, venue }: WorldSvgProps) {
  const { camera } = useEditorState()
  const tables = useCanvas(tableCount)
  const label = tables === 1 ? 'Floor plan with 1 table' : `Floor plan with ${tables} tables`
  return (
    <svg
      ref={svgRef}
      data-testid="canvas"
      data-detail={camera.detailLevel()}
      role="img"
      aria-label={label}
      xmlns="http://www.w3.org/2000/svg"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}
    >
      <g ref={worldRef} transform={worldTransform(camera.drawn())} fontFamily={WORLD_FONT} pointerEvents="none">
        <VenueItemsContext.Provider value={venue}>
          <VenueLayerSwitch items={venue} />
          <FurnitureLayer />
          <NamesLayer />
          <NotesLayer />
        </VenueItemsContext.Provider>
      </g>
    </svg>
  )
})
