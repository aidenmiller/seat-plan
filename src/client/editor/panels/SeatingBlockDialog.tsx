'use client'

/**
 * The seating block tool (spec section 8): rows, chairs per row, aisle
 * width and the two side labels, which start as the partners' names ("Sam's
 * side" on the left, "Alex's side" on the right). Add places two blocks of
 * chair rows either side of the aisle in the middle of the view
 * (domain/ceremony.ts).
 */
import { useState, type FormEvent } from 'react'
import { usePartnerNames } from '@/client/guests/partners-context'
import { Dialog, DialogActions } from '@/client/ui/Dialog'
import { TextField } from '@/client/ui/fields'
import { primaryButton, secondaryButton } from '@/client/ui/styles'
import { AISLE_WIDTH_CM, CHAIR_PITCH_CM, DEFAULT_LEFT_LABEL, DEFAULT_RIGHT_LABEL, MAX_BLOCK_ROWS, MAX_CHAIRS_PER_ROW, ROW_PITCH_CM, type SeatingBlockOptions } from '@/domain/ceremony'
import { ceremonySideLabels } from '@/domain/partners'
import { formatLength, parseLength, type LengthUnit } from '@/domain/units'

export type SeatingBlockChoice = Omit<SeatingBlockOptions, 'origin' | 'facing'>

type Errors = Partial<Record<'rows' | 'chairs' | 'aisle', string>>

function wholeNumber(text: string, max: number): number | null {
  const n = Number(text.trim())
  return text.trim() !== '' && Number.isInteger(n) && n >= 1 && n <= max ? n : null
}

/** The form's values, or what is wrong with them. */
export function readBlockForm(
  form: { rows: string; chairs: string; aisle: string; left: string; right: string },
  unit: LengthUnit,
): { ok: true; value: SeatingBlockChoice } | { ok: false; errors: Errors } {
  const rows = wholeNumber(form.rows, MAX_BLOCK_ROWS)
  const chairs = wholeNumber(form.chairs, MAX_CHAIRS_PER_ROW)
  const aisle = parseLength(form.aisle, unit)
  const errors: Errors = {}
  if (rows === null) errors.rows = `Type a whole number from 1 to ${MAX_BLOCK_ROWS}.`
  if (chairs === null) errors.chairs = `Type a whole number from 1 to ${MAX_CHAIRS_PER_ROW}.`
  if (aisle === null || !(aisle > 0)) errors.aisle = unit === 'ft' ? 'Type a length, such as 6 ft.' : 'Type a length, such as 1.8 m.'
  if (rows === null || chairs === null || aisle === null || !(aisle > 0)) return { ok: false, errors }
  return {
    ok: true,
    value: { rows, chairsPerRow: chairs, aisleWidthCm: aisle, leftLabel: form.left.trim() || DEFAULT_LEFT_LABEL, rightLabel: form.right.trim() || DEFAULT_RIGHT_LABEL },
  }
}

export function SeatingBlockDialog({ open, unit, onCancel, onAdd }: { open: boolean; unit: LengthUnit; onCancel(): void; onAdd(choice: SeatingBlockChoice): void }) {
  if (!open) return null
  return <BlockForm unit={unit} onCancel={onCancel} onAdd={onAdd} />
}

function BlockForm({ unit, onCancel, onAdd }: { unit: LengthUnit; onCancel(): void; onAdd(choice: SeatingBlockChoice): void }) {
  const partners = usePartnerNames()
  const [form, setForm] = useState(() => {
    const sides = ceremonySideLabels(partners)
    return { rows: '8', chairs: '6', aisle: formatLength(AISLE_WIDTH_CM, unit), left: sides.left, right: sides.right }
  })
  const [errors, setErrors] = useState<Errors>({})
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }))

  function submit(event: FormEvent) {
    event.preventDefault()
    const read = readBlockForm(form, unit)
    if (!read.ok) {
      setErrors(read.errors)
      return
    }
    onAdd(read.value)
  }

  return (
    <Dialog open onClose={onCancel} title="Seating block" description="Rows of chairs on each side of an aisle, numbered from the front." size="sm" testId="seating-block-dialog">
      <form onSubmit={submit} noValidate className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Rows" value={form.rows} onChange={set('rows')} inputMode="numeric" error={errors.rows} data-testid="block-rows" />
          <TextField label="Chairs per row" value={form.chairs} onChange={set('chairs')} inputMode="numeric" error={errors.chairs} hint="On each side." data-testid="block-chairs" />
        </div>
        <TextField label="Aisle width" value={form.aisle} onChange={set('aisle')} error={errors.aisle} data-testid="block-aisle" />
        <TextField label="Left side" value={form.left} onChange={set('left')} maxLength={100} data-testid="block-left" />
        <TextField label="Right side" value={form.right} onChange={set('right')} maxLength={100} data-testid="block-right" />
        <p className="text-sm text-stone-600">
          Chairs sit {formatLength(CHAIR_PITCH_CM, unit)} apart, with {formatLength(ROW_PITCH_CM, unit)} from one row to the next.
        </p>
        <DialogActions>
          <button type="button" className={secondaryButton} onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className={primaryButton} data-testid="block-add">
            Add block
          </button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
