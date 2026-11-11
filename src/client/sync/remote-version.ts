/**
 * "Other people's changes" (PLAN section 5): when the tab regains focus or
 * becomes visible, ask the server for the layout's version, at most once
 * every 2 seconds, and report it. The editor decides what to do (load their
 * version when it has no unsaved edits and no gesture in progress).
 */
import type { LayoutVersionInfo } from '@/shared/api'
import { appFetch } from '../http'

export type WatchRemoteVersionOptions = {
  layoutId: string
  /** Injected for tests. Defaults to window.fetch. */
  fetch?: typeof fetch
  /** The server's version info, after each check (or only when it differs, with currentVersion). */
  onChange: (info: LayoutVersionInfo) => void
  /** The layout or its wedding was deleted (410 or 404). */
  onGone?: () => void
  /** The version this tab holds. When given, onChange fires only when the server's differs. */
  currentVersion?: () => number
  /** Shortest time between two checks. Default 2,000 ms. */
  minIntervalMs?: number
  /** Receives 'focus'. Defaults to window. */
  windowTarget?: EventTarget | null
  /** Receives 'visibilitychange'. Defaults to document. */
  documentTarget?: (EventTarget & { visibilityState?: string }) | null
}

export type RemoteVersionWatch = {
  /** Check now, unless a check ran in the last 2 seconds or one is still waiting. */
  check(): Promise<void>
  stop(): void
}

export function isLayoutVersionInfo(value: unknown): value is LayoutVersionInfo {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.version === 'number' &&
    typeof v.updatedAt === 'string' &&
    (v.editedBy === null || typeof v.editedBy === 'string') &&
    (v.editedById === null || typeof v.editedById === 'string') &&
    (v.lastSaveId === null || typeof v.lastSaveId === 'string') &&
    Array.isArray(v.recentSaveIds) &&
    v.recentSaveIds.every((id) => typeof id === 'string')
  )
}

/**
 * The reply as LayoutVersionInfo. A server from before recentSaveIds existed
 * (mid-deploy) reads as an empty list, and one from before editedById existed
 * as no id.
 */
export function readLayoutVersionInfo(value: unknown): LayoutVersionInfo | null {
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>
    if (v.recentSaveIds === undefined) value = { ...v, recentSaveIds: [] }
    if (v.editedById === undefined) value = { ...(value as object), editedById: null }
  }
  return isLayoutVersionInfo(value) ? value : null
}

export function watchRemoteVersion(options: WatchRemoteVersionOptions): RemoteVersionWatch {
  const fetchFn: typeof fetch = options.fetch ?? appFetch
  const minIntervalMs = options.minIntervalMs ?? 2000
  const win =
    options.windowTarget !== undefined ? options.windowTarget : typeof window === 'undefined' ? null : window
  const doc =
    options.documentTarget !== undefined
      ? options.documentTarget
      : typeof document === 'undefined'
        ? null
        : document

  let lastCheckAt = Number.NEGATIVE_INFINITY
  let pending: AbortController | null = null
  let stopped = false

  async function check(): Promise<void> {
    if (stopped || pending) return
    const now = Date.now()
    if (now - lastCheckAt < minIntervalMs) return
    lastCheckAt = now
    const controller = new AbortController()
    pending = controller
    try {
      const res = await fetchFn(`/api/layouts/${encodeURIComponent(options.layoutId)}/version`, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal,
      })
      if (stopped) return
      if (res.status === 410 || res.status === 404) {
        options.onGone?.()
        return
      }
      if (!res.ok) return
      const info = readLayoutVersionInfo(await res.json())
      if (stopped || !info) return
      if (options.currentVersion && options.currentVersion() === info.version) return
      options.onChange(info)
    } catch {
      // Offline or a dropped request: the next focus asks again.
    } finally {
      if (pending === controller) pending = null
    }
  }

  const onFocus = () => void check()
  const onVisibility = () => {
    if (doc?.visibilityState !== 'hidden') void check()
  }
  win?.addEventListener('focus', onFocus)
  doc?.addEventListener('visibilitychange', onVisibility)

  return {
    check,
    stop() {
      stopped = true
      pending?.abort()
      pending = null
      win?.removeEventListener('focus', onFocus)
      doc?.removeEventListener('visibilitychange', onVisibility)
    },
  }
}
