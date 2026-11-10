'use client'

/**
 * A sheet along the bottom of a phone screen (PLAN section 6, "Phones") with
 * three heights: a strip (its header only), half the screen, and nearly
 * full. Drag the top of the sheet up or down and it settles at the nearest
 * height (a quick flick goes one further); a tap on the handle goes up a
 * height, or back down from full. The header (tabs, counts, search) always
 * shows; the body scrolls inside and is inert while only the strip shows.
 *
 * It fills its positioned parent, less a small gap at the top, and moves by
 * transform only, so the canvas under it never resizes.
 */
import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'

export type SheetSnap = 'strip' | 'half' | 'full'

export type BottomSheetProps = {
  snap: SheetSnap
  onSnapChange(snap: SheetSnap): void
  /** What the sheet holds, for screen readers. */
  label: string
  /** Shown at every height, under the handle. */
  header: ReactNode
  children: ReactNode
  /** The strip's height in px: the handle plus the header. */
  stripPx?: number
  testId?: string
  /** Extra data attributes for the sheet itself. */
  attributes?: Record<`data-${string}`, string>
}

/** The sheet stops this far below the top of its parent at its fullest. */
export const SHEET_TOP_GAP_PX = 16
const DRAG_START_PX = 6
const FLICK_PX_PER_MS = 0.5

const ORDER: readonly SheetSnap[] = ['strip', 'half', 'full']

/** The sheet's offset from fully open, as CSS, for each height. */
function restingTransform(snap: SheetSnap, stripPx: number): string {
  switch (snap) {
    case 'strip':
      return `translateY(calc(100% - ${stripPx}px))`
    case 'half':
      // Half of the parent: the sheet is the parent's height less the gap.
      return `translateY(calc(50% - ${SHEET_TOP_GAP_PX / 2}px))`
    case 'full':
      return 'translateY(0px)'
  }
}

/** The height that a sheet `sheetPx` tall showing `visiblePx` settles at, given its speed (px/ms, up is negative). */
export function nearestSnap(visiblePx: number, sheetPx: number, stripPx: number, velocity = 0): SheetSnap {
  const heights: Record<SheetSnap, number> = {
    strip: stripPx,
    half: (sheetPx + SHEET_TOP_GAP_PX) / 2,
    full: sheetPx,
  }
  let best: SheetSnap = 'strip'
  let bestDistance = Infinity
  for (const snap of ORDER) {
    const d = Math.abs(heights[snap] - visiblePx)
    if (d < bestDistance) {
      best = snap
      bestDistance = d
    }
  }
  if (Math.abs(velocity) >= FLICK_PX_PER_MS) {
    const i = ORDER.indexOf(best)
    const nearest = heights[best]
    if (velocity < 0 && visiblePx >= nearest - 1 && i < ORDER.length - 1) return ORDER[i + 1]
    if (velocity > 0 && visiblePx <= nearest + 1 && i > 0) return ORDER[i - 1]
  }
  return best
}

type Drag = {
  pointerId: number
  startY: number
  startOffset: number
  sheetPx: number
  dragging: boolean
  lastY: number
  lastTime: number
  velocity: number
}

export function BottomSheet({ snap, onSnapChange, label, header, children, stripPx = 88, testId, attributes }: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const suppressClick = useRef(false)

  function offsetNow(): { offset: number; sheetPx: number } {
    const el = sheetRef.current
    if (!el) return { offset: 0, sheetPx: 0 }
    const parent = el.offsetParent?.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    const sheetPx = el.offsetHeight
    const bottom = parent ? parent.bottom : window.innerHeight
    return { offset: r.top - (bottom - sheetPx), sheetPx }
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    const { offset, sheetPx } = offsetNow()
    drag.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startOffset: offset,
      sheetPx,
      dragging: false,
      lastY: event.clientY,
      lastTime: event.timeStamp,
      velocity: 0,
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current
    const el = sheetRef.current
    if (!d || !el || d.pointerId !== event.pointerId) return
    const dy = event.clientY - d.startY
    if (!d.dragging) {
      if (Math.abs(dy) < DRAG_START_PX) return
      d.dragging = true
      // The sheet follows the finger with no easing; written straight onto it, so nothing re-renders.
      el.style.transition = 'none'
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // The pointer may be gone already.
      }
    }
    const dt = event.timeStamp - d.lastTime
    if (dt > 0) d.velocity = (event.clientY - d.lastY) / dt
    d.lastY = event.clientY
    d.lastTime = event.timeStamp
    const max = Math.max(0, d.sheetPx - stripPx)
    const offset = Math.min(max, Math.max(0, d.startOffset + dy))
    el.style.transform = `translateY(${offset}px)`
  }

  function finish(event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) {
    const d = drag.current
    const el = sheetRef.current
    if (!d || d.pointerId !== event.pointerId) return
    drag.current = null
    if (!d.dragging || !el) return
    // The click that may follow this pointerup must not also press a tab or the handle.
    suppressClick.current = true
    window.setTimeout(() => {
      suppressClick.current = false
    }, 0)
    const { offset } = offsetNow()
    const next = cancelled ? snap : nearestSnap(d.sheetPx - offset, d.sheetPx, stripPx, d.velocity)
    // Ease to the resting place; React writes the same transform when the height changes.
    el.style.transition = ''
    el.style.transform = restingTransform(next, stripPx)
    if (next !== snap) onSnapChange(next)
  }

  function onHandleClick() {
    onSnapChange(snap === 'strip' ? 'half' : snap === 'half' ? 'full' : 'half')
  }

  return (
    <section
      ref={sheetRef}
      aria-label={label}
      {...attributes}
      data-testid={testId}
      data-snap={snap}
      className="absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-2xl border-t border-stone-200 bg-white shadow-[0_-4px_24px_rgba(0,0,0,0.12)] transition-transform duration-200 ease-out"
      style={{ top: SHEET_TOP_GAP_PX, transform: restingTransform(snap, stripPx) }}
    >
      <div
        className="shrink-0 touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => finish(e, false)}
        onPointerCancel={(e) => finish(e, true)}
        onClickCapture={(event) => {
          if (suppressClick.current) {
            event.stopPropagation()
            event.preventDefault()
          }
        }}
      >
        <button
          type="button"
          onClick={onHandleClick}
          aria-label={snap === 'full' ? 'Show less' : 'Show more'}
          aria-expanded={snap !== 'strip'}
          className="flex h-11 w-full items-center justify-center outline-none focus-visible:bg-stone-100"
          data-testid={testId ? `${testId}-handle` : undefined}
        >
          <span aria-hidden="true" className="h-1.5 w-10 rounded-full bg-stone-300" />
        </button>
        {header}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" inert={snap === 'strip'}>
        {children}
      </div>
    </section>
  )
}
