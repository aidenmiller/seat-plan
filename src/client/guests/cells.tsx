'use client'

/**
 * Fields edited in place, for the guest table, the guest cards and the
 * groups page. A text field shows its value as a button; a click opens an
 * input where Enter saves and Esc cancels (leaving the field saves too). A
 * required field refuses an empty value and puts the old one back. Selects
 * and check boxes save as soon as they change. Every control is at least
 * 44 px tall, and inputs use 16 px text so iPhones do not zoom in.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

export type EditableTextProps = {
  value: string | null
  /** Saves the trimmed value, or null when it was cleared (never for a required field). */
  onSave(value: string | null): void
  /** What the field is, for screen readers: "First name of Ann Lee". */
  label: string
  /** Refuse an empty value. */
  required?: boolean
  /** Notes: Shift+Enter starts a new line; Enter still saves. */
  multiline?: boolean
  /** Shown when empty, in grey. */
  placeholder?: string
  maxLength?: number
  disabled?: boolean
  className?: string
  testId?: string
}

export const EMPTY_NAME_MESSAGE = 'First and last names cannot be empty.'

export function EditableText({
  value,
  onSave,
  label,
  required = false,
  multiline = false,
  placeholder = '',
  maxLength = 200,
  disabled = false,
  className = '',
  testId,
}: EditableTextProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  /** Enter or Esc already ended the edit; the blur that follows does nothing. */
  const doneRef = useRef(false)
  /** Enter and Esc give focus back to the button; a blur leaves it where the person put it. */
  const refocusRef = useRef(false)
  const errorId = useId()

  useEffect(() => {
    if (!editing) {
      if (refocusRef.current) buttonRef.current?.focus()
      refocusRef.current = false
      return
    }
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing])

  useEffect(() => {
    if (!error) return
    const timer = setTimeout(() => setError(null), 5000)
    return () => clearTimeout(timer)
  }, [error])

  function start() {
    if (disabled) return
    doneRef.current = false
    setDraft(value ?? '')
    setError(null)
    setEditing(true)
  }

  function commit() {
    if (doneRef.current) return
    doneRef.current = true
    setEditing(false)
    const next = multiline ? draft.replace(/[ \t]+$/gm, '').trim() : draft.replace(/\s+/g, ' ').trim()
    if (next === '' && required) {
      setError(EMPTY_NAME_MESSAGE)
      return
    }
    if (next === (value ?? '')) return
    onSave(next === '' ? null : next)
  }

  function cancel() {
    doneRef.current = true
    setEditing(false)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !(multiline && event.shiftKey) && !event.nativeEvent.isComposing) {
      event.preventDefault()
      refocusRef.current = true
      commit()
    } else if (event.key === 'Escape') {
      // Keep the Esc for this field; a dialog around it must not close.
      event.preventDefault()
      event.stopPropagation()
      refocusRef.current = true
      cancel()
    }
  }

  const fieldClass =
    'block w-full min-w-0 rounded-lg border border-blue-700 bg-white px-2 text-base outline-none ring-2 ring-blue-700/20'

  return (
    <div className={`min-w-0 ${className}`}>
      {editing ? (
        multiline ? (
          <textarea
            ref={inputRef}
            aria-label={label}
            value={draft}
            maxLength={10_000}
            rows={3}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={commit}
            data-testid={testId ? `${testId}-input` : undefined}
            className={`${fieldClass} min-h-11 py-2`}
          />
        ) : (
          <input
            ref={inputRef}
            aria-label={label}
            value={draft}
            maxLength={maxLength}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={commit}
            enterKeyHint="done"
            autoComplete="off"
            data-testid={testId ? `${testId}-input` : undefined}
            className={`${fieldClass} h-11`}
          />
        )
      ) : (
        <button
          ref={buttonRef}
          type="button"
          onClick={start}
          disabled={disabled}
          aria-describedby={error ? errorId : undefined}
          data-testid={testId}
          className="-mx-1 flex min-h-11 w-full min-w-0 items-center rounded-lg px-1 text-left text-sm hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700/50 disabled:cursor-default disabled:hover:bg-transparent"
        >
          <span className="sr-only">{label}: </span>
          {value ? (
            <span className={multiline ? 'line-clamp-2 whitespace-pre-line break-words' : 'truncate'}>{value}</span>
          ) : (
            <span className="text-stone-400">
              {placeholder}
              <span className="sr-only">{placeholder ? '' : 'empty'}</span>
            </span>
          )}
        </button>
      )}
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}

export function SelectField<T extends string>({
  value,
  onChange,
  label,
  options,
  showLabel = false,
  disabled,
  testId,
  className = '',
}: {
  value: T
  onChange(value: T): void
  label: string
  options: readonly { value: T; label: string }[]
  /** Show the label above (cards and dialogs); tables keep it for screen readers only. */
  showLabel?: boolean
  disabled?: boolean
  testId?: string
  className?: string
}) {
  const id = useId()
  return (
    <div className={className}>
      <label htmlFor={id} className={showLabel ? 'block text-sm font-medium text-stone-700' : 'sr-only'}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as T)}
        data-testid={testId}
        className={`${showLabel ? 'mt-1' : ''} block h-11 w-full min-w-0 rounded-lg border border-stone-300 bg-white px-2 text-base text-stone-900 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-700/20 sm:text-sm`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

export function CheckField({
  checked,
  onChange,
  label,
  children,
  disabled,
  testId,
}: {
  checked: boolean
  onChange(checked: boolean): void
  /** For screen readers when no visible text is given. */
  label: string
  children?: ReactNode
  disabled?: boolean
  testId?: string
}) {
  return (
    <label className="inline-flex min-h-11 min-w-11 cursor-pointer items-center gap-2 text-sm text-stone-800">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={children ? undefined : label}
        data-testid={testId}
        className="h-5 w-5 shrink-0 accent-blue-900"
      />
      {children}
    </label>
  )
}

/** A small colored dot and name for a group. */
export function GroupChip({ name, color }: { name: string; color: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-stone-200 bg-white px-2 py-0.5 text-xs text-stone-800">
      <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="truncate">{name}</span>
    </span>
  )
}
