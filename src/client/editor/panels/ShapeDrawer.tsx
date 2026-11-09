'use client'

/**
 * The shape panel on phones: a drawer from the left, opened by the Shapes
 * button (spec section 4, "Phones and desktops"). A tap on a tile adds it in
 * the middle of the view and closes the drawer. While a tile is dragged the
 * drawer steps aside so the drop lands on the canvas.
 */
import { useEffect, useRef, useState } from 'react'
import { Icon } from '../icons/glyphs'
import { ShapePanel } from './ShapePanel'

export type ShapeDrawerProps = {
  open: boolean
  onClose(): void
  blank: boolean
  disabled: boolean
  dropTarget(): HTMLElement | null
}

export function ShapeDrawer({ open, onClose, blank, disabled, dropTarget }: ShapeDrawerProps) {
  if (!open) return null
  return <Drawer onClose={onClose} blank={blank} disabled={disabled} dropTarget={dropTarget} />
}

function Drawer({ onClose, blank, disabled, dropTarget }: Omit<ShapeDrawerProps, 'open'>) {
  const [dragging, setDragging] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true })
  }, [])

  return (
    <div className={`absolute inset-0 z-30 ${dragging ? 'pointer-events-none' : ''}`} data-testid="shape-drawer">
      <div aria-hidden="true" className={`absolute inset-0 bg-stone-900/30 ${dragging ? 'invisible' : ''}`} onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Shapes"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onClose()
          }
        }}
        className={`absolute inset-y-0 left-0 flex w-[min(21rem,88vw)] flex-col bg-white shadow-xl ${dragging ? 'invisible' : ''}`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-stone-200 py-1 pl-4 pr-1">
          <h2 className="text-base font-semibold text-stone-900">Add to the plan</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close shapes"
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-stone-700 outline-none hover:bg-stone-100 focus-visible:ring-2 focus-visible:ring-blue-700/50"
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <ShapePanel blank={blank} disabled={disabled} dropTarget={dropTarget} onAdded={onClose} onDragChange={setDragging} columns={3} />
        </div>
      </div>
    </div>
  )
}
