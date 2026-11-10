'use client'

/**
 * The venue layer (spec section 5): the template's fixed items, drawn under
 * everything and never reachable by the pointer. Walls are thick lines,
 * rooms and zones outlines with their names, doors gaps with their swing,
 * windows, columns, stairs, built-in bars and labels. Every layout that uses
 * the template shares them; only the template editor changes them.
 */
import { memo, type ReactElement } from 'react'
import type { Point } from '@/domain/geometry'
import type { FixedItem } from '@/domain/venue-schema'
import { VENUE } from './style'
import { CenteredText, DoorSymbol, pointsAttr, WindowSymbol } from './symbols'
import { fitText } from '@/domain/text-fit'

const OUTLINE_CM = 3
const ROOM_NAME_MAX_CM = 60
const ZONE_DASH = '24 14'
/** Stair treads, about 11 in apart. */
const TREAD_CM = 28

function centerOf(points: readonly Point[]): { x: number; y: number; w: number; h: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY }
}

function boxTransform(f: { x: number; y: number; rotation: number }): string {
  return f.rotation ? `translate(${f.x} ${f.y}) rotate(${f.rotation})` : `translate(${f.x} ${f.y})`
}

function AreaName({ name, points, italic }: { name: string | undefined; points: readonly Point[]; italic?: boolean }) {
  const text = name?.trim() ?? ''
  if (text === '') return null
  const c = centerOf(points)
  const fitted = fitText(text, c.w * 0.8, Math.min(ROOM_NAME_MAX_CM, c.h * 0.12))
  return (
    <text
      x={c.x}
      y={c.y}
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={fitted.fontSize}
      fontWeight={600}
      fontStyle={italic ? 'italic' : undefined}
      fill={VENUE.label}
      fillOpacity={0.8}
      textRendering="geometricPrecision"
    >
      {fitted.text}
    </text>
  )
}

function stairTreads(width: number, height: number): string {
  const parts: string[] = []
  const n = Math.min(80, Math.floor(width / TREAD_CM))
  for (let i = 1; i < n; i++) {
    const x = -width / 2 + (i * width) / n
    parts.push(`M${x} ${-height / 2}V${height / 2}`)
  }
  return parts.join('')
}

/** One fixed item's drawing, in world cm. The venue template editor draws its items with it too. */
export function fixedItemElement(f: FixedItem): ReactElement | null {
  switch (f.type) {
    case 'wall':
      return (
        <polyline
          key={f.id}
          data-venue-type="wall"
          points={pointsAttr(f.points)}
          fill="none"
          stroke={VENUE.wall}
          strokeWidth={f.thickness}
          strokeLinecap="square"
          strokeLinejoin="miter"
        />
      )
    case 'room':
      return (
        <g key={f.id} data-venue-type="room">
          <polygon points={pointsAttr(f.points)} fill="none" stroke={VENUE.outline} strokeWidth={OUTLINE_CM} strokeLinejoin="miter" />
          <AreaName name={f.name} points={f.points} />
        </g>
      )
    case 'zone':
      return (
        <g key={f.id} data-venue-type="zone">
          <polygon points={pointsAttr(f.points)} fill="none" stroke={VENUE.zone} strokeWidth={OUTLINE_CM} strokeDasharray={ZONE_DASH} />
          <AreaName name={f.name} points={f.points} italic />
        </g>
      )
    case 'patioEdge':
      return (
        <polyline
          key={f.id}
          data-venue-type="patioEdge"
          points={pointsAttr(f.points)}
          fill="none"
          stroke={VENUE.zone}
          strokeWidth={OUTLINE_CM}
          strokeDasharray={ZONE_DASH}
        />
      )
    case 'door':
      return (
        <g key={f.id} data-venue-type="door" transform={boxTransform(f)}>
          <DoorSymbol width={f.width} depth={f.width} swing={f.swing} stroke={VENUE.wall} strokeWidth={OUTLINE_CM} gap={VENUE.gapCm} />
        </g>
      )
    case 'window':
      return (
        <g key={f.id} data-venue-type="window" transform={boxTransform(f)}>
          <WindowSymbol width={f.width} depth={VENUE.gapCm * 0.6} stroke={VENUE.wall} strokeWidth={OUTLINE_CM * 0.6} fill={VENUE.window} />
        </g>
      )
    case 'column':
      return (
        <g key={f.id} data-venue-type="column" transform={boxTransform(f)}>
          {f.shape === 'round' ? (
            <ellipse rx={f.width / 2} ry={f.height / 2} fill={VENUE.fill} stroke={VENUE.wall} strokeWidth={OUTLINE_CM} />
          ) : (
            <rect x={-f.width / 2} y={-f.height / 2} width={f.width} height={f.height} fill={VENUE.fill} stroke={VENUE.wall} strokeWidth={OUTLINE_CM} />
          )}
        </g>
      )
    case 'stairs':
      return (
        <g key={f.id} data-venue-type="stairs" transform={boxTransform(f)}>
          <rect x={-f.width / 2} y={-f.height / 2} width={f.width} height={f.height} fill="#ffffff" stroke={VENUE.outline} strokeWidth={OUTLINE_CM} />
          <path d={stairTreads(f.width, f.height)} fill="none" stroke={VENUE.outline} strokeWidth={OUTLINE_CM * 0.5} />
        </g>
      )
    case 'bar': {
      const label = fitText(f.label, f.width * 0.85, Math.min(30, f.height * 0.4))
      return (
        <g key={f.id} data-venue-type="bar" transform={boxTransform(f)}>
          <rect x={-f.width / 2} y={-f.height / 2} width={f.width} height={f.height} rx={6} fill={VENUE.fill} stroke={VENUE.outline} strokeWidth={OUTLINE_CM} />
          {label.text !== '' && <CenteredText text={label.text} fontSize={label.fontSize} fill={VENUE.label} fontWeight={600} />}
        </g>
      )
    }
    case 'label':
      return (
        <g key={f.id} data-venue-type="label" transform={boxTransform(f)}>
          <CenteredText text={f.text} fontSize={f.fontSize} fill={VENUE.label} />
        </g>
      )
  }
}

/** Drawn once per template version: the items array changes only when the layout opens another template. */
export const VenueLayer = memo(function VenueLayer({ items, visible }: { items: readonly FixedItem[]; visible: boolean }) {
  if (items.length === 0) return null
  return (
    <g data-layer="venue" display={visible ? undefined : 'none'}>
      {items.map(fixedItemElement)}
    </g>
  )
})
