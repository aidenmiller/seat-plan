'use client'

/**
 * Milestone 2's bare canvas: a plain SVG that fits everything on screen and
 * draws each table with its seats (dark blue when taken, grey when empty),
 * plus fixtures as grey boxes. Milestone 3 replaces it with the real editor
 * (camera, selection, handles). One world unit is one centimeter.
 *
 * Test hooks: data-testid="canvas" on the SVG; each table is a
 * <g data-item-id data-kind="table">; each seat circle has
 * data-seat-state="taken" or "empty".
 */
import { memo, useSyncExternalStore } from 'react'
import type { Fixture, Table } from '@/domain/canvas-schema'
import { contentBounds, seatPositions, SEAT_DIAMETER_CM } from '@/domain/round-table'
import type { DocStore } from './doc-store'

const SEAT_TAKEN = '#1e3a8a'
const SEAT_EMPTY = '#9ca3af'
const TABLE_STROKE = '#1e3a8a'
const PADDING_CM = 80
const MIN_WIDTH_CM = 1200
const MIN_HEIGHT_CM = 800

function viewBox(bounds: ReturnType<typeof contentBounds>): string {
  if (!bounds) return `${-MIN_WIDTH_CM / 2} ${-MIN_HEIGHT_CM / 2} ${MIN_WIDTH_CM} ${MIN_HEIGHT_CM}`
  const cx = (bounds.minX + bounds.maxX) / 2
  const cy = (bounds.minY + bounds.maxY) / 2
  const w = Math.max(bounds.maxX - bounds.minX + 2 * PADDING_CM, MIN_WIDTH_CM)
  const h = Math.max(bounds.maxY - bounds.minY + 2 * PADDING_CM, MIN_HEIGHT_CM)
  return `${cx - w / 2} ${cy - h / 2} ${w} ${h}`
}

export function BareCanvas({ store }: { store: DocStore }) {
  const canvas = useSyncExternalStore(
    store.subscribe,
    () => store.getState().canvas,
    () => store.getState().canvas,
  )
  const tables = canvas.items.filter((i): i is Table => i.kind === 'table')
  const label = tables.length === 1 ? 'Floor plan with 1 table' : `Floor plan with ${tables.length} tables`

  return (
    <svg
      data-testid="canvas"
      role="img"
      aria-label={label}
      viewBox={viewBox(contentBounds(canvas))}
      preserveAspectRatio="xMidYMid meet"
      className="block h-full w-full select-none"
    >
      {canvas.items.map((item) => {
        if (item.kind === 'table') return <TableShape key={item.id} table={item} />
        if (item.kind === 'fixture') return <FixtureShape key={item.id} fixture={item} />
        return null
      })}
    </svg>
  )
}

const TableShape = memo(function TableShape({ table }: { table: Table }) {
  const seats = seatPositions(table)
  const fontSize = Math.max(18, Math.min(48, Math.min(table.width, table.height) / 3))
  return (
    <g
      data-item-id={table.id}
      data-kind="table"
      data-table-number={table.number}
      transform={`translate(${table.x} ${table.y}) rotate(${table.rotation})`}
    >
      <title>{table.name.trim() || `Table ${table.number}`}</title>
      {table.shape === 'round' ? (
        <circle r={table.width / 2} fill="#ffffff" stroke={TABLE_STROKE} strokeWidth={2} />
      ) : (
        <rect
          x={-table.width / 2}
          y={-table.height / 2}
          width={table.width}
          height={table.height}
          rx={4}
          fill="#ffffff"
          stroke={TABLE_STROKE}
          strokeWidth={2}
        />
      )}
      {seats.map((p, i) => {
        const taken = (table.seats[i]?.guestId ?? null) !== null
        return (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={SEAT_DIAMETER_CM / 2}
            fill={taken ? SEAT_TAKEN : SEAT_EMPTY}
            data-seat-index={i}
            data-seat-state={taken ? 'taken' : 'empty'}
          />
        )
      })}
      <text
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={fontSize}
        fontWeight={600}
        fill="#1c1917"
        transform={`rotate(${-table.rotation})`}
      >
        {table.number}
      </text>
    </g>
  )
})

const FixtureShape = memo(function FixtureShape({ fixture }: { fixture: Fixture }) {
  return (
    <g
      data-item-id={fixture.id}
      data-kind="fixture"
      transform={`translate(${fixture.x} ${fixture.y}) rotate(${fixture.rotation})`}
    >
      <rect
        x={-fixture.width / 2}
        y={-fixture.height / 2}
        width={fixture.width}
        height={fixture.height}
        fill="#e7e5e4"
        stroke="#a8a29e"
        strokeWidth={2}
      />
      {fixture.label && (
        <text textAnchor="middle" dominantBaseline="central" fontSize={28} fill="#44403c">
          {fixture.label}
        </text>
      )}
    </g>
  )
})
