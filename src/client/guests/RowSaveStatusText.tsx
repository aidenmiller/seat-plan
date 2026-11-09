'use client'

/** The page header's save status for guest and group edits: "Saving…", "Saved" or "Not saved, retrying". */
import { ROW_STATUS_TEXT } from '@/client/sync/row-save'
import { useRowSaveStatus, useRowUnloadGuard } from './row-saver-hooks'

export function RowSaveStatusText() {
  const status = useRowSaveStatus()
  // While this header shows, closing the page with unsent edits asks first.
  useRowUnloadGuard()
  const kind = status?.kind ?? 'saved'
  const reason = status?.kind === 'retrying' ? status.reason : null
  return (
    <p
      role="status"
      aria-live="polite"
      data-testid="row-save-status"
      data-status={kind}
      title={reason ?? undefined}
      className={`min-h-5 text-sm ${kind === 'retrying' ? 'font-medium text-amber-800' : 'text-stone-600'}`}
    >
      {ROW_STATUS_TEXT[kind]}
      {reason && <span className="sr-only"> {reason}</span>}
    </p>
  )
}
