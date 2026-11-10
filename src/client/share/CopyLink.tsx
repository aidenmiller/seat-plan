'use client'

import { useState, useSyncExternalStore } from 'react'
import { secondaryButton } from '@/client/ui/styles'

/** The link's full address, from its path on this site. */
export function shareUrl(path: string): string {
  return typeof window === 'undefined' ? path : `${window.location.origin}${path}`
}

const noSubscribe = () => () => {}

/** The full address once in the browser; the path alone while the server renders, so hydration matches. */
function useShareUrl(path: string): string {
  const origin = useSyncExternalStore(
    noSubscribe,
    () => window.location.origin,
    () => '',
  )
  return `${origin}${path}`
}

/**
 * A Copy link button. Where the clipboard is not allowed, it says so and the
 * address stays in view (the caller shows it) to copy by hand.
 */
export function CopyLinkButton({ path, testId }: { path: string; testId?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  async function copy() {
    try {
      await navigator.clipboard.writeText(shareUrl(path))
      setState('copied')
    } catch {
      setState('failed')
    }
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" className={secondaryButton} onClick={() => void copy()} data-testid={testId}>
        {state === 'copied' ? 'Copied' : 'Copy link'}
      </button>
      {state === 'failed' && (
        <span role="status" className="text-sm text-stone-600">
          Copy it by hand from the box.
        </span>
      )}
    </span>
  )
}

/** The link's address in a read-only box that selects itself on focus. */
export function LinkBox({ path, label = 'Link' }: { path: string; label?: string }) {
  const url = useShareUrl(path)
  return (
    <input
      readOnly
      aria-label={label}
      value={url}
      onFocus={(e) => e.currentTarget.select()}
      className="block h-11 w-full min-w-0 rounded-lg border border-stone-300 bg-stone-50 px-3 text-base text-stone-800"
      data-testid="share-url"
    />
  )
}
