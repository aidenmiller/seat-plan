/**
 * Who is using this device: Noa or Aiden (PLAN change 27, DECISIONS 20).
 * Kept in localStorage under 'seat-plan:author' as the plain name, and shared
 * between this device's tabs through the storage event. Saves, new layouts,
 * copies and notes record it.
 */
import { useSyncExternalStore } from 'react'
import { authors, type Author } from '@/domain/canvas-schema'

export const AUTHOR_KEY = 'seat-plan:author'

const listeners = new Set<() => void>()
/** Used when localStorage cannot be written (blocked site data), so the choice lasts for this page at least. */
let memoryValue: Author | null = null
let listeningToStorage = false

function parse(value: string | null): Author | null {
  return value !== null && (authors as readonly string[]).includes(value) ? (value as Author) : null
}

/** This device's author, or null when nobody has chosen yet. Null during server rendering. */
export function getAuthor(): Author | null {
  if (typeof window === 'undefined') return null
  try {
    return parse(window.localStorage.getItem(AUTHOR_KEY)) ?? memoryValue
  } catch {
    return memoryValue
  }
}

export function setAuthor(author: Author): void {
  memoryValue = author
  try {
    window.localStorage.setItem(AUTHOR_KEY, author)
  } catch {
    // Storage blocked: the in-memory value covers this page.
  }
  for (const listener of [...listeners]) listener()
}

function onStorage(event: StorageEvent) {
  if (event.key === null || event.key === AUTHOR_KEY) for (const listener of [...listeners]) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (!listeningToStorage && typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage)
    listeningToStorage = true
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && listeningToStorage) {
      window.removeEventListener('storage', onStorage)
      listeningToStorage = false
    }
  }
}

/** Not known yet: the server render and the first client render, before storage is read. */
const UNKNOWN = 'unknown' as const

function getServerSnapshot(): typeof UNKNOWN {
  return UNKNOWN
}

/**
 * The author, null when nobody has chosen on this device, or 'unknown' while
 * the page is still hydrating (so the "Who is using this device?" prompt
 * never flashes on a device that has already chosen).
 */
export function useAuthorState(): Author | null | typeof UNKNOWN {
  return useSyncExternalStore<Author | null | typeof UNKNOWN>(subscribe, getAuthor, getServerSnapshot)
}

/** The author, or null when nobody has chosen yet (or the page is still hydrating). */
export function useAuthor(): Author | null {
  const state = useAuthorState()
  return state === UNKNOWN ? null : state
}
