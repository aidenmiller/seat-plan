'use client'

/**
 * A small menu at a point on the screen: what right click opens on a
 * desktop and a long press opens on a phone (spec section 4, "Phones and
 * desktops"). It stays inside the window, moves focus to its first item,
 * takes the arrow keys, Home and End, and closes on Esc, Tab, a press
 * outside it, a scroll or a resize. Every item is at least 44 px tall.
 *
 * Keys pressed inside it stop here, so the canvas's shortcuts (Delete, the
 * arrows) do not act on the selection behind it.
 */
import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'

export type ContextMenuItem = {
  id: string
  label: string
  onSelect(): void
  disabled?: boolean
  danger?: boolean
}

export type ContextMenuProps = {
  /** Where it opens, in client px (the pointer). Null: closed. */
  at: { x: number; y: number } | null
  items: readonly ContextMenuItem[]
  /** What the menu is for, for screen readers: "Table menu". */
  label: string
  onClose(): void
  testId?: string
}

const MARGIN_PX = 8

export function ContextMenu(props: ContextMenuProps) {
  if (!props.at || props.items.length === 0 || typeof document === 'undefined') return null
  return createPortal(<MenuPanel {...props} at={props.at} />, document.body)
}

function MenuPanel({ at, items, label, onClose, testId }: ContextMenuProps & { at: { x: number; y: number } }) {
  const ref = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  // Keep the whole menu on screen: open up or left of the point when it would run off.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const w = window.innerWidth
    const h = window.innerHeight
    let x = at.x
    let y = at.y
    if (x + r.width > w - MARGIN_PX) x = Math.max(MARGIN_PX, at.x - r.width)
    if (y + r.height > h - MARGIN_PX) y = Math.max(MARGIN_PX, h - MARGIN_PX - r.height)
    el.style.left = `${x}px`
    el.style.top = `${y}px`
    el.style.visibility = 'visible'
  }, [at])

  useEffect(() => {
    const el = ref.current
    el?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true })
    const close = () => onCloseRef.current()
    const onPointerDown = (event: PointerEvent) => {
      if (el && event.target instanceof Node && el.contains(event.target)) return
      close()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    window.addEventListener('wheel', close, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('wheel', close)
    }
  }, [])

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    event.stopPropagation()
    const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
    switch (event.key) {
      case 'Escape':
      case 'Tab':
        event.preventDefault()
        onCloseRef.current()
        return
      case 'ArrowDown':
        event.preventDefault()
        buttons[(i + 1) % buttons.length]?.focus()
        return
      case 'ArrowUp':
        event.preventDefault()
        buttons[(i - 1 + buttons.length) % buttons.length]?.focus()
        return
      case 'Home':
        event.preventDefault()
        buttons[0]?.focus()
        return
      case 'End':
        event.preventDefault()
        buttons[buttons.length - 1]?.focus()
        return
    }
  }

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      data-testid={testId}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
      className="fixed z-50 min-w-52 max-w-[calc(100vw-16px)] rounded-xl border border-stone-200 bg-white p-1 shadow-xl"
      style={{ left: at.x, top: at.y, visibility: 'hidden' }}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            onCloseRef.current()
            item.onSelect()
          }}
          className={`flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm font-medium outline-none focus-visible:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40 ${
            item.danger ? 'text-red-700 hover:bg-red-50' : 'text-stone-800 hover:bg-stone-100'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
