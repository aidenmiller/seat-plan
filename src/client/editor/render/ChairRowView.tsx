'use client'

/**
 * A ceremony chair row (spec section 8): one seat circle per chair along the
 * row, dark blue when taken and grey when empty. At the end away from the
 * aisle: the row's label ("Row 3") and, for a reserved row, what it is
 * reserved for ("Family, row 1"). The front row of a block also shows the
 * block's side label ("Noa's side") in front of it. Labels turn so they
 * never read upside down.
 *
 * Seating marks as on tables (TableView): a + in empty chairs in Edit mode,
 * the green or red tint behind the row while a guest is dragged, the chair
 * that grows under the dragged guest, and the pulse after pan to a seat.
 * The guests' initials live in the names layer (NamesLayer.tsx).
 */
import { memo } from 'react'
import type { ChairRow } from '@/domain/canvas-schema'
import { chairLocalXs, rowName } from '@/domain/ceremony'
import { chairRowLength, normalizeDegrees } from '@/domain/geometry'
import { SEAT_RADIUS_CM } from '@/domain/seats'
import { useDragTint, useDropTargetSeat, useSeatPulse } from '../seating/react'
import { SeatPlus, SeatPulseRing } from './seat-marks'
import { DROP_TARGET_SCALE, DROP_TARGET_STROKE, DROP_TARGET_STROKE_CM, INK_SOFT, SEAT_EMPTY, SEAT_TAKEN, TINT } from './style'
import { itemTransform } from './TableView'
import { useItemMarks } from '../problems/analysis'
import { FADED_OPACITY, ItemBadge, SeatRings } from './rule-marks'

const ROW_LABEL_CM = 20
const RESERVED_LABEL_CM = 15
const SIDE_LABEL_CM = 18
const RESERVED_INK = '#92400e'

/** True when the row is turned so far that its labels would read upside down. */
function upsideDown(rotation: number): boolean {
  const r = normalizeDegrees(rotation)
  return r > 90 && r <= 270
}

export const ChairRowView = memo(function ChairRowView({ row, selected }: { row: ChairRow; selected: boolean }) {
  const length = chairRowLength(row)
  const label = rowName(row)
  const reserved = row.reservedFor?.trim() ?? ''
  const side = row.rowNumber === 1 ? (row.blockLabel?.trim() ?? '') : ''
  // Labels go at the end away from the aisle.
  const atRight = row.aisleEnd === 'left'
  const flipped = upsideDown(row.rotation)
  const labelX = atRight ? length / 2 + 10 : -length / 2 - 10
  const anchor = atRight !== flipped ? 'start' : 'end'
  const sideY = flipped ? SEAT_RADIUS_CM + 16 : -SEAT_RADIUS_CM - 16
  const tint = useDragTint(row.id)
  const tinted = tint === 'good' || tint === 'bad' ? tint : null
  const target = useDropTargetSeat(row.id)
  const pulse = useSeatPulse(row.id)
  const xs = chairLocalXs(row)
  const marks = useItemMarks(row)
  return (
    <g
      data-item-id={row.id}
      data-kind="chairRow"
      data-selected={selected ? 'true' : undefined}
      data-locked={row.locked ? 'true' : undefined}
      data-drag-tint={tinted ?? undefined}
      data-problem={marks.badge ?? undefined}
      data-faded={marks.faded ? 'true' : undefined}
      opacity={marks.faded ? FADED_OPACITY : undefined}
      transform={itemTransform(row)}
    >
      {tinted && (
        <rect
          x={-length / 2 - 6}
          y={-SEAT_RADIUS_CM - 6}
          width={length + 12}
          height={2 * SEAT_RADIUS_CM + 12}
          rx={SEAT_RADIUS_CM + 6}
          fill={TINT[tinted].fill}
          stroke={TINT[tinted].stroke}
          strokeWidth={3}
        />
      )}
      {xs.map((x, i) => {
        const taken = (row.seats[i]?.guestId ?? null) !== null
        const grows = target === i
        return (
          <circle
            key={i}
            cx={x}
            cy={0}
            r={grows ? SEAT_RADIUS_CM * DROP_TARGET_SCALE : SEAT_RADIUS_CM}
            fill={taken ? SEAT_TAKEN : SEAT_EMPTY}
            stroke={grows ? DROP_TARGET_STROKE : undefined}
            strokeWidth={grows ? DROP_TARGET_STROKE_CM : undefined}
            data-seat-index={i}
            data-seat-state={taken ? 'taken' : 'empty'}
            data-drop-target={grows ? '' : undefined}
            opacity={!marks.faded && marks.seats[i]?.faded ? FADED_OPACITY : undefined}
          />
        )
      })}
      {xs.map((x, i) => (
        <SeatRings key={i} x={x} y={0} mark={marks.seats[i]} />
      ))}
      {marks.badge && <ItemBadge x={-length / 2} y={-SEAT_RADIUS_CM} kind={marks.badge} />}
      <g data-seat-marks="">{xs.map((x, i) => ((row.seats[i]?.guestId ?? null) === null ? <SeatPlus key={i} x={x} y={0} index={i} /> : null))}</g>
      {pulse && xs[pulse.seatIndex] !== undefined && <SeatPulseRing key={pulse.id} x={xs[pulse.seatIndex]} y={0} />}
      <g
        transform={flipped ? `rotate(180 ${labelX} 0)` : undefined}
        textAnchor={anchor}
        fill={INK_SOFT}
        textRendering="geometricPrecision"
      >
        <text x={labelX} y={reserved ? -RESERVED_LABEL_CM * 0.6 : 0} dominantBaseline="central" fontSize={ROW_LABEL_CM} data-row-label="">
          {label}
        </text>
        {reserved && (
          <text
            x={labelX}
            y={ROW_LABEL_CM * 0.65}
            dominantBaseline="central"
            fontSize={RESERVED_LABEL_CM}
            fontStyle="italic"
            fill={RESERVED_INK}
            data-reserved-label=""
          >
            {reserved}
          </text>
        )}
      </g>
      {side && (
        <text
          x={0}
          y={sideY}
          transform={flipped ? `rotate(180 0 ${sideY})` : undefined}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={SIDE_LABEL_CM}
          fontWeight={600}
          fill={INK_SOFT}
          textRendering="geometricPrecision"
          data-block-label=""
        >
          {side}
        </text>
      )}
    </g>
  )
})
