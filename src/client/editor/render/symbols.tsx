/**
 * Plan symbols shared by the layout's own shapes and the venue layer: door
 * openings with their swing, windows, multi-line text and point lists. All
 * lengths in cm; no page CSS.
 */
import type { Point } from '@/domain/geometry'

export function pointsAttr(points: readonly Point[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ')
}

export type DoorSwing = 'left' | 'right' | 'double' | 'none'

/**
 * A door opening along the x axis at y = 0, from -width/2 to width/2, opening
 * toward +y. `depth` is how far the open leaf reaches (the door's width for a
 * normal door). A white band `gap` thick hides the wall behind the opening.
 */
export function DoorSymbol({
  width,
  depth,
  swing,
  stroke,
  strokeWidth,
  gap,
}: {
  width: number
  depth: number
  swing: DoorSwing
  stroke: string
  strokeWidth: number
  gap: number
}) {
  const w2 = width / 2
  const leaf = strokeWidth * 1.6
  const arc = Math.max(1, strokeWidth * 0.6)
  return (
    <g fill="none">
      {gap > 0 && <rect x={-w2} y={-gap / 2} width={width} height={gap} fill="#ffffff" stroke="none" />}
      {gap > 0 && <path d={`M${-w2} ${-gap / 2}V${gap / 2}M${w2} ${-gap / 2}V${gap / 2}`} stroke={stroke} strokeWidth={strokeWidth} />}
      {swing === 'left' && (
        <>
          <path d={`M${-w2} 0V${depth}`} stroke={stroke} strokeWidth={leaf} />
          <path d={`M${-w2} ${depth}A${width} ${depth} 0 0 0 ${w2} 0`} stroke={stroke} strokeWidth={arc} strokeDasharray={`${arc * 4} ${arc * 3}`} />
        </>
      )}
      {swing === 'right' && (
        <>
          <path d={`M${w2} 0V${depth}`} stroke={stroke} strokeWidth={leaf} />
          <path d={`M${w2} ${depth}A${width} ${depth} 0 0 1 ${-w2} 0`} stroke={stroke} strokeWidth={arc} strokeDasharray={`${arc * 4} ${arc * 3}`} />
        </>
      )}
      {swing === 'double' && (
        <>
          <path d={`M${-w2} 0V${depth / 2}M${w2} 0V${depth / 2}`} stroke={stroke} strokeWidth={leaf} />
          <path
            d={`M${-w2} ${depth / 2}A${w2} ${depth / 2} 0 0 0 0 0M${w2} ${depth / 2}A${w2} ${depth / 2} 0 0 1 0 0`}
            stroke={stroke}
            strokeWidth={arc}
            strokeDasharray={`${arc * 4} ${arc * 3}`}
          />
        </>
      )}
    </g>
  )
}

/** A window across the x axis: a box `depth` deep with a line down its middle. */
export function WindowSymbol({
  width,
  depth,
  stroke,
  strokeWidth,
  fill,
}: {
  width: number
  depth: number
  stroke: string
  strokeWidth: number
  fill: string
}) {
  return (
    <g>
      <rect x={-width / 2} y={-depth / 2} width={width} height={depth} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
      <path d={`M${-width / 2} 0H${width / 2}`} fill="none" stroke={stroke} strokeWidth={Math.max(0.5, strokeWidth * 0.6)} />
    </g>
  )
}

/** Text centered on (0, 0), one line per newline, in world units. */
export function CenteredText({
  text,
  fontSize,
  fill,
  fontWeight,
  lineHeight = 1.2,
}: {
  text: string
  fontSize: number
  fill: string
  fontWeight?: number
  lineHeight?: number
}) {
  const lines = text.split('\n')
  const step = fontSize * lineHeight
  const first = (-(lines.length - 1) * step) / 2
  return (
    <text
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={fontSize}
      fontWeight={fontWeight}
      fill={fill}
      textRendering="geometricPrecision"
    >
      {lines.map((line, i) => (
        <tspan key={i} x={0} y={first + i * step}>
          {line === '' ? ' ' : line}
        </tspan>
      ))}
    </text>
  )
}
