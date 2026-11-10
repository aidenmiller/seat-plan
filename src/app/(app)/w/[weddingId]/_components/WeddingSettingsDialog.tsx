'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { backupUrl, errorMessage, updateWedding } from '@/client/api'
import { Dialog, DialogActions } from '@/client/ui/Dialog'
import { ChoiceGroup, TextField, UNIT_CHOICES } from '@/client/ui/fields'
import { errorClass, hintClass, labelClass, primaryButton, secondaryButton } from '@/client/ui/styles'
import { convertLengthText, formatLength, parseLength, type LengthUnit } from '@/domain/units'
import type { UpdateWeddingBody, WeddingSummary } from '@/shared/api'

/** The largest gap the server takes (src/shared/api.ts, updateWeddingBody). */
const MAX_GAP_CM = 10_000

/**
 * Wedding settings (PLAN section 7): name, date, unit, and the minimum gap
 * between tables, shown and typed in the wedding's unit and stored in cm.
 */
export function WeddingSettingsDialog({
  wedding,
  open,
  onClose,
  onSaved,
}: {
  wedding: WeddingSummary
  open: boolean
  onClose: () => void
  /** The wedding as the server stored it, before router.refresh() brings new props. */
  onSaved?: (wedding: WeddingSummary) => void
}) {
  return (
    <Dialog open={open} onClose={onClose} title="Wedding settings">
      {open && <SettingsForm wedding={wedding} onClose={onClose} onSaved={onSaved} />}
    </Dialog>
  )
}

function SettingsForm({
  wedding,
  onClose,
  onSaved,
}: {
  wedding: WeddingSummary
  onClose: () => void
  onSaved?: (wedding: WeddingSummary) => void
}) {
  const router = useRouter()
  const [name, setName] = useState(wedding.name)
  const [date, setDate] = useState(wedding.date ?? '')
  const [unit, setUnit] = useState<LengthUnit>(wedding.unit)
  const [gap, setGap] = useState(() => formatLength(wedding.minGapCm, wedding.unit))
  /** Only a gap the person typed is sent; a gap shown in a new unit is rounded and must not overwrite the stored one. */
  const [gapTouched, setGapTouched] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const [gapError, setGapError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function changeUnit(next: LengthUnit) {
    setGap((text) => (gapTouched ? convertLengthText(text, unit, next) : formatLength(wedding.minGapCm, next)))
    setUnit(next)
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const trimmed = name.trim()
    let ok = true
    if (trimmed === '') {
      setNameError('Names cannot be empty.')
      ok = false
    }
    let gapCm: number | null = null
    if (gapTouched) {
      gapCm = parseLength(gap, unit)
      if (gapCm === null) {
        setGapError(unit === 'ft' ? 'Type a length such as 5′ or 4′ 6″.' : 'Type a length such as 1.5 m.')
        ok = false
      } else if (gapCm <= 0 || gapCm > MAX_GAP_CM) {
        setGapError(`Type a length above 0 and up to ${formatLength(MAX_GAP_CM, unit)}.`)
        ok = false
      }
    }
    if (!ok) return

    const body: UpdateWeddingBody = {}
    if (trimmed !== wedding.name) body.name = trimmed
    const newDate = date || null
    if (newDate !== wedding.date) body.date = newDate
    if (unit !== wedding.unit) body.unit = unit
    if (gapCm !== null && Math.abs(gapCm - wedding.minGapCm) > 1e-6) body.minGapCm = gapCm
    if (Object.keys(body).length === 0) {
      onClose()
      return
    }
    setBusy(true)
    setError(null)
    try {
      const updated = await updateWedding(wedding.id, body)
      onSaved?.(updated)
      onClose()
      router.refresh()
    } catch (err) {
      setError(`Could not save the settings. ${errorMessage(err)}`)
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
        maxLength={200}
        autoComplete="off"
      />
      <TextField label="Date (optional)" type="date" value={date} onChange={setDate} />
      <ChoiceGroup legend="Measure in" name="unit" value={unit} onChange={changeUnit} choices={UNIT_CHOICES} />
      <TextField
        label="Minimum gap between tables"
        value={gap}
        onChange={(v) => {
          setGap(v)
          setGapTouched(true)
          setGapError(null)
        }}
        error={gapError}
        hint={
          unit === 'ft'
            ? 'In feet and inches, for example 5′ or 4′ 6″. Tables closer than this get a warning.'
            : 'In meters, for example 1.5. Tables closer than this get a warning.'
        }
        inputMode="text"
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      <div className="border-t border-stone-200 pt-4">
        <p className={labelClass}>Backup</p>
        <p className={hintClass}>
          One file with the guests, groups, rules, layouts and venues. Restore it from the home screen as a new wedding.
        </p>
        {/* A plain link: the browser saves the file as it arrives. */}
        <a href={backupUrl(wedding.id)} download className={`${secondaryButton} mt-2`} data-testid="backup-download">
          Download backup
        </a>
      </div>
      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}
      <DialogActions>
        <button type="button" className={secondaryButton} onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className={primaryButton} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </DialogActions>
    </form>
  )
}
