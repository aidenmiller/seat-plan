'use client'

/**
 * Delete a guest (spec section 6, PLAN change 7). The dialog first asks the
 * server what goes with it and names every layout and table where the
 * guest's seat is cleared, and the partner whose link is cleared.
 */
import { useEffect, useState } from 'react'
import { deleteGuest, errorMessage, guestDeleteSummary } from '@/client/api'
import { Dialog, DialogActions } from '@/client/ui/Dialog'
import { dangerButton, errorClass, secondaryButton } from '@/client/ui/styles'
import { fullName } from '@/domain/guest-list'
import { joinAnd, plural } from '@/domain/wording'
import type { Guest, GuestDeleteSummary, GuestSeatPlace } from '@/shared/api'

export function DeleteGuestDialog({
  guest,
  onDeleted,
  onClose,
}: {
  guest: Guest | null
  /** The guest is gone; these seats were cleared. */
  onDeleted(guest: Guest, cleared: GuestSeatPlace[]): void
  onClose(): void
}) {
  const [busy, setBusy] = useState(false)
  return (
    <Dialog open={guest !== null} onClose={onClose} title={guest ? `Delete ${fullName(guest)}` : 'Delete guest'} size="sm" dismissable={!busy} testId="delete-guest-dialog">
      {guest && <DeleteForm key={guest.id} guest={guest} onDeleted={onDeleted} onClose={onClose} busy={busy} setBusy={setBusy} />}
    </Dialog>
  )
}

type Loaded = { kind: 'loading' } | { kind: 'ready'; summary: GuestDeleteSummary } | { kind: 'error'; message: string }

/** "Reception plan: Table 3" lines, one per layout. */
export function seatLines(seats: readonly GuestSeatPlace[]): string[] {
  const byLayout = new Map<string, { name: string; tables: string[] }>()
  for (const s of seats) {
    const entry = byLayout.get(s.layoutId) ?? { name: s.layoutName, tables: [] }
    entry.tables.push(s.itemLabel)
    byLayout.set(s.layoutId, entry)
  }
  return [...byLayout.values()].map((e) => `${e.name}: ${joinAnd(e.tables)}`)
}

function DeleteForm({
  guest,
  onDeleted,
  onClose,
  busy,
  setBusy,
}: {
  guest: Guest
  onDeleted(guest: Guest, cleared: GuestSeatPlace[]): void
  onClose(): void
  busy: boolean
  setBusy(busy: boolean): void
}) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    guestDeleteSummary(guest.id).then(
      (summary) => {
        if (live) setLoaded({ kind: 'ready', summary })
      },
      (err: unknown) => {
        if (live) setLoaded({ kind: 'error', message: `Could not check what goes with it. ${errorMessage(err)}` })
      },
    )
    return () => {
      live = false
    }
  }, [guest.id, attempt])

  async function confirm() {
    if (busy || loaded.kind !== 'ready') return
    setBusy(true)
    setError(null)
    try {
      const reply = await deleteGuest(guest.id)
      setBusy(false)
      onDeleted(guest, reply.clearedSeats)
    } catch (err) {
      setError(`Could not delete. ${errorMessage(err)}`)
      setBusy(false)
    }
  }

  const name = fullName(guest)
  return (
    <div>
      <div aria-live="polite" className="space-y-2 text-sm text-stone-800" data-testid="delete-guest-summary">
        {loaded.kind === 'loading' && <p className="text-stone-600">Checking what goes with it…</p>}
        {loaded.kind === 'error' && (
          <div className="space-y-2">
            <p className={errorClass}>{loaded.message}</p>
            <button
              type="button"
              className={secondaryButton}
              onClick={() => {
                setLoaded({ kind: 'loading' })
                setAttempt((n) => n + 1)
              }}
            >
              Try again
            </button>
          </div>
        )}
        {loaded.kind === 'ready' && (
          <>
            {loaded.summary.seats.length === 0 ? (
              <p>{name} is not seated in any layout.</p>
            ) : (
              <>
                <p>This clears {name}&rsquo;s seat in:</p>
                <ul className="list-disc space-y-1 pl-5" data-testid="delete-guest-seats">
                  {seatLines(loaded.summary.seats).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </>
            )}
            {loaded.summary.partnerName && <p>It unlinks their partner, {loaded.summary.partnerName}.</p>}
            {(loaded.summary.groups > 0 || loaded.summary.rules > 0) && (
              <p>
                They leave{' '}
                {joinAnd(
                  [
                    loaded.summary.groups > 0 ? plural(loaded.summary.groups, 'group') : '',
                    loaded.summary.rules > 0 ? plural(loaded.summary.rules, 'rule') : '',
                  ].filter(Boolean),
                )}
                .
              </p>
            )}
          </>
        )}
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
        <button type="button" className={dangerButton} onClick={() => void confirm()} disabled={busy || loaded.kind !== 'ready'} data-testid="delete-guest-confirm">
          {busy ? 'Deleting…' : 'Delete guest'}
        </button>
      </DialogActions>
    </div>
  )
}
