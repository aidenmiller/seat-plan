'use client'

/**
 * The guest label sets (spec section 4, "Detail levels"; PLAN section 6,
 * "Name labels"), in their own layer above the furniture:
 *
 *  - close: each taken seat's full name, or first name and last initial, on
 *    the line out from the table, turned so it never reads upside down; a
 *    name with no room shows as initials inside the seat circle. The labels
 *    come from editor.labels (worked out when the camera settles).
 *  - middle: each taken seat's initials in white inside its circle.
 *  - far: none.
 *
 * Ceremony chair rows at close level put each name beside its chair,
 * running back toward the next row (domain/ceremony.ts chairNameLabels),
 * worked out when the set mounts, which is after the zoom settles.
 *
 * Only the set for the current level is in the page, and none while a
 * gesture or a glide zooms the view: Chrome lays every SVG text out again at
 * each new scale, hidden or not, and 800 labels then cost more than a frame
 * (DECISIONS 83). Each set fades in (globals.css) when the level changes or
 * the camera settles. Panning keeps them, and the furniture layer never
 * changes for them.
 *
 * Test hooks: <g data-layer="names">, a set <g data-labels="close|middle">,
 * a group per table or row with data-names-for, each name <text
 * data-guest-name data-name-for={seatIndex} data-name-form>, each initials
 * <text data-seat-initials data-initials-for={seatIndex}>.
 */
import { memo, useCallback, useMemo, useSyncExternalStore } from 'react'
import type { Canvas, ChairRow, Table } from '@/domain/canvas-schema'
import { chairLocalXs, chairNameLabels } from '@/domain/ceremony'
import type { Point } from '@/domain/geometry'
import type { MeasureText } from '@/domain/labels'
import { seatLocalLayout } from '@/domain/seats'
import { browserMeasure } from '../seating/name-labels'
import type { CameraController } from '../camera/camera-controller'
import { useLabelledTables, useSeatInitials, useSeatLabels, useSeating } from '../seating/react'
import { useCanvas, useDetailLevel, useEditorState, useItem, useViewState } from '../state/react'
import { shallowEqual } from '../state/store'
import { SeatInitials } from './seat-marks'
import { INITIALS_FONT_CM, NAME_INK } from './style'
import { itemTransform } from './TableView'
import { useAnalysis, type Analysis } from '../problems/analysis'
import { FADED_OPACITY } from './rule-marks'

/** True while groups are picked and nobody at this table or row is in one (the names fade with it). */
function useNamesFaded(id: string): boolean {
  return useAnalysis(useCallback((a: Analysis) => a.highlight.fade && !a.highlight.itemIds.has(id), [id]))
}

/** True while the view is drawn at a different zoom from the one the SVG holds: a zoom gesture or glide under way. */
export function isZooming(camera: Pick<CameraController, 'get' | 'drawn'>): boolean {
  const drawn = camera.drawn().zoom
  return drawn > 0 && Math.abs(camera.get().zoom / drawn - 1) > 1e-6
}

function useZooming(): boolean {
  const { camera } = useEditorState()
  const subscribe = useCallback(
    (listener: () => void) => {
      const offFrame = camera.subscribeFrame(listener)
      const offSettle = camera.subscribeSettle(listener)
      return () => {
        offFrame()
        offSettle()
      }
    },
    [camera],
  )
  const snapshot = useCallback(() => isZooming(camera), [camera])
  return useSyncExternalStore(subscribe, snapshot, () => false)
}

/** Tables and chair rows with a guest in any seat. */
function seatedItemIds(canvas: Canvas): string[] {
  const out: string[] = []
  for (const item of canvas.items) {
    if ((item.kind === 'table' || item.kind === 'chairRow') && item.seats.some((s) => s.guestId !== null)) out.push(item.id)
  }
  return out
}

function chairRowIds(canvas: Canvas): string[] {
  const out: string[] = []
  for (const item of canvas.items) if (item.kind === 'chairRow' && item.seats.some((s) => s.guestId !== null)) out.push(item.id)
  return out
}

function chairRows(canvas: Canvas): ChairRow[] {
  return canvas.items.filter((i): i is ChairRow => i.kind === 'chairRow')
}

let rowMeasure: MeasureText | null = null

export const NamesLayer = memo(function NamesLayer() {
  const visible = useViewState((s) => s.layers.furniture.visible)
  const level = useDetailLevel()
  const zooming = useZooming()
  return (
    <g data-layer="names" display={visible ? undefined : 'none'} textRendering="geometricPrecision">
      {!zooming && level === 'middle' && <InitialsSet />}
      {!zooming && level === 'close' && <NamesSet />}
    </g>
  )
})

const InitialsSet = memo(function InitialsSet() {
  const ids = useCanvas(seatedItemIds, shallowEqual)
  return (
    <g data-labels="middle" textAnchor="middle" fontSize={INITIALS_FONT_CM} fontWeight={600} fill="#ffffff">
      {ids.map((id) => (
        <ItemInitials key={id} id={id} />
      ))}
    </g>
  )
})

const NamesSet = memo(function NamesSet() {
  const tables = useLabelledTables()
  const rows = useCanvas(chairRowIds, shallowEqual)
  return (
    <g data-labels="close">
      {tables.map((id) => (
        <TableNames key={id} id={id} />
      ))}
      {rows.map((id) => (
        <RowNames key={id} id={id} />
      ))}
    </g>
  )
})

/** One chair row's names at close level: beside each chair, or initials inside it when there is no room. */
const RowNames = memo(function RowNames({ id }: { id: string }) {
  const found = useItem(id)
  const row = found?.kind === 'chairRow' ? found : null
  const rows = useCanvas(chairRows, shallowEqual)
  const people = useSeating((s) => s.people)
  const { camera } = useEditorState()
  const zoom = camera.get().zoom
  const faded = useNamesFaded(id)
  const labels = useMemo(() => {
    if (!row) return []
    rowMeasure ??= browserMeasure()
    return chairNameLabels({ row, rows, names: people.byId, zoom, measure: rowMeasure })
  }, [row, rows, people, zoom])
  if (!row) return null
  const xs = chairLocalXs(row)
  return (
    <g transform={itemTransform(row)} data-names-for={id} opacity={faded ? FADED_OPACITY : undefined}>
      {labels.map((l) =>
        l.form === 'initials' ? null : (
          <text
            key={l.seatIndex}
            transform={`translate(${l.x} ${l.y}) rotate(${l.rotation})`}
            textAnchor={l.anchor}
            dominantBaseline="central"
            fontSize={l.fontSize}
            fill={NAME_INK}
            data-guest-name=""
            data-name-for={l.seatIndex}
            data-name-form={l.form}
          >
            {l.text}
          </text>
        ),
      )}
      <g textAnchor="middle" fontSize={INITIALS_FONT_CM} fontWeight={600} fill="#ffffff">
        {labels.map((l) =>
          l.form === 'initials' && xs[l.seatIndex] !== undefined ? (
            <SeatInitials key={l.seatIndex} x={xs[l.seatIndex]} y={0} index={l.seatIndex} text={l.text} rotation={-row.rotation} />
          ) : null,
        )}
      </g>
    </g>
  )
})

/** Seat centers in the item's own frame: a table's seat layout, or a row's chairs from its left end. */
function useLocalSeats(item: Table | ChairRow | null): Point[] {
  const kind = item?.kind
  const shape = item?.kind === 'table' ? item.shape : undefined
  const width = item?.kind === 'table' ? item.width : undefined
  const height = item?.kind === 'table' ? item.height : undefined
  const seatCount = item?.kind === 'table' ? item.seatCount : undefined
  const seatSides = item?.kind === 'table' ? item.seatSides : undefined
  const fewerSeatsSide = item?.kind === 'table' ? item.fewerSeatsSide : undefined
  const chairCount = item?.kind === 'chairRow' ? item.chairCount : undefined
  const spacing = item?.kind === 'chairRow' ? item.spacing : undefined
  return useMemo(() => {
    if (kind === 'table' && shape && width !== undefined && height !== undefined && seatCount !== undefined && seatSides) {
      return seatLocalLayout({ shape, width, height, seatCount, seatSides, fewerSeatsSide }).map((p) => ({ x: p.x, y: p.y }))
    }
    if (kind === 'chairRow' && chairCount !== undefined && spacing !== undefined) {
      return chairLocalXs({ chairCount, spacing }).map((x) => ({ x, y: 0 }))
    }
    return []
  }, [kind, shape, width, height, seatCount, seatSides, fewerSeatsSide, chairCount, spacing])
}

const NO_SEATS: readonly { guestId: string | null }[] = []

/** White initials in each taken seat of one table or row. */
const ItemInitials = memo(function ItemInitials({ id }: { id: string }) {
  const found = useItem(id)
  const item = found?.kind === 'table' || found?.kind === 'chairRow' ? found : null
  const places = useLocalSeats(item)
  const initials = useSeatInitials(item?.seats ?? NO_SEATS)
  const faded = useNamesFaded(id)
  if (!item) return null
  return (
    <g transform={itemTransform(item)} data-names-for={id} opacity={faded ? FADED_OPACITY : undefined}>
      {places.map((p, i) => {
        const text = initials[i]
        return text ? <SeatInitials key={i} x={p.x} y={p.y} index={i} text={text} rotation={-item.rotation} /> : null
      })}
    </g>
  )
})

/** One table's names at close level; a name with no room shows as initials inside its circle. */
const TableNames = memo(function TableNames({ id }: { id: string }) {
  const found = useItem(id)
  const table = found?.kind === 'table' ? found : null
  const labels = useSeatLabels(id)
  const places = useLocalSeats(table)
  const faded = useNamesFaded(id)
  if (!table) return null
  // A seat whose guest changed since the labels were worked out shows nothing until they are again.
  const shown = labels.filter((l) => table.seats[l.seatIndex]?.guestId === l.guestId)
  return (
    <g transform={itemTransform(table)} data-names-for={id} opacity={faded ? FADED_OPACITY : undefined}>
      {shown.map((l) =>
        l.form === 'initials' ? null : (
          <text
            key={l.seatIndex}
            transform={`translate(${l.local.x} ${l.local.y})${l.local.rotation ? ` rotate(${l.local.rotation})` : ''}`}
            textAnchor={l.anchor}
            dominantBaseline="central"
            fontSize={l.fontSize}
            fill={NAME_INK}
            data-guest-name=""
            data-name-for={l.seatIndex}
            data-name-form={l.form}
          >
            {l.text}
          </text>
        ),
      )}
      <g textAnchor="middle" fontSize={INITIALS_FONT_CM} fontWeight={600} fill="#ffffff">
        {shown.map((l) => {
          const p = places[l.seatIndex]
          return l.form === 'initials' && p ? <SeatInitials key={l.seatIndex} x={p.x} y={p.y} index={l.seatIndex} text={l.text} rotation={-table.rotation} /> : null
        })}
      </g>
    </g>
  )
})
