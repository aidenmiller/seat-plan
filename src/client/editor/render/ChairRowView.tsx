'use client'

/**
 * A ceremony chair row (milestone 8 adds its tools): one seat circle per
 * chair along the row, dark blue when taken and grey when empty, and the
 * row's label at its left end.
 */
import { memo } from 'react'
import type { ChairRow } from '@/domain/canvas-schema'
import { chairRowLength } from '@/domain/geometry'
import { SEAT_RADIUS_CM } from '@/domain/seats'
import { INK_SOFT, SEAT_EMPTY, SEAT_TAKEN } from './style'
import { itemTransform } from './TableView'

const ROW_LABEL_CM = 20

export const ChairRowView = memo(function ChairRowView({ row, selected }: { row: ChairRow; selected: boolean }) {
  const length = chairRowLength(row)
  const first = -length / 2 + SEAT_RADIUS_CM
  const label = row.rowLabel.trim() || `Row ${row.rowNumber}`
  return (
    <g
      data-item-id={row.id}
      data-kind="chairRow"
      data-selected={selected ? 'true' : undefined}
      data-locked={row.locked ? 'true' : undefined}
      transform={itemTransform(row)}
    >
      {Array.from({ length: row.chairCount }, (_, i) => {
        const taken = (row.seats[i]?.guestId ?? null) !== null
        return (
          <circle
            key={i}
            cx={first + i * row.spacing}
            cy={0}
            r={SEAT_RADIUS_CM}
            fill={taken ? SEAT_TAKEN : SEAT_EMPTY}
            data-seat-index={i}
            data-seat-state={taken ? 'taken' : 'empty'}
          />
        )
      })}
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
