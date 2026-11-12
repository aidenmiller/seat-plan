'use client'

/**
 * Deleting a venue template (spec section 5): the typed `delete`
 * confirmation layouts and weddings use, except that while layouts still use
 * the template the dialog lists them, with links, and Delete stays disabled.
 * Each listed layout has "Change venue", which moves it to another venue or
 * a blank canvas right there; the list is then read again. A layout that
 * starts using it while the dialog is open makes the server refuse (409);
 * the dialog then lists that one too.
 */
import Link from 'next/link'
import { useEffect, useId, useState } from 'react'
import { ApiRequestError, deleteVenue, errorMessage, venueDeleteSummary } from '@/client/api'
import { DialogActions } from '@/client/ui/Dialog'
import { CONFIRM_WORD, DeleteDialogShell } from '@/client/ui/TypedDeleteDialog'
import { dangerButton, errorClass, inputClass, labelClass, secondaryButton } from '@/client/ui/styles'
import { venueDeleteMessage } from '@/domain/venue-wording'
import type { VenueDeleteSummary, VenueInUse } from '@/shared/api'
import { VenuePicker } from './VenuePicker'

export type VenueDeleteDialogProps = {
  open: boolean
  venueId: string
  onClose(): void
  onDeleted(): void
}

export function VenueDeleteDialog(props: VenueDeleteDialogProps) {
  return props.open ? <DeleteForm {...props} /> : null
}

type Load = { kind: 'loading' } | { kind: 'ready'; summary: VenueDeleteSummary } | { kind: 'error'; message: string }

function isInUse(body: unknown): body is VenueInUse {
  return typeof body === 'object' && body !== null && (body as { error?: unknown }).error === 'in_use' && Array.isArray((body as VenueInUse).layouts)
}

function DeleteForm({ venueId, onClose, onDeleted }: VenueDeleteDialogProps) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [moving, setMoving] = useState<string | null>(null)
  const inputId = useId()

  useEffect(() => {
    let live = true
    venueDeleteSummary(venueId).then(
      (summary) => {
        if (live) setLoad({ kind: 'ready', summary })
      },
      (err: unknown) => {
        if (live) setLoad({ kind: 'error', message: `Could not check what uses it. ${errorMessage(err)}` })
      },
    )
    return () => {
      live = false
    }
  }, [venueId, attempt])

  const summary = load.kind === 'ready' ? load.summary : null
  // Layouts in weddings this person is not part of block it too; they are only counted.
  const blocked = summary !== null && (summary.layouts.length > 0 || summary.hiddenLayouts > 0)

  async function submit() {
    if (!summary || blocked || typed !== CONFIRM_WORD || busy) return
    setBusy(true)
    setError(null)
    try {
      await deleteVenue(venueId)
      onDeleted()
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 409 && isInUse(err.body)) {
        setLoad({ kind: 'ready', summary: { ...summary, layouts: err.body.layouts, hiddenLayouts: err.body.hiddenLayouts ?? 0 } })
      } else {
        setError(`Could not delete. ${errorMessage(err)}`)
      }
      setBusy(false)
    }
  }

  return (
    <DeleteDialogShell title="Delete venue" busy={busy} onClose={onClose}>
      {/* Outside the form: each listed layout's venue picker is a form of its own. */}
        <div aria-live="polite" className="text-sm text-stone-800" data-testid="delete-summary">
        {load.kind === 'loading' && <p className="text-stone-600">Checking which layouts use it…</p>}
        {summary && <p>{venueDeleteMessage(summary)}</p>}
        {load.kind === 'error' && (
          <div className="space-y-2">
            <p className={errorClass}>{load.message}</p>
            <button
              type="button"
              className={secondaryButton}
              onClick={() => {
                setLoad({ kind: 'loading' })
                setAttempt((n) => n + 1)
              }}
            >
              Try again
            </button>
          </div>
        )}
        {blocked && (
          <ul className="mt-3 space-y-1" data-testid="venue-in-use">
            {summary.layouts.map((l) => (
              <li key={l.layoutId} data-testid="venue-in-use-layout">
                <div className="flex flex-wrap items-center justify-between gap-x-2">
                  <Link href={`/w/${l.weddingId}/layouts/${l.layoutId}`} className="inline-flex min-h-11 min-w-0 items-center text-blue-900 underline underline-offset-2">
                    {l.weddingName} · {l.layoutName}
                  </Link>
                  {moving !== l.layoutId && (
                    <button type="button" className={secondaryButton} onClick={() => setMoving(l.layoutId)} disabled={busy} data-testid="venue-in-use-change">
                      Change venue
                    </button>
                  )}
                </div>
                {moving === l.layoutId && (
                  <div className="mt-2 rounded-lg border border-stone-200 p-3">
                    <VenuePicker
                      weddingId={l.weddingId}
                      layoutId={l.layoutId}
                      current={venueId}
                      exclude={venueId}
                      onCancel={() => setMoving(null)}
                      onChanged={() => {
                        setMoving(null)
                        setLoad({ kind: 'loading' })
                        setAttempt((n) => n + 1)
                      }}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        {!blocked && (
          <div className="mt-4">
            <label htmlFor={inputId} className={labelClass}>
              Type <span className="font-mono font-semibold">delete</span> to confirm
            </label>
            <input
              id={inputId}
              name="confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="done"
              disabled={summary === null}
              className={`${inputClass} mt-1 font-mono`}
            />
          </div>
        )}

        {error && (
          <p role="alert" className={`${errorClass} mt-3`}>
            {error}
          </p>
        )}

        <DialogActions>
          <button type="button" className={secondaryButton} onClick={onClose} disabled={busy}>
            {blocked ? 'Close' : 'Cancel'}
          </button>
          <button type="submit" className={dangerButton} disabled={summary === null || blocked || typed !== CONFIRM_WORD || busy}>
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </DialogActions>
      </form>
    </DeleteDialogShell>
  )
}
