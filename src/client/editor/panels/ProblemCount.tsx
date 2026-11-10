'use client'

/**
 * The top bar's count of seating problems (spec section 7; PLAN change 16):
 * broken rules plus tables a wall runs through. Warnings never count. Shown
 * only while there is something to fix; a tap opens the Problems tab. On
 * phones it shrinks to a red pill with the number.
 */
import { problemCountText } from '@/domain/problems'
import { useAnalysis } from '../problems/analysis'

export function ProblemCount({ compact, onOpen }: { compact: boolean; onOpen(): void }) {
  const count = useAnalysis((a) => a.list.problemCount)
  if (count === 0) return null
  const text = problemCountText(count)
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={text}
      title={text}
      className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-lg px-2 text-sm font-medium text-red-800 hover:bg-red-50"
      data-testid="problem-count"
      data-count={count}
    >
      <span aria-hidden="true" className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-red-600 px-1.5 text-xs font-semibold text-white">
        {count}
      </span>
      {!compact && <span aria-hidden="true">{count === 1 ? 'seating problem' : 'seating problems'}</span>}
    </button>
  )
}
