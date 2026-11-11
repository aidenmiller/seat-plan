/**
 * The layout save engine's public shape (PLAN section 5, "Saving layouts").
 * The editor talks only to this interface; the engine owns IndexedDB, the
 * debounce, retries, the one-save-in-flight rule and conflict detection.
 */
import type { Author, Canvas } from '@/domain/canvas-schema'
import type { DroppedSeat, LayoutVersionInfo } from '@/shared/api'

export type SaveStatus =
  /** Nothing waiting. */
  | { kind: 'saved'; at: string }
  /** Waiting for the debounce, or a request is in flight. */
  | { kind: 'saving' }
  /**
   * The last attempt failed for a reason that may pass; retrying with backoff.
   * storedLocally: false when the last draft write to this device's storage
   * failed, so closing the page now would lose the edit.
   */
  | { kind: 'retrying'; attempt: number; nextTryAt: string; reason: string; storedLocally: boolean }
  /** The browser is offline. storedLocally tells whether the edit is safe in this device's storage. */
  | { kind: 'offline'; storedLocally: boolean }
  /** The other person (or another tab) saved first. The editor shows the dialog. */
  | { kind: 'conflict'; server: LayoutVersionInfo }
  /**
   * Retrying stops. 'invalid': the server will not take this canvas (422).
   * 'gone': the layout or its wedding was deleted (410). 'signed-out': the
   * site cookie expired (401); the draft stays on this device, and the next
   * try after signing in (or the next load) sends it.
   */
  | { kind: 'failed'; reason: 'invalid' | 'gone' | 'signed-out'; message: string }

/**
 * T is the document the engine saves: a layout's canvas by default. The venue
 * template editor saves its fixed items through the same engine (endpoint and
 * body options), and names its own document type.
 */
export type DraftSnapshot<T = Canvas> = {
  layoutId: string
  tabId: string
  /** The version the latest local canvas starts from. */
  baseVersion: number
  canvas: T
  /**
   * Whoever the tab saved as. Any name is kept, not only Noa and Aiden, so a
   * draft written under another name still opens. Save requests accept only the
   * two names for now, so read it through asAuthor() before sending it back.
   */
  editedBy: string
  /** The snapshot and save id currently sent (or about to be resent), if any. */
  inFlight: { saveId: string; baseVersion: number; canvas: T } | null
  /** True while the canvas has edits the server has not confirmed. */
  dirty: boolean
  updatedAt: string
}

/** What one save request carries, for building its body. */
export type SaveRequest<T = Canvas> = {
  baseVersion: number
  saveId: string
  editedBy: Author
  tabId: string
  doc: T
}

/** Sentences the engine reports in statuses; the template editor names its own document. */
export type SaverMessages = {
  gone: string
  invalid: string
  signedOut: string
  network: string
  timeout: string
  unreadable: string
}

export type LayoutSaverOptions<T = Canvas> = {
  layoutId: string
  tabId: string
  /** The server's version and last save id when the editor loaded the layout. */
  baseVersion: number
  editedBy: () => Author
  onStatus: (status: SaveStatus) => void
  /** The server emptied seats (removed guests etc.); apply the same on screen, outside undo. */
  onDroppedSeats: (dropped: DroppedSeat[]) => void
  /** Injected for tests. Defaults to window.fetch. */
  fetch?: typeof fetch
  /** Debounce after the last edit, default 1000 ms; a save goes out at least every maxWaitMs while editing. */
  debounceMs?: number
  maxWaitMs?: number
  /** Where drafts live. Defaults to the IndexedDB outbox (outbox.ts). */
  drafts?: DraftStore<T>
  /** Jitter source for retry delays. Defaults to Math.random. */
  random?: () => number
  /** Defaults to navigator.onLine (true when unknown). */
  isOnline?: () => boolean
  /** Receives 'online' and 'offline'. Defaults to window. */
  windowTarget?: EventTarget | null
  /** Receives 'visibilitychange' and tells whether the page is visible. Defaults to document. */
  documentTarget?: (EventTarget & { visibilityState?: string }) | null
  /** A request that has not answered after this long is dropped and retried. Default 30,000 ms. */
  requestTimeoutMs?: number
  /** Longest wait for the draft write before sending anyway. Default 2,000 ms. */
  draftWaitMs?: number
  /** Where saves go with PUT. Default: /api/layouts/<layoutId>. */
  endpoint?: string
  /** The JSON body of a save. Default: the layout body (SaveLayoutBody). */
  body?: (request: SaveRequest<T>) => unknown
  /** Replaces some of the engine's sentences. */
  messages?: Partial<SaverMessages>
}

/** The IndexedDB outbox, as the save engine sees it (outbox.ts). Errors are reported, never thrown. */
export interface DraftStore<T = Canvas> {
  /** Resolves false when the browser would not store it (private mode, full disk). */
  putDraft(draft: DraftSnapshot<T>): Promise<boolean>
  getDraft(layoutId: string, tabId: string): Promise<DraftSnapshot<T> | null>
  /** Every tab's draft of this layout, newest first. */
  listDrafts(layoutId: string): Promise<DraftSnapshot<T>[]>
  deleteDraft(layoutId: string, tabId: string): Promise<boolean>
}

export type FlushOptions = {
  /**
   * The page is going away: send with fetch keepalive so the request outlives
   * the page. Used only when the body is under 60,000 bytes; browsers refuse
   * larger keepalive requests, and the draft covers that case.
   */
  keepalive?: boolean
}

export interface LayoutSaver<T = Canvas> {
  /** Call after every finished edit with the whole canvas. Writes the draft to IndexedDB at once. */
  noteEdit(canvas: T): void
  /** Send now (used on page hide). Resolves when the attempt settles. */
  flush(options?: FlushOptions): Promise<void>
  /** True while there are edits the server has not confirmed (drives the beforeunload warning). */
  hasUnsavedChanges(): boolean
  /** After "Load their version": forget local edits and start from the server's copy. */
  resetTo(version: number): Promise<void>
  /** Stop timers and listeners. Leaves the draft in IndexedDB if it is still dirty. */
  dispose(): void
  /** The status last reported through onStatus. */
  getStatus(): SaveStatus
  /** The version the next save starts from. */
  getBaseVersion(): number
  /** Called after every status change and every edit. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void
  /** Resolves once every draft write queued so far has finished (or failed). */
  whenStored(): Promise<void>
  /**
   * False when the last draft write to this device's storage failed (private
   * mode, a full disk, a dropped IndexedDB connection). True again once a
   * write succeeds.
   */
  isStoredLocally(): boolean
}
