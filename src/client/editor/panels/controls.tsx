'use client'

/**
 * Small controls for the editor's panels: sections, switches, segmented
 * choices and fields that save when you press Enter or leave them (Esc puts
 * the value back). Every control is at least 44 px tall, and fields use
 * 16 px text so iPhones do not zoom in on them.
 */
import { useId, useState, type KeyboardEvent, type ReactNode } from 'react'
import { formatLength, parseLength, type LengthUnit } from '@/domain/units'
import { inputClass, labelClass } from '@/client/ui/styles'

export function Section({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return (
    <section className="border-b border-stone-200 px-4 py-4 last:border-b-0" data-testid={testId}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">{title}</h3>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  )
}

export function Switch({
  label,
  checked,
  onChange,
  hint,
  disabled,
  testId,
}: {
  label: string
  checked: boolean
  onChange(next: boolean): void
  hint?: string
  disabled?: boolean
  testId?: string
}) {
  const id = useId()
  return (
    <div className="flex min-h-11 items-center justify-between gap-3">
      <label htmlFor={id} className="min-w-0 text-sm text-stone-800">
        {label}
        {hint && <span className="block text-xs text-stone-500">{hint}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        data-testid={testId}
        className={`relative inline-flex h-11 w-14 shrink-0 items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-blue-700/50 disabled:cursor-not-allowed disabled:opacity-50`}
      >
        <span aria-hidden="true" className={`absolute inset-x-1 h-7 rounded-full transition-colors ${checked ? 'bg-blue-900' : 'bg-stone-300'}`} />
        <span
          aria-hidden="true"
          className={`absolute h-6 w-6 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[1.625rem]' : 'translate-x-1.5'}`}
        />
      </button>
    </div>
  )
}

export type SegmentOption<T extends string> = { value: T; label: string }

/** A row of choices, one of which is on (radio buttons drawn as a segmented control). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  testId,
}: {
  label: string
  value: T
  options: readonly SegmentOption<T>[]
  onChange(next: T): void
  disabled?: boolean
  testId?: string
}) {
  const labelId = useId()
  return (
    <div>
      <p id={labelId} className={labelClass}>
        {label}
      </p>
      <div role="radiogroup" aria-labelledby={labelId} data-testid={testId} className="mt-1 flex rounded-lg border border-stone-300 bg-stone-50 p-0.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={`min-h-11 flex-1 rounded-md px-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-blue-700/50 disabled:cursor-not-allowed disabled:opacity-50 ${
              o.value === value ? 'bg-white text-blue-950 shadow-sm ring-1 ring-stone-300' : 'text-stone-700 hover:bg-white/70'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export type CommitFieldProps = {
  label: string
  /** The stored value, shown whenever the field is not being edited. */
  value: string
  /** Saves the typed text. Return an error message to refuse it. */
  onCommit(text: string): string | null | void
  disabled?: boolean
  hint?: ReactNode
  inputMode?: 'text' | 'decimal' | 'numeric'
  multiline?: boolean
  maxLength?: number
  testId?: string
  /** Shown after the field, such as °. */
  suffix?: string
}

/** A field that saves on Enter or when it loses focus, and puts the stored value back on Esc. */
export function CommitField({ label, value, onCommit, disabled, hint, inputMode = 'text', multiline, maxLength, testId, suffix }: CommitFieldProps) {
  const id = useId()
  const errorId = useId()
  const [draft, setDraft] = useState<string | null>(null)
  const [from, setFrom] = useState(value)
  const [error, setError] = useState<string | null>(null)

  function commit() {
    if (draft === null) return
    const text = draft
    setDraft(null)
    if (text === from) return
    const refused = onCommit(text)
    setError(refused || null)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (!multiline || !event.shiftKey)) {
      event.preventDefault()
      commit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setDraft(null)
      setError(null)
    }
  }

  const common = {
    id,
    value: draft ?? value,
    disabled,
    maxLength,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? errorId : undefined,
    'data-testid': testId,
    onFocus: () => {
      setFrom(value)
      setDraft(value)
    },
    onBlur: commit,
    onKeyDown,
    autoComplete: 'off',
    spellCheck: false,
  } as const

  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <div className="mt-1 flex items-center gap-2">
        {multiline ? (
          <textarea
            {...common}
            rows={2}
            onChange={(e) => setDraft(e.target.value)}
            className={`${inputClass} h-auto min-h-11 resize-y py-2`}
          />
        ) : (
          <input {...common} type="text" inputMode={inputMode} onChange={(e) => setDraft(e.target.value)} className={inputClass} />
        )}
        {suffix && <span className="shrink-0 text-sm text-stone-600">{suffix}</span>}
      </div>
      {hint && !error && <p className="mt-1 text-xs text-stone-500">{hint}</p>}
      {error && (
        <p id={errorId} className="mt-1 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}

/** A length in the wedding's unit: shows 5′ 6″ or 1.68 m, takes any of the forms parseLength reads. */
export function LengthField({
  label,
  cm,
  unit,
  onChange,
  disabled,
  testId,
}: {
  label: string
  cm: number
  unit: LengthUnit
  onChange(cm: number): void
  disabled?: boolean
  testId?: string
}) {
  return (
    <CommitField
      label={label}
      value={formatLength(cm, unit)}
      disabled={disabled}
      inputMode="text"
      testId={testId}
      onCommit={(text) => {
        const next = parseLength(text, unit)
        if (next === null || !(next > 0)) return unit === 'ft' ? 'Type a length, such as 5′ 6″ or 66 in.' : 'Type a length, such as 1.5 m or 150 cm.'
        onChange(next)
      }}
    />
  )
}

/** A plain number: table numbers, rotation, seat counts. */
export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  integer,
  disabled,
  suffix,
  testId,
  hint,
}: {
  label: string
  value: number
  onChange(value: number): void
  min?: number
  max?: number
  integer?: boolean
  disabled?: boolean
  suffix?: string
  testId?: string
  hint?: ReactNode
}) {
  const shown = integer ? String(Math.round(value)) : String(Math.round(value * 10) / 10)
  return (
    <CommitField
      label={label}
      value={shown}
      disabled={disabled}
      inputMode={integer ? 'numeric' : 'decimal'}
      suffix={suffix}
      testId={testId}
      hint={hint}
      onCommit={(text) => {
        const n = Number(text.trim().replace(',', '.').replace(/°$/, ''))
        if (text.trim() === '' || !Number.isFinite(n)) return 'Type a number.'
        if (integer && !Number.isInteger(n)) return 'Type a whole number.'
        if (min !== undefined && n < min) return `Type ${min} or more.`
        if (max !== undefined && n > max) return `Type ${max} or less.`
        onChange(n)
      }}
    />
  )
}

/** A full-width row of small buttons. */
export function ButtonRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>
}

export const smallButton =
  'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 text-sm font-medium text-stone-800 ' +
  'outline-none hover:bg-stone-100 focus-visible:ring-2 focus-visible:ring-blue-700/50 disabled:cursor-not-allowed disabled:opacity-50'

export const smallDangerButton =
  'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 text-sm font-medium text-red-700 ' +
  'outline-none hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-red-700/40 disabled:cursor-not-allowed disabled:opacity-50'
