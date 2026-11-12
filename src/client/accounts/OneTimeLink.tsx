'use client'

import { useState, useSyncExternalStore, type ReactNode } from 'react'
import { secondaryButton } from '@/client/ui/styles'

const noSubscribe = () => () => {}

/** This site's address, from the browser; empty while the server renders, so hydration matches. */
function useOrigin(): string {
  return useSyncExternalStore(
    noSubscribe,
    () => window.location.origin,
    () => '',
  )
}

/**
 * A new invite or reset link, shown once: the server keeps only a hash of its
 * token, so this is the only time anyone can see it. The full address in a
 * read-only box that selects itself on focus, a Copy link button, and a line
 * saying what to do with it. Where the clipboard is not allowed, it says so
 * and the box stays in view to copy by hand.
 */
export function OneTimeLink({ path, label, children }: { path: string; label: string; children: ReactNode }) {
  const url = `${useOrigin()}${path}`
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setState('copied')
    } catch {
      setState('failed')
    }
  }

  return (
    <div className="space-y-3" data-testid="one-time-link">
      <p className="text-sm text-stone-700">{children}</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          readOnly
          aria-label={label}
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="block h-11 w-full min-w-0 flex-1 rounded-lg border border-stone-300 bg-stone-50 px-3 text-base text-stone-800"
          data-testid="one-time-link-url"
        />
        <button type="button" className={secondaryButton} onClick={() => void copy()}>
          {state === 'copied' ? 'Copied' : 'Copy link'}
        </button>
      </div>
      {state === 'failed' && (
        <p role="status" className="text-sm text-stone-600">
          Copy it by hand from the box.
        </p>
      )}
    </div>
  )
}
