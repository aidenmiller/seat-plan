'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { createLayout, errorMessage } from '@/client/api'
import { useAuthor } from '@/client/author'
import { randomId } from '@/client/sync/random-id'
import { Dialog, DialogActions } from '@/client/ui/Dialog'
import { ChoiceGroup, TextField, type Choice } from '@/client/ui/fields'
import { errorClass, primaryButton, secondaryButton } from '@/client/ui/styles'
import { defaultLayoutName } from '@/domain/wording'
import type { LayoutKind, VenueSummary } from '@/shared/api'

const KIND_CHOICES: readonly Choice<LayoutKind>[] = [
  { value: 'reception', label: 'Reception', hint: 'Tables for the meal' },
  { value: 'ceremony', label: 'Ceremony', hint: 'Rows of chairs' },
]

const BLANK = 'blank'

/** "New layout": pick the kind, then a venue or a blank canvas, then a name. Opens the new layout. */
export function NewLayoutButton({ weddingId, venues }: { weddingId: string; venues: VenueSummary[] }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className={primaryButton} onClick={() => setOpen(true)}>
        New layout
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="New layout">
        {open && <NewLayoutForm weddingId={weddingId} venues={venues} onCancel={() => setOpen(false)} />}
      </Dialog>
    </>
  )
}

function NewLayoutForm({
  weddingId,
  venues,
  onCancel,
}: {
  weddingId: string
  venues: VenueSummary[]
  onCancel: () => void
}) {
  const router = useRouter()
  const author = useAuthor()
  const [kind, setKind] = useState<LayoutKind>('reception')
  const [venue, setVenue] = useState<string>(BLANK)
  const [name, setName] = useState(defaultLayoutName('reception'))
  /** The default name follows the kind until the person types their own. */
  const [nameTouched, setNameTouched] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [id] = useState(randomId)

  const venueChoices: Choice<string>[] = [
    { value: BLANK, label: 'Blank canvas', hint: 'Draw the room yourself' },
    ...venues.map((v) => ({ value: v.id, label: v.name })),
  ]

  function changeKind(next: LayoutKind) {
    setKind(next)
    if (!nameTouched) setName(defaultLayoutName(next))
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (!author) {
      setError('Pick Noa or Aiden first, so the layout carries your name.')
      return
    }
    const trimmed = name.trim()
    if (trimmed === '') {
      setNameError('Names cannot be empty.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const layout = await createLayout(weddingId, {
        id,
        name: trimmed,
        kind,
        venueTemplateId: venue === BLANK ? null : venue,
        editedBy: author,
      })
      router.push(`/w/${weddingId}/layouts/${layout.id}`)
    } catch (err) {
      setError(`Could not create the layout. ${errorMessage(err)}`)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <ChoiceGroup legend="1. Kind" name="kind" value={kind} onChange={changeKind} choices={KIND_CHOICES} />
      <ChoiceGroup legend="2. Venue" name="venue" value={venue} onChange={setVenue} choices={venueChoices} columns={1} />
      <TextField
        label="3. Name"
        value={name}
        onChange={(v) => {
          setName(v)
          setNameTouched(true)
          setNameError(null)
        }}
        error={nameError}
        maxLength={200}
        autoComplete="off"
      />
      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}
      <DialogActions>
        <button type="button" className={secondaryButton} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className={primaryButton} disabled={busy}>
          {busy ? 'Creating…' : 'Create layout'}
        </button>
      </DialogActions>
    </form>
  )
}
