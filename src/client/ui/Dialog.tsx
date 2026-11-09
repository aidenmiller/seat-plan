'use client'

/**
 * A modal dialog: role="dialog", aria-modal, labelled by its title. Focus
 * moves inside when it opens, Tab and Shift+Tab stay inside, Esc closes (when
 * `dismissable`), and focus goes back where it was when it closes. The page
 * behind does not scroll. On phones it fills the width less a margin and
 * scrolls inside when it is taller than the screen.
 */
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

export type DialogProps = {
  open: boolean
  onClose: () => void
  title: string
  /** Shown under the title and read out with it. */
  description?: ReactNode
  children?: ReactNode
  /** False for a dialog that needs an answer: Esc and clicks outside do nothing. */
  dismissable?: boolean
  /** What gets focus on open. Defaults to the first field or button inside. */
  initialFocus?: RefObject<HTMLElement | null>
  size?: 'sm' | 'md'
  /** For tests and styling hooks. */
  testId?: string
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('inert') && el.getClientRects().length > 0,
  )
}

/** How many dialogs are open, so the page scroll comes back only when the last one closes. */
let openCount = 0
let savedOverflow = ''
/** Open dialog panels, innermost last. Only the innermost one keeps focus inside itself. */
const stack: HTMLElement[] = []

function lockScroll() {
  if (openCount === 0) {
    savedOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  openCount += 1
}

function unlockScroll() {
  openCount = Math.max(0, openCount - 1)
  if (openCount === 0) document.body.style.overflow = savedOverflow
}

export function Dialog(props: DialogProps) {
  if (!props.open || typeof document === 'undefined') return null
  return createPortal(<DialogPanel {...props} />, document.body)
}

function DialogPanel({
  onClose,
  title,
  description,
  children,
  dismissable = true,
  initialFocus,
  size = 'md',
  testId,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    lockScroll()
    const panel = panelRef.current
    if (!panel) return unlockScroll
    stack.push(panel)
    const target = initialFocus?.current ?? focusables(panel).find((el) => el.tagName === 'INPUT') ?? focusables(panel)[0]
    ;(target ?? panel).focus({ preventScroll: true })

    // Focus that lands outside (a click on the backdrop, then Tab) comes back in.
    const onFocusIn = (event: FocusEvent) => {
      if (stack[stack.length - 1] !== panel) return
      if (event.target instanceof Node && !panel.contains(event.target)) panel.focus({ preventScroll: true })
    }
    document.addEventListener('focusin', onFocusIn)
    return () => {
      document.removeEventListener('focusin', onFocusIn)
      stack.splice(stack.indexOf(panel), 1)
      unlockScroll()
      if (previous && previous.isConnected) previous.focus({ preventScroll: true })
    }
    // Runs once per opening; initialFocus is read only then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      // Only the innermost dialog answers; an outer one must not close too.
      event.stopPropagation()
      if (dismissable) {
        event.preventDefault()
        onCloseRef.current()
      }
      return
    }
    if (event.key !== 'Tab') return
    const panel = panelRef.current
    if (!panel) return
    const items = focusables(panel)
    event.stopPropagation()
    if (items.length === 0) {
      event.preventDefault()
      panel.focus()
      return
    }
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    if (event.shiftKey && (active === first || active === panel || !panel.contains(active))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-stone-900/40" data-dialog-backdrop="">
      <div
        className="flex min-h-full items-center justify-center p-4"
        onMouseDown={(event) => {
          if (dismissable && event.target === event.currentTarget) onCloseRef.current()
        }}
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descriptionId : undefined}
          tabIndex={-1}
          onKeyDown={onKeyDown}
          data-testid={testId}
          className={`w-full ${size === 'sm' ? 'max-w-sm' : 'max-w-md'} rounded-2xl bg-white p-5 shadow-xl outline-none sm:p-6`}
        >
          <h2 id={titleId} className="text-lg font-semibold tracking-tight text-stone-900">
            {title}
          </h2>
          {description && (
            <div id={descriptionId} className="mt-2 text-sm text-stone-700">
              {description}
            </div>
          )}
          {children && <div className="mt-4">{children}</div>}
        </div>
      </div>
    </div>
  )
}

/** The row of buttons at the bottom of a dialog: stacked on phones, side by side from 640 px. */
export function DialogActions({ children }: { children: ReactNode }) {
  return <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{children}</div>
}
