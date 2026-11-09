'use client'

/**
 * A fixture on the canvas (spec section 4, "Adding and editing shapes"): a
 * rounded box in its type's colors, its vector icon and its label, turned so
 * the label never reads upside down. The dance floor also shows its tiles.
 */
import { memo, type ReactElement } from 'react'
import type { Fixture } from '@/domain/canvas-schema'
import { Glyph } from '../icons/glyphs'
import { FIXTURE_COLORS, FIXTURE_LABEL, FIXTURE_STROKE_CM } from './style'
import { iconAndLabel } from './text-fit'
import { itemTransform } from './TableView'

/** Dance floor tiles: 2 ft squares (61 cm), at most 40 lines a side. */
const TILE_CM = 60.96

function danceFloorTiles(width: number, height: number, stroke: string): ReactElement | null {
  const lines: string[] = []
  const nx = Math.min(40, Math.floor(width / TILE_CM))
  const ny = Math.min(40, Math.floor(height / TILE_CM))
  const stepX = width / Math.max(1, nx)
  const stepY = height / Math.max(1, ny)
  for (let i = 1; i < nx; i++) lines.push(`M${-width / 2 + i * stepX} ${-height / 2}V${height / 2}`)
  for (let j = 1; j < ny; j++) lines.push(`M${-width / 2} ${-height / 2 + j * stepY}H${width / 2}`)
  if (lines.length === 0) return null
  return <path d={lines.join('')} fill="none" stroke={stroke} strokeOpacity={0.18} strokeWidth={1} />
}

export const FixtureView = memo(function FixtureView({ fixture, selected }: { fixture: Fixture; selected: boolean }) {
  const { width, height, type } = fixture
  const colors = FIXTURE_COLORS[type]
  const layout = iconAndLabel(fixture, fixture.label)
  const rx = Math.min(8, width / 6, height / 6)
  const scale = layout.iconSize / 24
  return (
    <g
      data-item-id={fixture.id}
      data-kind="fixture"
      data-fixture-type={type}
      data-selected={selected ? 'true' : undefined}
      data-locked={fixture.locked ? 'true' : undefined}
      transform={itemTransform(fixture)}
    >
      <rect
        x={-width / 2}
        y={-height / 2}
        width={width}
        height={height}
        rx={rx}
        fill={colors.fill}
        stroke={colors.stroke}
        strokeWidth={FIXTURE_STROKE_CM}
      />
      {type === 'danceFloor' && danceFloorTiles(width, height, colors.stroke)}
      <g transform={layout.rotation ? `rotate(${layout.rotation})` : undefined}>
        {layout.iconSize > 0 && (
          <g
            transform={`translate(${-layout.iconSize / 2} ${layout.iconY - layout.iconSize / 2}) scale(${scale})`}
            fill="none"
            stroke={colors.stroke}
            color={colors.stroke}
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
            data-fixture-icon=""
          >
            <Glyph name={type} />
          </g>
        )}
        {layout.label.text !== '' && (
          <text
            y={layout.label.y}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={layout.label.fontSize}
            fontWeight={500}
            fill={FIXTURE_LABEL}
            textRendering="geometricPrecision"
          >
            {layout.label.text}
          </text>
        )}
      </g>
    </g>
  )
})
