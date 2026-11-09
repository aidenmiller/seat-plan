'use client'

/**
 * The Noa / Aiden switch for the top bar (PLAN change 27), and, on a device
 * where nobody has chosen yet, a small "Who is using this device?" dialog.
 *
 * The dialog does not block the page: it sits in a corner, so the rest of the
 * screen (and Log out) still works. Actions that record a name wait for an
 * answer and say so.
 */
import { useId } from 'react'
import { authors } from '@/domain/canvas-schema'
import { setAuthor, useAuthorState } from '@/client/author'

export function AuthorSwitch({ compact = false }: { compact?: boolean }) {
  const state = useAuthorState()
  const current = state === 'unknown' ? null : state
  return (
    <>
      <div
        role="group"
        aria-label="Who is using this device"
        className="inline-flex shrink-0 rounded-lg border border-stone-300 bg-white p-0.5"
        data-testid="author-switch"
      >
        {authors.map((name) => {
          const on = current === name
          return (
            <button
              key={name}
              type="button"
              aria-pressed={on}
              onClick={() => setAuthor(name)}
              className={`min-h-11 rounded-md text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-blue-700/50 ${
                compact ? 'min-w-11 px-2' : 'min-w-14 px-3'
              } ${on ? 'bg-blue-900 text-white' : 'text-stone-700 hover:bg-stone-100'}`}
            >
              {name}
            </button>
          )
        })}
      </div>
      {state === null && <AuthorPrompt />}
    </>
  )
}

function AuthorPrompt() {
  const titleId = useId()
  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      data-testid="author-prompt"
      className="fixed inset-x-4 bottom-4 z-40 rounded-2xl border border-stone-200 bg-white p-4 shadow-xl sm:inset-x-auto sm:right-4 sm:w-80"
    >
      <h2 id={titleId} className="text-base font-semibold text-stone-900">
        Who is using this device?
      </h2>
      <p className="mt-1 text-sm text-stone-600">Changes you make are marked with your name. You can switch at the top.</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {authors.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setAuthor(name)}
            className="min-h-11 rounded-lg bg-blue-900 px-4 text-sm font-medium text-white outline-none hover:bg-blue-800 focus-visible:ring-2 focus-visible:ring-blue-700/50 focus-visible:ring-offset-1"
          >
            {name}
          </button>
        ))}
      </div>
    </div>
  )
}
