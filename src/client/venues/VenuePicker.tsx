'use client'

/**
 * Picks the venue a layout uses: any venue template, or Blank canvas (spec
 * section 5; DECISIONS 29). Used in the layout editor (Properties with
 * nothing selected, and the notice on a layout whose venue was deleted) and
 * in the venue delete dialog, so a layout can move off a venue before it is
 * deleted. Saves at once with PATCH /api/layouts/:id; the layout's tables,
 * seats and version stay as they are.
 */
import { useEffect, useId, useState } from 'react'
import { errorMessage, listVenues, updateLayout } from '@/client/api'
import { Dialog } from '@/client/ui/Dialog'
import { errorClass, inputClass, labelClass, primaryButton, secondaryButton } from '@/client/ui/styles'
import type { LayoutDetail, VenueSummary } from '@/shared/api'

const BLANK = ''

export type VenuePickerProps = {
  layoutId: string
  /** The layout's template now, or null for a blank canvas. */
  current: string | null
  /** A venue not to offer: the one being deleted. */
  exclude?: string
  onChanged(layout: LayoutDetail): void
  onCancel(): void
  testId?: string
}

type Load = { kind: 'loading' } | { kind: 'ready'; venues: VenueSummary[] } | { kind: 'error'; message: string }

export function VenuePicker({ layoutId, current, exclude, onChanged, onCancel, testId = 'venue-picker' }: VenuePickerProps) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [choice, setChoice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selectId = useId()

  useEffect(() => {
    let live = true
    listVenues().then(
      (venues) => {
        if (live) setLoad({ kind: 'ready', venues: venues.filter((v) => v.id !== exclude) })
      },
      (err: unknown) => {
        if (live) setLoad({ kind: 'error', message: `Could not load the venues. ${errorMessage(err)}` })
      },
    )
    return () => {
      live = false
    }
  }, [exclude, attempt])

  const venues = load.kind === 'ready' ? load.venues : []
  // Until the person picks: the layout's venue when it is offered, else the first other venue, else Blank canvas.
  const fallback = venues.some((v) => v.id === current) ? (current ?? BLANK) : (venues[0]?.id ?? BLANK)
  const value = choice ?? fallback
  const unchanged = (value === BLANK ? null : value) === current

  async function submit() {
    if (busy || load.kind !== 'ready' || unchanged) return
    setBusy(true)
    setError(null)
    try {
      onChanged(await updateLayout(layoutId, { venueTemplateId: value === BLANK ? null : value }))
    } catch (err) {
      setError(`Could not change the venue. ${errorMessage(err)}`)
      setBusy(false)
    }
  }

  return (
    <form
      noValidate
      className="space-y-3"
      data-testid={testId}
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      {load.kind === 'loading' && <p className="text-sm text-stone-600">Loading venues…</p>}
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
      {load.kind === 'ready' && (
        <div>
          <label htmlFor={selectId} className={labelClass}>
            Venue
          </label>
          <select
            id={selectId}
            value={value}
            onChange={(e) => {
              setChoice(e.target.value)
              setError(null)
            }}
            disabled={busy}
            className={`${inputClass} mt-1`}
            data-testid="venue-picker-select"
          >
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
            <option value={BLANK}>Blank canvas</option>
          </select>
          <p className="mt-1 text-sm text-stone-600">Tables, seats and notes stay where they are. Only the walls and rooms under them change.</p>
        </div>
      )}
      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={secondaryButton} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className={primaryButton} disabled={busy || load.kind !== 'ready' || unchanged} data-testid="venue-picker-save">
          {busy ? 'Saving…' : 'Use this venue'}
        </button>
      </div>
    </form>
  )
}

/** The picker in a dialog, for the layout editor. */
export function VenuePickerDialog({ open, ...props }: VenuePickerProps & { open: boolean }) {
  return (
    <Dialog open={open} onClose={props.onCancel} title="Change venue" testId="venue-picker-dialog">
      {open && <VenuePicker {...props} />}
    </Dialog>
  )
}
