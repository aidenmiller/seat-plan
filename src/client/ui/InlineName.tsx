'use client'

/**
 * A name you click to edit in place (spec section 10, "Renaming"). Enter or
 * leaving the field saves; Esc cancels. An empty name is refused with a short
 * message and the old name comes back. While the save is out the new name
 * shows; if it fails, the old name comes back with the reason.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { errorMessage } from '@/client/api'

export type InlineNameProps = {
  value: string
  /** Saves the trimmed name. Throw to refuse it; the old name comes back. */
  onSave: (name: string) => Promise<unknown>
  /** What the name is, for screen readers: "Wedding name", "Layout name". */
  label: string
  /** Classes for the name text (size, weight). */
  textClassName?: string
  className?: string
  maxLength?: number
  testId?: string
}

const EMPTY_MESSAGE = 'Names cannot be empty.'

export function InlineName({
  value,
  onSave,
  label,
  textClassName = 'font-medium',
  className = '',
  maxLength = 200,
  testId,
}: InlineNameProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  /** The name just saved, shown until the page brings the new value. */
  const [pending, setPending] = useState<{ name: string; from: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  /** Enter and Esc hand focus back to the name; leaving the field leaves focus where the person put it. */
  const refocusRef = useRef(false)
  /** Set when Enter or Esc already finished the edit, so the blur that follows does nothing. */
  const finishedRef = useRef(false)
  const errorId = useId()

  // The saved name stays on screen until the value from the server changes.
  const shown = pending && pending.from === value ? pending.name : value

  useEffect(() => {
    if (!editing) {
      if (refocusRef.current) buttonRef.current?.focus()
      refocusRef.current = false
      return
    }
    const input = inputRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [editing])

  useEffect(() => {
    if (!error) return
    const timer = setTimeout(() => setError(null), 5000)
    return () => clearTimeout(timer)
  }, [error])

  function start() {
    finishedRef.current = false
    setDraft(shown)
    setError(null)
    setEditing(true)
  }

  function cancel() {
    finishedRef.current = true
    setEditing(false)
    setDraft(shown)
  }

  function commit() {
    if (finishedRef.current) return
    finishedRef.current = true
    setEditing(false)
    const name = draft.trim()
    if (name === '') {
      setError(EMPTY_MESSAGE)
      setDraft(shown)
      return
    }
    if (name === shown) return
    const before = value
    setPending({ name, from: before })
    onSave(name).then(
      () => undefined,
      (err: unknown) => {
        setPending(null)
        setError(`Could not rename. ${errorMessage(err)}`)
      },
    )
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
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

  return (
    // Spans, not divs: the name often sits inside a heading.
    <span className={`block min-w-0 ${className}`}>
      {editing ? (
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
          className={`block h-11 w-full min-w-0 rounded-lg border border-blue-700 bg-white px-2 text-base outline-none ring-2 ring-blue-700/20 ${textClassName}`}
        />
      ) : (
        <button
          ref={buttonRef}
          type="button"
          onClick={start}
          title="Click to rename"
          aria-describedby={error ? errorId : undefined}
          data-testid={testId}
          className={`group -mx-2 flex min-h-11 max-w-full items-center gap-1.5 rounded-lg px-2 text-left hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700/50 ${textClassName}`}
        >
          <span className="min-w-0 truncate">{shown}</span>
          <PencilIcon />
        </button>
      )}
      {error && (
        <span id={errorId} role="alert" className="mt-1 block text-sm font-normal text-red-700">
          {error}
        </span>
      )}
    </span>
  )
}

function PencilIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="h-4 w-4 shrink-0 text-stone-400 opacity-60 group-hover:opacity-100"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <path d="M13.5 3.5l3 3L7 16H4v-3l9.5-9.5z" strokeLinejoin="round" />
    </svg>
  )
}
