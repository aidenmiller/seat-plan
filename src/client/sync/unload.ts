/**
 * Closing the tab (PLAN section 5, "Closing the tab"): warn while anything is
 * unsaved, and try one last save when the page hides. The beforeunload
 * listener is attached only while there are unsaved changes, since a page
 * with one attached can be kept out of the browser's back-forward cache.
 * iPhone Safari never shows the warning; the draft in IndexedDB covers it.
 */
import { useEffect } from 'react'
import type { LayoutSaver } from './types'

export type UnloadGuardSaver = Pick<LayoutSaver, 'hasUnsavedChanges' | 'flush' | 'subscribe'>

export type UnloadGuardDeps = {
  /** Receives 'beforeunload' and 'pagehide'. Defaults to window. */
  windowTarget?: EventTarget | null
  /** Receives 'visibilitychange'. Defaults to document. */
  documentTarget?: (EventTarget & { visibilityState?: string }) | null
}

/** The guard without React. Returns a function that removes every listener. */
export function installUnloadGuard(saver: UnloadGuardSaver, deps: UnloadGuardDeps = {}): () => void {
  const win = deps.windowTarget !== undefined ? deps.windowTarget : typeof window === 'undefined' ? null : window
  const doc =
    deps.documentTarget !== undefined ? deps.documentTarget : typeof document === 'undefined' ? null : document
  let guarding = false

  const onBeforeUnload = (event: Event) => {
    if (!saver.hasUnsavedChanges()) return
    event.preventDefault()
    // Older browsers show the warning only when returnValue is set.
    ;(event as Event & { returnValue: unknown }).returnValue = true
  }

  const sync = () => {
    const unsaved = saver.hasUnsavedChanges()
    if (unsaved && !guarding) {
      win?.addEventListener('beforeunload', onBeforeUnload)
      guarding = true
    } else if (!unsaved && guarding) {
      win?.removeEventListener('beforeunload', onBeforeUnload)
      guarding = false
    }
  }

  const lastSave = () => {
    if (saver.hasUnsavedChanges()) void saver.flush({ keepalive: true })
  }
  const onVisibility = () => {
    if (doc?.visibilityState === 'hidden') lastSave()
  }

  win?.addEventListener('pagehide', lastSave)
  doc?.addEventListener('visibilitychange', onVisibility)
  const unsubscribe = saver.subscribe(sync)
  sync()

  return () => {
    unsubscribe()
    win?.removeEventListener('pagehide', lastSave)
    doc?.removeEventListener('visibilitychange', onVisibility)
    if (guarding) win?.removeEventListener('beforeunload', onBeforeUnload)
    guarding = false
  }
}

/** Warn before closing while the layout has unsaved changes, and send them when the page hides. */
export function useUnloadGuard(saver: UnloadGuardSaver | null | undefined): void {
  useEffect(() => {
    if (!saver) return
    return installUnloadGuard(saver)
  }, [saver])
}
