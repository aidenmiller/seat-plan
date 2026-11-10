'use client'

/**
 * A ceremony chair row (milestone 8 adds its tools): one seat circle per
 * chair along the row, dark blue when taken and grey when empty, and the
 * row's label at its left end.
 *
 * Seating marks as on tables (TableView): a + in empty chairs in Edit mode,
 * the green or red tint behind the row while a guest is dragged, the chair
 * that grows under the dragged guest, and the pulse after pan to a seat.
 * The guests' initials live in the names layer (NamesLayer.tsx).
 */
import { memo } from 'react'
import type { ChairRow } from '@/domain/canvas-schema'
import { chairRowLength } from '@/domain/geometry'
import { SEAT_RADIUS_CM } from '@/domain/seats'
import { useDragTint, useDropTargetSeat, useSeatPulse } from '../seating/react'
import { SeatPlus, SeatPulseRing } from './seat-marks'
import { DROP_TARGET_SCALE, DROP_TARGET_STROKE, DROP_TARGET_STROKE_CM, INK_SOFT, SEAT_EMPTY, SEAT_TAKEN, TINT } from './style'
import { itemTransform } from './TableView'

const ROW_LABEL_CM = 20

export const ChairRowView = memo(function ChairRowView({ row, selected }: { row: ChairRow; selected: boolean }) {
  const length = chairRowLength(row)
  const first = -length / 2 + SEAT_RADIUS_CM
  const label = row.rowLabel.trim() || `Row ${row.rowNumber}`
  const tint = useDragTint(row.id)
  const tinted = tint === 'good' || tint === 'bad' ? tint : null
  const target = useDropTargetSeat(row.id)
  const pulse = useSeatPulse(row.id)
  const xs = Array.from({ length: row.chairCount }, (_, i) => first + i * row.spacing)
  return (
    <g
      data-item-id={row.id}
      data-kind="chairRow"
      data-selected={selected ? 'true' : undefined}
      data-locked={row.locked ? 'true' : undefined}
      data-drag-tint={tinted ?? undefined}
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
          />
        )
      })}
      <g data-seat-marks="">{xs.map((x, i) => ((row.seats[i]?.guestId ?? null) === null ? <SeatPlus key={i} x={x} y={0} index={i} /> : null))}</g>
      {pulse && xs[pulse.seatIndex] !== undefined && <SeatPulseRing key={pulse.id} x={xs[pulse.seatIndex]} y={0} />}
      <text
        x={-length / 2 - 10}
        y={0}
        textAnchor="end"
        dominantBaseline="central"
        fontSize={ROW_LABEL_CM}
        fill={INK_SOFT}
        textRendering="geometricPrecision"
      >
        {label}
      </text>
    </g>
  )
})
