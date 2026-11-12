'use client'

/**
 * React access to the page's row queue (src/client/sync/row-save.ts): the
 * queue of the user the page was rendered for. The queue is made on the
 * client only, on first use: the server render and hydration see an empty,
 * saved queue, so the first paint matches.
 */
import { useEffect, useSyncExternalStore } from 'react'
import { pageRowSaver, type RowSaveEvent, type RowSaveStatus, type RowSaver } from '@/client/sync/row-save'
import { installUnloadGuard } from '@/client/sync/unload'

const subscribe = (listener: () => void) => pageRowSaver().subscribe(listener)
const clientRevision = () => pageRowSaver().revision()
/** -1: the server render and hydration, where nothing is queued yet. */
const serverRevision = () => -1

/** The queue's revision: re-renders the caller on every change. -1 until the page has hydrated. */
export function useRowSaverRevision(): number {
  return useSyncExternalStore(subscribe, clientRevision, serverRevision)
}

/** The queue, or null during the server render and hydration. */
export function useRowSaver(): RowSaver | null {
  return useRowSaverRevision() < 0 ? null : pageRowSaver()
}

/** "Saving…", "Saved", "Not saved, retrying" or "Not saved: someone else signed in" for the page header; null before hydration. */
export function useRowSaveStatus(): RowSaveStatus | null {
  const saver = useRowSaver()
  return saver ? saver.getStatus() : null
}

/** Hears each saved or refused edit while the caller is mounted. */
export function useRowSaveEvents(listener: (event: RowSaveEvent) => void): void {
  useEffect(() => pageRowSaver().onEvent(listener), [listener])
}

/** Warns before closing while row edits are unsent, and sends them when the page hides. */
export function useRowUnloadGuard(): void {
  useEffect(() => installUnloadGuard(pageRowSaver()), [])
}
