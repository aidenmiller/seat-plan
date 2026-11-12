'use client'

/**
 * The page header's save status for guest and group edits: "Saving…",
 * "Saved", "Not saved, retrying", or "Not saved: someone else signed in"
 * when another person signed in on this browser after the page opened.
 */
import { ROW_STATUS_TEXT } from '@/client/sync/row-save'
import { useRowSaveStatus, useRowUnloadGuard } from './row-saver-hooks'

export function RowSaveStatusText() {
  const status = useRowSaveStatus()
  // While this header shows, closing the page with unsent edits asks first.
  useRowUnloadGuard()
  const kind = status?.kind ?? 'saved'
  const reason = status?.kind === 'retrying' || status?.kind === 'other-user' ? status.reason : null
  const warn = kind === 'retrying' || kind === 'other-user'
  return (
    <p
      role="status"
      aria-live="polite"
      data-testid="row-save-status"
      data-status={kind}
      title={reason ?? undefined}
      className={`min-h-5 text-sm ${warn ? 'font-medium text-amber-800' : 'text-stone-600'}`}
    >
      {ROW_STATUS_TEXT[kind]}
      {reason && <span className="sr-only"> {reason}</span>}
    </p>
  )
}
