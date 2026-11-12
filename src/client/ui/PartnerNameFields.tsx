'use client'

/**
 * The couple's two names, for the New wedding and Wedding settings dialogs.
 * Guest sides show them ("Sam", "Alex", "Both"); either may stay blank, and
 * then reads "Partner 1" or "Partner 2".
 */
import { PARTNER_NAME_MAX } from '@/domain/partners'
import { TextField } from './fields'
import { hintClass, labelClass } from './styles'

export function PartnerNameFields({
  partner1,
  partner2,
  onPartner1,
  onPartner2,
}: {
  partner1: string
  partner2: string
  onPartner1(value: string): void
  onPartner2(value: string): void
}) {
  return (
    <fieldset>
      <legend className={labelClass}>Partner names (optional)</legend>
      <p className={hintClass}>Guest sides show these names. Left blank, they read Partner 1 and Partner 2.</p>
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextField
          label="Partner 1"
          value={partner1}
          onChange={onPartner1}
          placeholder="e.g. Sam"
          maxLength={PARTNER_NAME_MAX}
          autoComplete="off"
          data-testid="partner1-name"
        />
        <TextField
          label="Partner 2"
          value={partner2}
          onChange={onPartner2}
          placeholder="e.g. Alex"
          maxLength={PARTNER_NAME_MAX}
          autoComplete="off"
          data-testid="partner2-name"
        />
      </div>
    </fieldset>
  )
}
