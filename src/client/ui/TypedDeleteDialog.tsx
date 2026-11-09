'use client'

/**
 * The delete dialog for weddings, layouts and venue templates (spec section
 * 10, "Deleting"): it names the item and everything that goes with it, then
 * the red Delete button stays disabled until the person types `delete`, in
 * lower case, exactly. While the delete request runs, Esc and a tap outside
 * do nothing, so a failure message cannot be lost with the dialog.
 */
import { useEffect, useId, useState, type ReactNode } from 'react'
import { errorMessage } from '@/client/api'
import { Dialog, DialogActions } from './Dialog'
import { dangerButton, errorClass, inputClass, labelClass, secondaryButton } from './styles'

export const CONFIRM_WORD = 'delete'

export type TypedDeleteDialogProps = {
  open: boolean
  onClose: () => void
  /** "Delete wedding", "Delete layout". */
  title: string
  /** Loads the sentence that names the item and what goes with it. */
  loadMessage: () => Promise<string>
  /** Runs the delete. Throw to keep the dialog open with the reason. */
  onConfirm: () => Promise<void>
}

export function TypedDeleteDialog(props: TypedDeleteDialogProps) {
  // A fresh form, and request state, for every opening.
  return props.open ? <DeleteForm {...props} /> : null
}

/** The dialog around the form. It cannot be dismissed while the delete request runs. */
export function DeleteDialogShell({
  title,
  busy,
  onClose,
  children,
}: {
  title: string
  busy: boolean
  onClose: () => void
  children: ReactNode
}) {
  return (
    <Dialog open onClose={onClose} title={title} size="sm" testId="delete-dialog" dismissable={!busy}>
      {children}
    </Dialog>
  )
}

type Summary = { kind: 'loading' } | { kind: 'ready'; message: string } | { kind: 'error'; message: string }

function DeleteForm({ title, onClose, loadMessage, onConfirm }: TypedDeleteDialogProps) {
  const [summary, setSummary] = useState<Summary>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputId = useId()
  const hintId = useId()

  useEffect(() => {
    let live = true
    loadMessage().then(
      (message) => {
        if (live) setSummary({ kind: 'ready', message })
      },
      (err: unknown) => {
        if (live) setSummary({ kind: 'error', message: `Could not check what goes with it. ${errorMessage(err)}` })
      },
    )
    return () => {
      live = false
    }
    // loadMessage is a new function on every render of the parent; load once per try.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt])

  const ready = summary.kind === 'ready'
  const confirmed = typed === CONFIRM_WORD

  async function submit() {
    if (!ready || !confirmed || busy) return
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
    } catch (err) {
      setError(`Could not delete. ${errorMessage(err)}`)
      setBusy(false)
    }
  }

  return (
    <DeleteDialogShell title={title} busy={busy} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
        noValidate
      >
        <div aria-live="polite" className="text-sm text-stone-800" data-testid="delete-summary">
          {summary.kind === 'loading' && <p className="text-stone-600">Checking what goes with it…</p>}
          {summary.kind === 'ready' && <p>{summary.message}</p>}
          {summary.kind === 'error' && (
            <div className="space-y-2">
              <p className={errorClass}>{summary.message}</p>
              <button
                type="button"
                className={secondaryButton}
                onClick={() => {
                  setSummary({ kind: 'loading' })
                  setAttempt((n) => n + 1)
                }}
              >
                Try again
              </button>
            </div>
          )}
        </div>

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
            aria-describedby={hintId}
            className={`${inputClass} mt-1 font-mono`}
          />
          <p id={hintId} className="sr-only">
            The Delete button works once you type delete in lower case.
          </p>
        </div>

        {error && (
          <p role="alert" className={`${errorClass} mt-3`}>
            {error}
          </p>
        )}

        <DialogActions>
          <button type="button" className={secondaryButton} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={dangerButton} disabled={!ready || !confirmed || busy}>
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </DialogActions>
      </form>
    </DeleteDialogShell>
  )
}
