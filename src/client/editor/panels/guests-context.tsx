'use client'

/**
 * The wedding's guests, groups and rules inside the editor, for the Guests
 * and Groups tabs, the seating tools and the rules check. The page loads them on the server; the
 * editor fetches them again once on mount, since browser Back and Forward
 * show the page from Next's client cache with the lists of the first visit,
 * and again whenever the tab regains focus, so a guest added on the Guests
 * page in another tab shows up here.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { listGroups, listGuests, listRules } from '@/client/api'
import type { Group, Guest, StoredRule } from '@/shared/api'

export type EditorGuests = {
  weddingId: string
  guests: readonly Guest[]
  groups: readonly Group[]
  /** The wedding's stored rules (couple rules come from partner links). */
  rules?: readonly StoredRule[]
  /** A rule or group the editor just made or changed, shown before the next load. */
  putRule?(rule: StoredRule): void
  putGroup?(group: Group): void
}

const EditorGuestsContext = createContext<EditorGuests>({ weddingId: '', guests: [], groups: [] })

export const EditorGuestsProvider = EditorGuestsContext.Provider

export function useEditorGuests(): EditorGuests {
  return useContext(EditorGuestsContext)
}

export type GuestListDeps = {
  load?: (weddingId: string) => Promise<{ guests: Guest[]; groups: Group[]; rules: StoredRule[] }>
  windowTarget?: EventTarget | null
  documentTarget?: (EventTarget & { visibilityState?: string }) | null
}

const loadAll = async (weddingId: string) => {
  const [guests, groups, rules] = await Promise.all([listGuests(weddingId), listGroups(weddingId), listRules(weddingId)])
  return { guests, groups, rules }
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

const NO_RULES: StoredRule[] = []

function put<T extends { id: string }>(list: readonly T[], next: T): T[] {
  return list.some((x) => x.id === next.id) ? list.map((x) => (x.id === next.id ? next : x)) : [...list, next]
}

/** The guest list for the editor: the page's copy first, then a fresh copy on mount and on focus. */
export function useEditorGuestList(
  weddingId: string,
  guests: Guest[],
  groups: Group[],
  rules: StoredRule[] = NO_RULES,
  deps: GuestListDeps = {},
): EditorGuests & { rules: readonly StoredRule[] } {
  const [state, setState] = useState(() => ({ guests, groups, rules, fromGuests: guests, fromGroups: groups, fromRules: rules }))
  if (state.fromGuests !== guests || state.fromGroups !== groups || state.fromRules !== rules) {
    setState({ guests, groups, rules, fromGuests: guests, fromGroups: groups, fromRules: rules })
  }
  const { load = loadAll, windowTarget, documentTarget } = deps

  useEffect(() => {
    let live = true
    const refresh = async () => {
      try {
        const next = await load(weddingId)
        if (live) setState((s) => ({ ...s, guests: next.guests, groups: next.groups, rules: next.rules }))
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

  const putRule = useCallback((rule: StoredRule) => setState((s) => ({ ...s, rules: put(s.rules, rule) })), [])
  const putGroup = useCallback((group: Group) => setState((s) => ({ ...s, groups: put(s.groups, group) })), [])
  return useMemo(
    () => ({ weddingId, guests: state.guests, groups: state.groups, rules: state.rules, putRule, putGroup }),
    [weddingId, state.guests, state.groups, state.rules, putRule, putGroup],
  )
}
