'use client'

/** Small labelled form fields shared by the dialogs. */
import { useId, type InputHTMLAttributes, type ReactNode } from 'react'
import { errorClass, hintClass, inputClass, labelClass } from './styles'

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'className' | 'onChange'> & {
  label: string
  value: string
  onChange: (value: string) => void
  hint?: ReactNode
  error?: string | null
}

export function TextField({ label, value, onChange, hint, error, ...rest }: TextFieldProps) {
  const id = useId()
  const hintId = useId()
  const errorId = useId()
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`${inputClass} mt-1`}
        {...rest}
      />
      {hint && (
        <p id={hintId} className={hintClass}>
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className={`${errorClass} mt-1`}>
          {error}
        </p>
      )}
    </div>
  )
}

export type Choice<T extends string> = { value: T; label: string; hint?: string }

/** A set of radio buttons drawn as large tappable rows. */
export function ChoiceGroup<T extends string>({
  legend,
  name,
  value,
  onChange,
  choices,
  columns = 2,
}: {
  legend: string
  name: string
  value: T
  onChange: (value: T) => void
  choices: readonly Choice<T>[]
  columns?: 1 | 2
}) {
  return (
    <fieldset>
      <legend className={labelClass}>{legend}</legend>
      <div className={`mt-1 grid gap-2 ${columns === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {choices.map((choice) => (
          <label
            key={choice.value}
            className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
              value === choice.value ? 'border-blue-800 bg-blue-50 text-blue-950' : 'border-stone-300 bg-white text-stone-800'
            }`}
          >
            <input
              type="radio"
              name={name}
              value={choice.value}
              checked={value === choice.value}
              onChange={() => onChange(choice.value)}
              className="h-4 w-4 shrink-0 accent-blue-900"
            />
            <span className="min-w-0">
              <span className="block font-medium">{choice.label}</span>
              {choice.hint && <span className="block text-stone-600">{choice.hint}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export const UNIT_CHOICES: readonly Choice<'ft' | 'm'>[] = [
  { value: 'ft', label: 'Feet' },
  { value: 'm', label: 'Meters' },
]
