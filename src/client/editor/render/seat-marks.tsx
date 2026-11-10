/**
 * Small marks drawn on seat circles, in world units (cm), shared by tables
 * and ceremony chair rows: the + on an empty seat, a guest's initials, and
 * the ring that pulses after pan to a seat. CSS decides when each shows
 * (globals.css), so they never re-render on a camera frame.
 */
import { DROP_TARGET_SCALE, PULSE_STROKE, SEAT_PLUS_ARM_CM, SEAT_PLUS_STROKE_CM } from './style'
import { SEAT_RADIUS_CM } from '@/domain/seats'

/** A white + in an empty seat. CSS shows it in Edit mode at middle and close level. */
export function SeatPlus({ x, y, index }: { x: number; y: number; index: number }) {
  const a = SEAT_PLUS_ARM_CM
  return (
    <path
      d={`M${x - a} ${y}H${x + a}M${x} ${y - a}V${y + a}`}
      stroke="#ffffff"
      strokeWidth={SEAT_PLUS_STROKE_CM}
      strokeLinecap="round"
      fill="none"
      data-seat-plus=""
      data-plus-for={index}
    />
  )
}

/** A guest's initials centered in their seat circle, kept upright by `rotation` (the item's turn, undone). */
export function SeatInitials({ x, y, index, text, rotation }: { x: number; y: number; index: number; text: string; rotation: number }) {
  return (
    <text
      x={x}
      y={y}
      dominantBaseline="central"
      transform={rotation ? `rotate(${rotation} ${x} ${y})` : undefined}
      data-seat-initials=""
      data-initials-for={index}
    >
      {text}
    </text>
  )
}

/** The ring that pulses round a seat for two seconds after pan to a seat (keyed by the pulse id, so it starts again). */
export function SeatPulseRing({ x, y }: { x: number; y: number }) {
  return (
    <g pointerEvents="none">
      <circle cx={x} cy={y} r={SEAT_RADIUS_CM * DROP_TARGET_SCALE} fill="none" stroke={PULSE_STROKE} strokeWidth={6} data-seat-pulse="" />
    </g>
  )
}
