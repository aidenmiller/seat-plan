'use client'

/**
 * The world SVG's contents (PLAN section 6, "Two drawing layers"): the venue
 * layer, the furniture layer (tables, fixtures, chair rows, shapes), the
 * guest names at close level (NamesLayer.tsx) and the notes layer, in that
 * order. One world unit is one centimeter; the camera
 * writes the world <g>'s transform, so panning and zooming re-render nothing.
 *
 * Each item is a memoized component that reads only its own item by id, so
 * dragging one table re-renders only that table.
 */
import { memo, type RefObject } from 'react'
import type { Canvas } from '@/domain/canvas-schema'
import type { FixedItem } from '@/domain/venue-schema'
import { worldTransform } from '../camera/camera-controller'
import { useCanvas, useEditorState, useItem, useUi, useViewState } from '../state/react'
import { shallowEqual } from '../state/store'
import { ChairRowView } from './ChairRowView'
import { FixtureView } from './FixtureView'
import { NamesLayer } from './NamesLayer'
import { NoteView } from './NoteView'
import { ShapeView } from './ShapeView'
import { WORLD_FONT } from './style'
import { TableView } from './TableView'
import { VenueLayer } from './VenueLayer'

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
  if (!item) return null
  switch (item.kind) {
    case 'table':
      return <TableView table={item} selected={selected} />
    case 'fixture':
      return <FixtureView fixture={item} selected={selected} />
    case 'shape':
      return <ShapeView shape={item} selected={selected} />
    case 'chairRow':
      return <ChairRowView row={item} selected={selected} />
    case 'note':
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

/** Notes get their tools in milestone 9; this layer already draws any the layout holds. */
const NotesLayer = memo(function NotesLayer() {
  const ids = useCanvas(noteIds, shallowEqual)
  const visible = useViewState((s) => s.layers.notes.visible)
  return (
    <g data-layer="notes" display={visible ? undefined : 'none'}>
      {ids.map((id) => (
        <ItemView key={id} id={id} />
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
        <VenueLayerSwitch items={venue} />
        <FurnitureLayer />
        <NamesLayer />
        <NotesLayer />
      </g>
    </svg>
  )
})
