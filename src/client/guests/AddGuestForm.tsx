'use client'

/**
 * The Add guest row: first and last name, then Add (or Enter). The guest is
 * created on the server at once, with an id made here so a retry is
 * harmless; other fields are filled in on the list afterwards.
 */
import { useRef, useState } from 'react'
import { createGuest, errorMessage } from '@/client/api'
import { randomId } from '@/client/sync/random-id'
import { errorClass, inputClass, primaryButton } from '@/client/ui/styles'
import type { Guest } from '@/shared/api'
import { EMPTY_NAME_MESSAGE } from './cells'

export function AddGuestForm({ weddingId, onAdded }: { weddingId: string; onAdded(guest: Guest): void }) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [id, setId] = useState(randomId)
  const firstRef = useRef<HTMLInputElement>(null)

  async function submit() {
    if (busy) return
    const first = firstName.trim()
    const last = lastName.trim()
    if (!first || !last) {
      setError(EMPTY_NAME_MESSAGE)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const guest = await createGuest(weddingId, { id, firstName: first, lastName: last })
      onAdded(guest)
      setFirstName('')
      setLastName('')
      setId(randomId())
      firstRef.current?.focus()
    } catch (err) {
      setError(`Could not add the guest. ${errorMessage(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      aria-label="Add guest"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
      noValidate
      className="rounded-xl border border-stone-200 bg-white p-3"
      data-testid="add-guest-form"
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 basis-36 text-sm font-medium text-stone-700">
          First name
          <input
            ref={firstRef}
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            maxLength={200}
            autoComplete="off"
            className={`${inputClass} mt-1`}
            data-testid="add-guest-first"
          />
        </label>
        <label className="min-w-0 flex-1 basis-36 text-sm font-medium text-stone-700">
          Last name
          <input
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            maxLength={200}
            autoComplete="off"
            className={`${inputClass} mt-1`}
            data-testid="add-guest-last"
          />
        </label>
        <button type="submit" className={`${primaryButton} w-full sm:w-auto`} disabled={busy} data-testid="add-guest-submit">
          {busy ? 'Adding…' : 'Add guest'}
        </button>
      </div>
      {error && (
        <p role="alert" className={`${errorClass} mt-2`}>
          {error}
        </p>
      )}
    </form>
  )
}
