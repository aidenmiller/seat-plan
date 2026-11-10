'use client'

/**
 * Dragging a guest within a table's seat list in Properties (spec section 4,
 * "Seating guests": "Click a table to list its guests in the right panel,
 * where we can reorder them by dragging"; PLAN section 6). The same press
 * machine as the side list (../seating/list-press.ts): a mouse drags after
 * 4 px, a finger after a 450 ms hold, so the list still scrolls. Letting go
 * over another row moves the guest there, swapping with whoever sits there,
 * as one undo step (actions.reorderSeat).
 *
 * Rows mark themselves with data-seat-row={seatIndex}; the row under the
 * pointer is the target. Esc and pointercancel end the drag with no change.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { LIST_PRESS_IDLE, listPressBusy, listPressDragging, stepListPress, type ListPressInput, type ListPressState } from '../seating/list-press'
import type { PointerKind } from '../input/pointer-machine'

export type ReorderDrag = { from: number; over: number | null }

/** The seat index of the row under a client point, or null. */
export function seatRowAt(x: number, y: number): number | null {
  if (typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') return null
  const row = document.elementFromPoint(x, y)?.closest('[data-seat-row]')
  const n = row ? Number(row.getAttribute('data-seat-row')) : NaN
  return Number.isInteger(n) ? n : null
}

function pointerKind(type: string): PointerKind {
  return type === 'touch' ? 'touch' : type === 'pen' ? 'pen' : 'mouse'
}

/**
 * Press handling for one table's seat list. `onDrop(from, to)` runs when a
 * drag lets go over another row. Returns the row's onPointerDown and the
 * drag under way (for highlighting), or null.
 */
export function useSeatReorder(onDrop: (from: number, to: number) => void): {
  onPointerDown(event: ReactPointerEvent<HTMLElement>, seatIndex: number): void
  drag: ReorderDrag | null
} {
  const [drag, setDrag] = useState<ReorderDrag | null>(null)
  const machine = useRef<ListPressState>(LIST_PRESS_IDLE)
  const from = useRef<number | null>(null)
  const over = useRef<number | null>(null)
  const detach = useRef<(() => void) | null>(null)
  const dropRef = useRef(onDrop)
  useEffect(() => {
    dropRef.current = onDrop
  })
  // The long-press timer feeds the machine through this, once it is set below.
  const feedRef = useRef<(input: ListPressInput) => void>(() => undefined)

  const feed = useCallback((input: ListPressInput) => {
    const step = stepListPress(machine.current, input)
    machine.current = step.state
    for (const intent of step.intents) {
      switch (intent.type) {
        case 'wantTimer': {
          const wait = Math.max(0, intent.at - performance.now())
          window.setTimeout(() => feedRef.current({ type: 'timer', time: performance.now() }), wait)
          break
        }
        case 'dragStart':
          over.current = from.current
          setDrag({ from: from.current ?? 0, over: from.current })
          break
        case 'dragMove': {
          const at = seatRowAt(intent.at.x, intent.at.y)
          if (at !== over.current) {
            over.current = at
            setDrag((d) => (d ? { ...d, over: at } : d))
          }
          break
        }
        case 'drop': {
          const a = from.current
          const b = seatRowAt(intent.at.x, intent.at.y)
          setDrag(null)
          if (a !== null && b !== null && a !== b) dropRef.current(a, b)
          break
        }
        case 'dragCancel':
          setDrag(null)
          break
        case 'tap':
          break
      }
    }
    if (!listPressBusy(machine.current)) {
      const off = detach.current
      detach.current = null
      off?.()
    }
  }, [])

  useEffect(() => {
    feedRef.current = feed
  }, [feed])

  useEffect(
    () => () => {
      detach.current?.()
      detach.current = null
    },
    [],
  )

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, seatIndex: number) => {
      if (event.button !== 0 || listPressBusy(machine.current)) return
      const id = event.pointerId
      from.current = seatIndex
      // performance.now() is the events' clock in every current browser.
      feed({ type: 'down', id, pointer: pointerKind(event.pointerType), button: 0, guestId: String(seatIndex), at: { x: event.clientX, y: event.clientY }, time: performance.now() })
      if (!listPressBusy(machine.current)) return
      const touch = event.pointerType === 'touch'
      const mine = (e: PointerEvent) => e.pointerId === id
      const onMove = (e: PointerEvent) => {
        if (mine(e)) feed({ type: 'move', id, at: { x: e.clientX, y: e.clientY }, time: performance.now() })
      }
      const onUp = (e: PointerEvent) => {
        if (mine(e)) feed({ type: 'up', id, at: { x: e.clientX, y: e.clientY }, time: performance.now() })
      }
      const onCancel = (e: PointerEvent) => {
        if (mine(e)) feed({ type: 'cancel', id })
      }
      const onKey = (e: KeyboardEvent) => {
        if (e.key !== 'Escape' || !listPressBusy(machine.current)) return
        e.preventDefault()
        e.stopPropagation()
        feed({ type: 'escape' })
      }
      const onTouchMove = (e: TouchEvent) => {
        if (listPressDragging(machine.current) && e.cancelable) e.preventDefault()
      }
      const onBlock = (e: Event) => {
        if (listPressBusy(machine.current)) e.preventDefault()
      }
      const capture = { capture: true }
      const active = { capture: true, passive: false }
      window.addEventListener('pointermove', onMove, capture)
      window.addEventListener('pointerup', onUp, capture)
      window.addEventListener('pointercancel', onCancel, capture)
      window.addEventListener('keydown', onKey, capture)
      window.addEventListener('selectstart', onBlock, capture)
      if (touch) {
        window.addEventListener('touchmove', onTouchMove, active)
        window.addEventListener('contextmenu', onBlock, capture)
      }
      detach.current = () => {
        window.removeEventListener('pointermove', onMove, capture)
        window.removeEventListener('pointerup', onUp, capture)
        window.removeEventListener('pointercancel', onCancel, capture)
        window.removeEventListener('keydown', onKey, capture)
        window.removeEventListener('selectstart', onBlock, capture)
        if (touch) {
          window.removeEventListener('touchmove', onTouchMove, active)
          window.removeEventListener('contextmenu', onBlock, capture)
        }
      }
    },
    [feed],
  )

  return { onPointerDown, drag }
}
