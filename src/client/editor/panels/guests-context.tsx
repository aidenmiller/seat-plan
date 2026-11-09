'use client'

/**
 * The wedding's guests and groups inside the editor, for the Guests tab (and
 * the seating tools of milestone 5). The page loads them on the server; the
 * editor fetches them again once on mount, since browser Back and Forward
 * show the page from Next's client cache with the lists of the first visit,
 * and again whenever the tab regains focus, so a guest added on the Guests
 * page in another tab shows up here.
 */
import { createContext, useContext, useEffect, useState } from 'react'
import { listGroups, listGuests } from '@/client/api'
import type { Group, Guest } from '@/shared/api'

export type EditorGuests = {
  weddingId: string
  guests: readonly Guest[]
  groups: readonly Group[]
}

const EditorGuestsContext = createContext<EditorGuests>({ weddingId: '', guests: [], groups: [] })

export const EditorGuestsProvider = EditorGuestsContext.Provider

export function useEditorGuests(): EditorGuests {
  return useContext(EditorGuestsContext)
}

export type GuestListDeps = {
  load?: (weddingId: string) => Promise<{ guests: Guest[]; groups: Group[] }>
  windowTarget?: EventTarget | null
  documentTarget?: (EventTarget & { visibilityState?: string }) | null
}

const loadBoth = async (weddingId: string) => {
  const [guests, groups] = await Promise.all([listGuests(weddingId), listGroups(weddingId)])
  return { guests, groups }
}

/**
 * Calls `refresh` now (unless `now` is false), and again when the page comes
 * back into view or the window regains focus, at most one load at a time.
 * Returns the cleanup.
 */
export function refreshOnFocus(
  refresh: () => Promise<void>,
  deps: Pick<GuestListDeps, 'windowTarget' | 'documentTarget'> & { now?: boolean } = {},
): () => void {
  const win = deps.windowTarget !== undefined ? deps.windowTarget : typeof window === 'undefined' ? null : window
  const doc = deps.documentTarget !== undefined ? deps.documentTarget : typeof document === 'undefined' ? null : document
  let running = false
  const run = () => {
    if (running || doc?.visibilityState === 'hidden') return
    running = true
    refresh().finally(() => {
      running = false
    })
  }
  const onVisibility = () => {
    if (doc?.visibilityState === 'visible') run()
  }
  win?.addEventListener('focus', run)
  doc?.addEventListener('visibilitychange', onVisibility)
  if (deps.now !== false) run()
  return () => {
    win?.removeEventListener('focus', run)
    doc?.removeEventListener('visibilitychange', onVisibility)
  }
}

/** The guest list for the editor: the page's copy first, then a fresh copy on mount and on focus. */
export function useEditorGuestList(weddingId: string, guests: Guest[], groups: Group[], deps: GuestListDeps = {}): EditorGuests {
  const [state, setState] = useState(() => ({ guests, groups, fromGuests: guests, fromGroups: groups }))
  if (state.fromGuests !== guests || state.fromGroups !== groups) setState({ guests, groups, fromGuests: guests, fromGroups: groups })
  const { load = loadBoth, windowTarget, documentTarget } = deps

  useEffect(() => {
    let live = true
    const refresh = async () => {
      try {
        const next = await load(weddingId)
        if (live) setState((s) => ({ ...s, guests: next.guests, groups: next.groups }))
      } catch {
        // Keep the list shown; the next focus tries again.
      }
    }
    const stop = refreshOnFocus(refresh, { windowTarget, documentTarget })
    return () => {
      live = false
      stop()
    }
  }, [weddingId, load, windowTarget, documentTarget])

  return { weddingId, guests: state.guests, groups: state.groups }
}
