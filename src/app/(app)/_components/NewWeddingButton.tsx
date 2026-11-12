'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { createWedding, errorMessage } from '@/client/api'
import { randomId } from '@/client/sync/random-id'
import { Dialog, DialogActions } from '@/client/ui/Dialog'
import { ChoiceGroup, TextField, UNIT_CHOICES } from '@/client/ui/fields'
import { PartnerNameFields } from '@/client/ui/PartnerNameFields'
import { errorClass, primaryButton, secondaryButton } from '@/client/ui/styles'

/** "New wedding": name, optional date, the partners' names, feet or meters. Opens the new wedding once made. */
export function NewWeddingButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className={primaryButton} onClick={() => setOpen(true)}>
        New wedding
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="New wedding">
        {open && <NewWeddingForm onCancel={() => setOpen(false)} />}
      </Dialog>
    </>
  )
}

function NewWeddingForm({ onCancel }: { onCancel: () => void }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const [partner1, setPartner1] = useState('')
  const [partner2, setPartner2] = useState('')
  const [unit, setUnit] = useState<'ft' | 'm'>('ft')
  const [nameError, setNameError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** One id per form, so a second click after a lost reply finds the same wedding. */
  const [id] = useState(randomId)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const trimmed = name.trim()
    if (trimmed === '') {
      setNameError('Names cannot be empty.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const wedding = await createWedding({
        id,
        name: trimmed,
        date: date || null,
        unit,
        partner1Name: partner1.trim() || null,
        partner2Name: partner2.trim() || null,
      })
      router.push(`/w/${wedding.id}/layouts`)
    } catch (err) {
      setError(`Could not create the wedding. ${errorMessage(err)}`)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <TextField
        label="Name"
        value={name}
        onChange={(v) => {
          setName(v)
          setNameError(null)
        }}
        error={nameError}
        placeholder="e.g. Sam & Alex"
        maxLength={200}
        autoComplete="off"
        required
      />
      <TextField label="Date (optional)" type="date" value={date} onChange={setDate} />
      <PartnerNameFields partner1={partner1} partner2={partner2} onPartner1={setPartner1} onPartner2={setPartner2} />
      <ChoiceGroup legend="Measure in" name="unit" value={unit} onChange={setUnit} choices={UNIT_CHOICES} />
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
          {busy ? 'Creating…' : 'Create wedding'}
        </button>
      </DialogActions>
    </form>
  )
}
