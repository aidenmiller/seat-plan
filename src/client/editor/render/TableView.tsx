'use client'

/**
 * A table on the canvas: its body (circle, square or rectangle), its seat
 * circles (dark blue when taken, grey when empty, at every zoom), its name
 * and a count such as 6/8 in the middle, and a yellow ring when it gives
 * some seat less edge than the rule (spec section 4, "Seats").
 *
 * The ring runs outside the seat circles, so the seats never hide it, and
 * keeps 3 px on screen at every zoom; the body's outline keeps at least
 * 1 px (globals.css, from --zoom). Names drawn later sit on top of it.
 *
 * Seats are never stored as positions: they come from seatLocalLayout(), in
 * the table's own frame, inside the group that turns and moves the table.
 *
 * Test hooks: <g data-item-id data-kind="table">, each seat circle
 * data-seat-index and data-seat-state="taken|empty".
 */
import { memo, useMemo } from 'react'
import type { Table } from '@/domain/canvas-schema'
import type { Box } from '@/domain/geometry'
import { CHAIR_DEPTH_CM, isTight, seatLocalLayout, SEAT_RADIUS_CM, sideSeatCounts } from '@/domain/seats'
import {
  INK,
  INK_SOFT,
  SEAT_EMPTY,
  SEAT_TAKEN,
  TABLE_FILL,
  TABLE_STROKE,
  TABLE_STROKE_CM,
  TIGHT_OFFSET_CM,
  TIGHT_STROKE,
  TIGHT_STROKE_CM,
} from './style'
import { tableCenterLabels } from './text-fit'

export function itemTransform(item: { x: number; y: number; rotation: number }): string {
  return item.rotation ? `translate(${item.x} ${item.y}) rotate(${item.rotation})` : `translate(${item.x} ${item.y})`
}

/**
 * The tight ring, in the table's own frame: a circle (round tables) or a box
 * with rounded corners, TIGHT_OFFSET_CM outside the seat circles on every
 * side that has seats and outside the edge on the others.
 */
export function tightRing(
  table: Pick<Table, 'shape' | 'width' | 'height' | 'seatCount' | 'seatSides'>,
): { kind: 'circle'; r: number } | { kind: 'rect'; box: Box; rx: number } {
  if (table.shape === 'round') {
    return { kind: 'circle', r: table.width / 2 + (table.seatCount > 0 ? CHAIR_DEPTH_CM : 0) + TIGHT_OFFSET_CM }
  }
  const c = sideSeatCounts(table)
  const out = (n: number) => (n > 0 ? CHAIR_DEPTH_CM : 0) + TIGHT_OFFSET_CM
  return {
    kind: 'rect',
    box: {
      minX: -table.width / 2 - out(c.left),
      minY: -table.height / 2 - out(c.top),
      maxX: table.width / 2 + out(c.right),
      maxY: table.height / 2 + out(c.bottom),
    },
    rx: SEAT_RADIUS_CM + TIGHT_OFFSET_CM,
  }
}

export const TableView = memo(function TableView({ table, selected }: { table: Table; selected: boolean }) {
  const { shape, width, height, seatCount, seatSides } = table
  const places = useMemo(() => seatLocalLayout({ shape, width, height, seatCount, seatSides }), [shape, width, height, seatCount, seatSides])
  const tight = isTight(table)
  const ring = tight ? tightRing(table) : null
  const labels = tableCenterLabels(table)
  const title = table.name.trim() || `Table ${table.number}`
  const round = shape === 'round'

  return (
    <g
      data-item-id={table.id}
      data-kind="table"
      data-table-number={table.number}
      data-selected={selected ? 'true' : undefined}
      data-tight={tight ? 'true' : undefined}
      data-locked={table.locked ? 'true' : undefined}
      transform={itemTransform(table)}
    >
      <title>{title}</title>
      {ring &&
        (ring.kind === 'circle' ? (
          <circle r={ring.r} fill="none" stroke={TIGHT_STROKE} strokeWidth={TIGHT_STROKE_CM} data-tight-outline="" />
        ) : (
          <rect
            x={ring.box.minX}
            y={ring.box.minY}
            width={ring.box.maxX - ring.box.minX}
            height={ring.box.maxY - ring.box.minY}
            rx={ring.rx}
            fill="none"
            stroke={TIGHT_STROKE}
            strokeWidth={TIGHT_STROKE_CM}
            data-tight-outline=""
          />
        ))}
      {round ? (
        <circle r={width / 2} fill={TABLE_FILL} stroke={TABLE_STROKE} strokeWidth={TABLE_STROKE_CM} data-table-body="" />
      ) : (
        <rect
          x={-width / 2}
          y={-height / 2}
          width={width}
          height={height}
          rx={3}
          fill={TABLE_FILL}
          stroke={TABLE_STROKE}
          strokeWidth={TABLE_STROKE_CM}
          data-table-body=""
        />
      )}
      {places.map((p) => {
        const taken = (table.seats[p.index]?.guestId ?? null) !== null
        return (
          <circle
            key={p.index}
            cx={p.x}
            cy={p.y}
            r={SEAT_RADIUS_CM}
            fill={taken ? SEAT_TAKEN : SEAT_EMPTY}
            data-seat-index={p.index}
            data-seat-state={taken ? 'taken' : 'empty'}
          />
        )
      })}
      <g transform={labels.rotation ? `rotate(${labels.rotation})` : undefined} textAnchor="middle" textRendering="geometricPrecision">
        <text y={labels.name.y} dominantBaseline="central" fontSize={labels.name.fontSize} fontWeight={600} fill={INK} data-table-name="">
          {labels.name.text}
        </text>
        <text y={labels.count.y} dominantBaseline="central" fontSize={labels.count.fontSize} fill={INK_SOFT} data-seat-count="">
          {labels.count.text}
        </text>
      </g>
    </g>
  )
})
