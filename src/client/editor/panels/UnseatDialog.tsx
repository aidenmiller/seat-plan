'use client'

/**
 * Asks before a seat change moves guests to Unassigned (spec section 4,
 * "Seats"; DECISIONS 10): the − button on a full table, a typed seat count
 * or Fit seats. It names each guest with their seat: "Seat 9: Jane Doe".
 */
import { Dialog, DialogActions } from '@/client/ui/Dialog'
import { dangerButton, secondaryButton } from '@/client/ui/styles'
import type { Canvas } from '@/domain/canvas-schema'

export type UnseatAsk = {
  tableId: string
  /** Guest ids, highest seat numbers first. */
  unseated: readonly string[]
  /** Their names, in the same order ("Guest" for one not in the guest list). */
  names: readonly string[]
  /** Makes the change. False when it could not be made after all. */
  confirm(): boolean
}

/** "Remove 2 guests from their seats?" */
export function unseatTitle(count: number): string {
  return count === 1 ? 'Remove 1 guest from their seat?' : `Remove ${count} guests from their seats?`
}

/** "Seat 9: Jane Doe", lowest seat number first; a guest no longer at the table is named without a seat. */
export function unseatLines(canvas: Canvas, ask: Pick<UnseatAsk, 'tableId' | 'unseated' | 'names'>): string[] {
  const seats = unseatSeatNumbers(canvas, ask)
  return ask.unseated
    .map((_, i) => ({ seat: seats[i], name: ask.names[i] ?? 'Guest' }))
    .sort((a, b) => (a.seat ?? Infinity) - (b.seat ?? Infinity))
    .map((l) => (l.seat === null ? l.name : `Seat ${l.seat}: ${l.name}`))
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
  const lines = ask ? unseatLines(canvas, ask) : []
  return (
    <Dialog
      open={ask !== null}
      onClose={onClose}
      title={unseatTitle(count)}
      description={count === 1 ? '1 guest moves to Unassigned.' : `${count} guests move to Unassigned.`}
      size="sm"
      testId="unseat-dialog"
    >
      {lines.length > 0 && (
        <ul className="space-y-1 text-sm text-stone-800" data-testid="unseat-list">
          {lines.map((line, i) => (
            <li key={i} className="rounded-lg bg-stone-100 px-3 py-2">
              {line}
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
