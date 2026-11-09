'use client'

import { useSyncExternalStore } from 'react'

/** Below this width the guest table turns into cards (Tailwind's md breakpoint). */
export const NARROW_QUERY = '(max-width: 767.98px)'

function subscribe(listener: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined
  const query = window.matchMedia(NARROW_QUERY)
  query.addEventListener?.('change', listener)
  return () => query.removeEventListener?.('change', listener)
}

const snapshot = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(NARROW_QUERY).matches : false)
const serverSnapshot = () => false

/**
 * True on a narrow screen (a phone held upright). The server render and
 * hydration use the wide layout; the page switches right after.
 */
export function useNarrowScreen(): boolean {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot)
}
