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
 * Seating (milestone 5): a + in each empty seat, which CSS shows in Edit
 * mode at middle and close level; while a guest is dragged, the table tints
 * green (partner or group there) or red (a rule would break), and the seat
 * they would land in grows and gets an outline; after pan to a seat, a ring
 * pulses round it for two seconds. The guests' initials and names live in
 * the names layer (NamesLayer.tsx), so zooming changes nothing here.
 *
 * A table a venue wall runs through (spec section 5) gets a red outline and
 * a small badge at its corner, both the same size on screen at every zoom.
 *
 * Test hooks: <g data-item-id data-kind="table">, each seat circle
 * data-seat-index and data-seat-state="taken|empty" (data-drop-target on the
 * seat that grows), data-drag-tint="good|bad" on the group and body,
 * [data-seat-pulse], [data-seat-plus] with data-plus-for, and
 * data-wall-crossing="true" with the red outline data-wall-outline and the
 * badge data-wall-badge.
 *
 * Rules and groups (milestone 6, rule-marks.tsx): a red badge at the top
 * left corner for a broken rule (grey when unfinished), rings round the
 * seats involved, rings in the group color for picked groups, and fading
 * for everything else (data-problem, data-faded).
 */
import { memo, useMemo } from 'react'
import type { Table } from '@/domain/canvas-schema'
import type { Box } from '@/domain/geometry'
import { CHAIR_DEPTH_CM, isTight, seatLocalLayout, SEAT_RADIUS_CM, sideSeatCounts } from '@/domain/seats'
import { useDragTint, useDropTargetSeat, useSeatPulse } from '../seating/react'
import {
  DROP_TARGET_SCALE,
  DROP_TARGET_STROKE,
  DROP_TARGET_STROKE_CM,
  INK,
  INK_SOFT,
  SEAT_EMPTY,
  SEAT_TAKEN,
  TABLE_FILL,
  TABLE_STROKE,
  TABLE_STROKE_CM,
  TIGHT_OFFSET_CM,
  TINT,
  TIGHT_STROKE,
  TIGHT_STROKE_CM,
} from './style'
import { tableCenterLabels } from '@/domain/text-fit'
import { SeatPlus, SeatPulseRing } from './seat-marks'
import { useItemMarks } from '../problems/analysis'
import { FADED_OPACITY, ItemBadge, SeatRings } from './rule-marks'

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

/** The red of a table a wall runs through. */
export const WALL_CROSSING_STROKE = '#dc2626'

export const TableView = memo(function TableView({ table, selected, crossed = false }: { table: Table; selected: boolean; crossed?: boolean }) {
  const { shape, width, height, seatCount, seatSides } = table
  const places = useMemo(() => seatLocalLayout({ shape, width, height, seatCount, seatSides }), [shape, width, height, seatCount, seatSides])
  const tight = isTight(table)
  const ring = tight ? tightRing(table) : null
  const labels = tableCenterLabels(table)
  const title = table.name.trim() || `Table ${table.number}`
  const round = shape === 'round'
  const tint = useDragTint(table.id)
  const tinted = tint === 'good' || tint === 'bad' ? tint : null
  const target = useDropTargetSeat(table.id)
  const pulse = useSeatPulse(table.id)
  const bodyFill = tinted ? TINT[tinted].fill : TABLE_FILL
  const bodyStroke = tinted ? TINT[tinted].stroke : TABLE_STROKE
  const marks = useItemMarks(table)

  return (
    <g
      data-item-id={table.id}
      data-kind="table"
      data-table-number={table.number}
      data-selected={selected ? 'true' : undefined}
      data-tight={tight ? 'true' : undefined}
      data-locked={table.locked ? 'true' : undefined}
      data-drag-tint={tinted ?? undefined}
      data-wall-crossing={crossed ? 'true' : undefined}
      data-problem={marks.badge ?? undefined}
      data-faded={marks.faded ? 'true' : undefined}
      opacity={marks.faded ? FADED_OPACITY : undefined}
      transform={itemTransform(table)}
    >
      <title>{crossed ? `${title} crosses a wall` : title}</title>
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
        <circle r={width / 2} fill={bodyFill} stroke={bodyStroke} strokeWidth={TABLE_STROKE_CM} data-table-body="" data-drag-tint={tinted ?? undefined} />
      ) : (
        <rect
          x={-width / 2}
          y={-height / 2}
          width={width}
          height={height}
          rx={3}
          fill={bodyFill}
          stroke={bodyStroke}
          strokeWidth={TABLE_STROKE_CM}
          data-table-body=""
          data-drag-tint={tinted ?? undefined}
        />
      )}
      {crossed &&
        (round ? (
          <circle r={width / 2} fill="none" stroke={WALL_CROSSING_STROKE} style={{ strokeWidth: 'calc(4px / var(--zoom, 1))' }} data-wall-outline="" />
        ) : (
          <rect
            x={-width / 2}
            y={-height / 2}
            width={width}
            height={height}
            rx={3}
            fill="none"
            stroke={WALL_CROSSING_STROKE}
            style={{ strokeWidth: 'calc(4px / var(--zoom, 1))' }}
            data-wall-outline=""
          />
        ))}
      {places.map((p) => {
        const taken = (table.seats[p.index]?.guestId ?? null) !== null
        const grows = target === p.index
        return (
          <circle
            key={p.index}
            cx={p.x}
            cy={p.y}
            r={grows ? SEAT_RADIUS_CM * DROP_TARGET_SCALE : SEAT_RADIUS_CM}
            fill={taken ? SEAT_TAKEN : SEAT_EMPTY}
            stroke={grows ? DROP_TARGET_STROKE : undefined}
            strokeWidth={grows ? DROP_TARGET_STROKE_CM : undefined}
            data-seat-index={p.index}
            data-seat-state={taken ? 'taken' : 'empty'}
            data-drop-target={grows ? '' : undefined}
            opacity={!marks.faded && marks.seats[p.index]?.faded ? FADED_OPACITY : undefined}
          />
        )
      })}
      {places.map((p) => (
        <SeatRings key={p.index} x={p.x} y={p.y} mark={marks.seats[p.index]} />
      ))}
      <g data-seat-marks="">
        {places.map((p) =>
          (table.seats[p.index]?.guestId ?? null) === null ? <SeatPlus key={p.index} x={p.x} y={p.y} index={p.index} /> : null,
        )}
      </g>
      {pulse && places[pulse.seatIndex] && <SeatPulseRing key={pulse.id} x={places[pulse.seatIndex].x} y={places[pulse.seatIndex].y} />}
      {crossed && (
        <g transform={`translate(${width / 2} ${-height / 2})`} data-wall-badge="">
          <g style={{ transform: 'scale(calc(1 / var(--zoom, 1)))' }}>
            <circle r={11} fill={WALL_CROSSING_STROKE} stroke="#ffffff" strokeWidth={2} />
            <path d="M0 -6V2M0 5.5V6" stroke="#ffffff" strokeWidth={2.4} strokeLinecap="round" />
          </g>
        </g>
      )}
      {marks.badge && <ItemBadge x={-width / 2} y={-height / 2} kind={marks.badge} />}
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
