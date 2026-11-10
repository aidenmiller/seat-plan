'use client'

/**
 * Plain shapes on the canvas: rectangles, ellipses, lines, text, and on blank
 * canvases walls, rooms, doors and windows (spec section 5, "Blank canvas").
 * Points are offsets in cm from the shape's center in its own frame, so they
 * turn with it. Colors and widths come from the shape's own style.
 */
import { memo, type ReactNode } from 'react'
import type { Shape } from '@/domain/canvas-schema'
import type { Point } from '@/domain/geometry'
import { INK_SOFT } from './style'
import { CenteredText, DoorSymbol, pointsAttr, WindowSymbol } from './symbols'
import { fitText, labelRotation, runsAcross } from '@/domain/text-fit'
import { itemTransform } from './TableView'

/** A door or window shape sits on a wall this thick, which its white band hides. */
const SHAPE_WALL_GAP_CM = 16

function linePoints(shape: Shape): Point[] {
  if (shape.points && shape.points.length >= 2) return shape.points
  return [
    { x: -shape.width / 2, y: 0 },
    { x: shape.width / 2, y: 0 },
  ]
}

function outlinePoints(shape: Shape): Point[] {
  if (shape.points && shape.points.length >= 3) return shape.points
  const w = shape.width / 2
  const h = shape.height / 2
  return [
    { x: -w, y: -h },
    { x: w, y: -h },
    { x: w, y: h },
    { x: -w, y: h },
  ]
}

/** The words written inside a rectangle, ellipse or room, upright and sized to fit. */
function InsideLabel({ shape, color }: { shape: Shape; color: string }) {
  const text = shape.text?.trim() ?? ''
  if (text === '') return null
  const rotation = labelRotation(shape)
  const across = runsAcross(rotation)
  const along = (across ? shape.height : shape.width) * 0.86
  const depth = (across ? shape.width : shape.height) * 0.8
  const longest = text.split('\n').reduce((a, b) => (b.length > a.length ? b : a), '')
  const lines = text.split('\n').length
  const max = shape.style.fontSize ?? Math.min(48, depth / (lines * 1.3))
  const size = fitText(longest, along, Math.min(max, depth / (lines * 1.2))).fontSize
  return (
    <g transform={rotation ? `rotate(${rotation})` : undefined}>
      <CenteredText text={text} fontSize={size} fill={color} />
    </g>
  )
}

export const ShapeView = memo(function ShapeView({ shape, selected }: { shape: Shape; selected: boolean }) {
  const { width: w, height: h, style } = shape
  const stroke = style.stroke || 'none'
  const fill = style.fill || 'none'
  const sw = style.strokeWidth
  let body: ReactNode = null
  let label: ReactNode = null

  switch (shape.type) {
    case 'rect':
      body = <rect x={-w / 2} y={-h / 2} width={w} height={h} fill={fill} stroke={stroke} strokeWidth={sw} />
      label = <InsideLabel shape={shape} color={INK_SOFT} />
      break
    case 'ellipse':
      body = <ellipse rx={w / 2} ry={h / 2} fill={fill} stroke={stroke} strokeWidth={sw} />
      label = <InsideLabel shape={shape} color={INK_SOFT} />
      break
    case 'line':
      body = (
        <polyline points={pointsAttr(linePoints(shape))} fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      )
      break
    case 'wall':
      body = (
        <polyline
          points={pointsAttr(linePoints(shape))}
          fill="none"
          stroke={stroke}
          strokeWidth={Math.max(sw, h)}
          strokeLinecap="square"
          strokeLinejoin="miter"
        />
      )
      break
    case 'room':
      body = <polygon points={pointsAttr(outlinePoints(shape))} fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="miter" />
      label = <InsideLabel shape={shape} color={stroke === 'none' ? INK_SOFT : stroke} />
      break
    case 'door':
      // The wall runs along the top edge; the box below it holds the swing.
      body = (
        <g transform={`translate(0 ${-h / 2})`}>
          <DoorSymbol width={w} depth={h} swing="left" stroke={stroke} strokeWidth={sw} gap={SHAPE_WALL_GAP_CM} />
        </g>
      )
      break
    case 'window':
      body = <WindowSymbol width={w} depth={h} stroke={stroke} strokeWidth={sw} fill={fill === 'none' ? '#ffffff' : fill} />
      break
    case 'text':
      body = <CenteredText text={shape.text ?? ''} fontSize={style.fontSize ?? 28} fill={fill === 'none' ? INK_SOFT : fill} />
      break
  }

  return (
    <g
      data-item-id={shape.id}
      data-kind="shape"
      data-shape-type={shape.type}
      data-selected={selected ? 'true' : undefined}
      data-locked={shape.locked ? 'true' : undefined}
      transform={itemTransform(shape)}
    >
      {body}
      {label}
    </g>
  )
})
