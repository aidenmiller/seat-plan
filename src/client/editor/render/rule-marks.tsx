/**
 * Rule and group marks on tables, rows and seats (spec section 7): a red
 * badge for a broken rule, a grey one for an unfinished together rule, red
 * or grey rings round the seats involved, and a ring in the group color
 * round the seated members of a picked group. Badges keep one size on
 * screen at every zoom, like the wall badge.
 *
 * Test hooks: data-problem-badge="problem|unfinished", data-seat-problem,
 * data-seat-unfinished, data-group-ring with data-ring-color.
 */
import { SEAT_RADIUS_CM } from '@/domain/seats'
import type { SeatMark } from '../problems/analysis'

export const PROBLEM_RED = '#dc2626'
export const UNFINISHED_GREY = '#78716c'

export function ItemBadge({ x, y, kind }: { x: number; y: number; kind: 'problem' | 'unfinished' }) {
  const fill = kind === 'problem' ? PROBLEM_RED : UNFINISHED_GREY
  return (
    <g transform={`translate(${x} ${y})`} data-problem-badge={kind} pointerEvents="none">
      <g style={{ transform: 'scale(calc(1 / var(--zoom, 1)))' }}>
        <circle r={11} fill={fill} stroke="#ffffff" strokeWidth={2} />
        {kind === 'problem' ? (
          <path d="M0 -6V2M0 5.5V6" stroke="#ffffff" strokeWidth={2.4} strokeLinecap="round" />
        ) : (
          <path d="M-5 0h0.5M0 0h0.5M5 0h0.5" stroke="#ffffff" strokeWidth={2.6} strokeLinecap="round" />
        )}
      </g>
    </g>
  )
}

/** The rings round one seat: the group color outside, then red (broken rule) or grey (unfinished). */
export function SeatRings({ x, y, mark }: { x: number; y: number; mark: SeatMark | undefined }) {
  if (!mark || (!mark.ring && !mark.problem && !mark.unfinished)) return null
  return (
    <g pointerEvents="none">
      {mark.ring && (
        <circle cx={x} cy={y} r={SEAT_RADIUS_CM + 9} fill="none" stroke={mark.ring} strokeWidth={8} data-group-ring="" data-ring-color={mark.ring} />
      )}
      {(mark.problem || mark.unfinished) && (
        <circle
          cx={x}
          cy={y}
          r={SEAT_RADIUS_CM + 3}
          fill="none"
          stroke={mark.problem ? PROBLEM_RED : UNFINISHED_GREY}
          strokeWidth={5}
          strokeDasharray={mark.problem ? undefined : '8 6'}
          data-seat-problem={mark.problem ? '' : undefined}
          data-seat-unfinished={mark.problem ? undefined : ''}
        />
      )}
    </g>
  )
}

/** Opacity of everything that is not in a picked group. */
export const FADED_OPACITY = 0.25
