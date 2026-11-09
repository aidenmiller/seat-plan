'use client'

/**
 * Asks before a seat change moves guests to Unassigned (spec section 4,
 * "Seats"; DECISIONS 10): the − button on a full table, a typed seat count
 * or Fit seats. Guest names arrive with the guest list (milestone 4), so for
 * now it names their seats.
 */
import { Dialog, DialogActions } from '@/client/ui/Dialog'
import { dangerButton, secondaryButton } from '@/client/ui/styles'
import type { Canvas } from '@/domain/canvas-schema'

export type UnseatAsk = {
  tableId: string
  /** Guest ids, highest seat numbers first. */
  unseated: readonly string[]
  /** Makes the change. False when it could not be made after all. */
  confirm(): boolean
}

/** "Remove 2 guests from their seats?" */
export function unseatTitle(count: number): string {
  return count === 1 ? 'Remove 1 guest from their seat?' : `Remove ${count} guests from their seats?`
}

/** Each guest's seat number (from 1) at the table now, in the order given; null when not found. */
export function unseatSeatNumbers(canvas: Canvas, ask: Pick<UnseatAsk, 'tableId' | 'unseated'>): (number | null)[] {
  const table = canvas.items.find((i) => i.id === ask.tableId)
  if (!table || (table.kind !== 'table' && table.kind !== 'chairRow')) return ask.unseated.map(() => null)
  return ask.unseated.map((guestId) => {
    const i = table.seats.findIndex((s) => s.guestId === guestId)
    return i < 0 ? null : i + 1
  })
}

export function UnseatDialog({ ask, canvas, onClose }: { ask: UnseatAsk | null; canvas: Canvas; onClose(): void }) {
  const count = ask?.unseated.length ?? 0
  const seats = ask ? unseatSeatNumbers(canvas, ask) : []
  const numbers = seats.filter((n): n is number => n !== null).sort((a, b) => a - b)
  return (
    <Dialog
      open={ask !== null}
      onClose={onClose}
      title={unseatTitle(count)}
      description={count === 1 ? '1 guest moves to Unassigned.' : `${count} guests move to Unassigned.`}
      size="sm"
      testId="unseat-dialog"
    >
      {numbers.length > 0 && (
        <ul className="space-y-1 text-sm text-stone-800" data-testid="unseat-list">
          {numbers.map((n) => (
            <li key={n} className="rounded-lg bg-stone-100 px-3 py-2">
              Guest in seat {n}
            </li>
          ))}
        </ul>
      )}
      <DialogActions>
        <button type="button" className={secondaryButton} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={dangerButton}
          onClick={() => {
            ask?.confirm()
            onClose()
          }}
        >
          Remove from seats
        </button>
      </DialogActions>
    </Dialog>
  )
}
