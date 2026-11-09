/**
 * A shared clock for "5 minutes ago" style text. It ticks every 30 seconds
 * while anything on the page reads it. During server rendering and hydration
 * it reads null, so the server's text and the first client render match.
 */
import { useSyncExternalStore } from 'react'

const TICK_MS = 30_000
const listeners = new Set<() => void>()
let now: number | null = null
let timer: ReturnType<typeof setInterval> | null = null

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (timer === null) {
    now = Date.now()
    timer = setInterval(() => {
      now = Date.now()
      for (const l of [...listeners]) l()
    }, TICK_MS)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer)
      timer = null
      now = null
    }
  }
}

function getSnapshot(): number | null {
  if (now === null) now = Date.now()
  return now
}

function getServerSnapshot(): null {
  return null
}

/** The time in milliseconds, updated every 30 seconds; null until the page has hydrated. */
export function useNow(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
