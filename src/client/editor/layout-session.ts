/**
 * Everything the editor does to keep one open layout in step with the server
 * (PLAN section 5, "Saving layouts"), apart from drawing:
 *
 * 1. Take this tab's id and lock, and fetch the layout fresh (the page may
 *    have come from the router's cache).
 * 2. Pick up drafts left by closed tabs (src/client/sync/recovery.ts): apply
 *    one, drop the ones holding nothing, or report a conflict.
 * 3. Create the save engine and hand it every finished edit.
 * 4. When the tab regains focus and the server has a newer version, load it
 *    quietly if this tab holds nothing unsaved ("Loaded Aiden's changes");
 *    otherwise do nothing and let the next save meet the conflict.
 * 5. On a conflict, "Load their version" or "Keep mine as a new copy".
 * 6. After a 422 or 410, "Save as a copy" stores this tab's canvas as a new
 *    layout.
 *
 * After either copy the page leaves for the copy. Until it has, this session
 * takes no more edits, and this tab shows the server's version with no undo
 * steps, so nothing can carry "mine" back into this layout.
 *
 * Closing (leaving inside the app: the Back button, a swipe back) waits for
 * the save in flight and sends any later edits before stopping the engine and
 * letting the tab lock go. A real page unload is handled by the unload guard
 * (src/client/sync/unload.ts) with a keepalive save.
 *
 * No React here: EditorShell opens a session in an effect and closes it on
 * unmount. Every browser dependency can be swapped for tests.
 */
import { duplicateLayout, getLayout } from '@/client/api'
import { createLayoutSaver } from '@/client/sync/layout-saver'
import { defaultDraftStore } from '@/client/sync/outbox'
import { randomId } from '@/client/sync/random-id'
import { findOrphanDrafts, pickRecovery } from '@/client/sync/recovery'
import { watchRemoteVersion, type RemoteVersionWatch, type WatchRemoteVersionOptions } from '@/client/sync/remote-version'
import { claimTab, isTabAlive } from '@/client/sync/tab-lock'
import type { DraftSnapshot, DraftStore, LayoutSaver, LayoutSaverOptions, SaveStatus } from '@/client/sync/types'
import { asAuthor, type Author, type Canvas } from '@/domain/canvas-schema'
import { loadedChangesMessage } from '@/domain/wording'
import type { DuplicateLayoutBody, LayoutDetail } from '@/shared/api'
import { clearDroppedSeats, type DocStore } from './doc-store'

export type ConflictInfo = {
  /** 'save': a save met a newer version. 'recovery': a closed tab left edits made on an older version. */
  source: 'save' | 'recovery'
  /** For 'recovery': the closed tab's last save landed, so only the edits after it are at stake. */
  partlySaved: boolean
  server: { version: number; editedBy: string | null; updatedAt: string }
  /** For 'recovery', the closed tab's draft, whose canvas is "mine". */
  draft: DraftSnapshot | null
}

export type LayoutSessionEvents = {
  /** The save engine is ready; edits can start. */
  onSaver(saver: LayoutSaver): void
  onStatus(status: SaveStatus): void
  /** A conflict to show, or null once it is settled. */
  onConflict(conflict: ConflictInfo | null): void
  /** "Loaded Aiden's changes". */
  onNotice(text: string): void
  /** The editor now shows this copy from the server (its name may have changed too). */
  onServerCopy?(layout: LayoutDetail): void
  /** The layout or its wedding was deleted. */
  onGone?(): void
}

export type LayoutSessionDeps = {
  claimTab: () => Promise<{ tabId: string; release: () => void }>
  isTabAlive: (tabId: string) => Promise<boolean>
  drafts: DraftStore
  getLayout: (id: string) => Promise<LayoutDetail>
  duplicateLayout: (id: string, body: DuplicateLayoutBody) => Promise<LayoutDetail>
  createSaver: (options: LayoutSaverOptions) => LayoutSaver
  watchRemoteVersion: (options: WatchRemoteVersionOptions) => RemoteVersionWatch
  newId: () => string
}

export type LayoutSession = {
  /** Settles once the layout is open (or the session closed first). */
  ready: Promise<void>
  /** A finished edit: the whole canvas after it. */
  noteEdit(canvas: Canvas): void
  /** Conflict choice: show the server's version and forget this tab's edits. */
  loadTheirs(): Promise<void>
  /**
   * Conflict choice: store "mine" as a new layout and forget it here. Returns
   * the copy to open. From then on this session takes no edits.
   */
  keepMineAsCopy(name: string, author: Author): Promise<LayoutDetail>
  /**
   * After a 422 or 410: store this tab's canvas as a new layout and drop this
   * tab's draft of this one. Returns the copy to open. From then on this
   * session takes no edits.
   */
  saveAsCopy(name: string, author: Author): Promise<LayoutDetail>
  /** Leaving inside the app: send what is waiting, then stop and let the tab lock go. */
  close(): void
}

export type OpenLayoutSessionOptions = {
  layout: LayoutDetail
  store: DocStore
  getAuthor: () => Author | null
  events: LayoutSessionEvents
  deps?: Partial<LayoutSessionDeps>
}

function withDefaults(deps: Partial<LayoutSessionDeps> = {}): LayoutSessionDeps {
  return {
    claimTab: deps.claimTab ?? (() => claimTab()),
    isTabAlive: deps.isTabAlive ?? ((tabId) => isTabAlive(tabId)),
    drafts: deps.drafts ?? defaultDraftStore(),
    getLayout: deps.getLayout ?? getLayout,
    duplicateLayout: deps.duplicateLayout ?? duplicateLayout,
    createSaver: deps.createSaver ?? createLayoutSaver,
    watchRemoteVersion: deps.watchRemoteVersion ?? watchRemoteVersion,
    newId: deps.newId ?? randomId,
  }
}

function isGone(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status
  return status === 404 || status === 410
}

/** The duplicate route's answer when a layout with that id exists already. */
function isIdTaken(error: unknown): boolean {
  const e = error as { status?: unknown; body?: { error?: unknown } | null } | null
  return e?.status === 409 && e.body?.error === 'id_taken'
}

export function openLayoutSession({ layout, store, getAuthor, events, deps }: OpenLayoutSessionOptions): LayoutSession {
  const d = withDefaults(deps)
  const layoutId = layout.id
  let closed = false
  let tabId: string | null = null
  let release: (() => void) | null = null
  let saver: LayoutSaver | null = null
  let watch: RemoteVersionWatch | null = null
  let conflict: ConflictInfo | null = null
  /** One id per conflict, so a retried "Keep mine" after a lost reply finds the same copy. */
  let copyId: string | null = null
  /** The same for "Save as a copy". */
  let failedCopyId: string | null = null
  /** A copy was made and the page is about to open it: no edit may reach this layout any more. */
  let leaving = false
  /** Whose name saves carry if nobody has picked on this device yet (a recovered draft's, or the last editor's). */
  let fallbackAuthor: Author = asAuthor(layout.editedBy) ?? 'Noa'
  const editedBy = () => getAuthor() ?? fallbackAuthor

  function setConflict(next: ConflictInfo | null) {
    conflict = next
    copyId = next ? d.newId() : null
    events.onConflict(next)
  }

  async function start(): Promise<void> {
    const claim = await d.claimTab()
    if (closed) {
      claim.release()
      return
    }
    tabId = claim.tabId
    release = claim.release

    let server: LayoutDetail = layout
    try {
      const fresh = await d.getLayout(layoutId)
      if (closed) return
      if (fresh.version !== layout.version) {
        store.replace(fresh.canvas)
        events.onServerCopy?.(fresh)
      }
      server = fresh
    } catch (error) {
      if (closed) return
      // Offline or slow: go on with the page's copy; the first save tells if it is stale.
      if (isGone(error)) events.onGone?.()
    }

    const orphans = await findOrphanDrafts(layoutId, { drafts: d.drafts, isTabAlive: d.isTabAlive, ownTabId: tabId })
    if (closed) return
    const plan = pickRecovery(
      {
        version: server.version,
        lastSaveId: server.lastSaveId,
        recentSaveIds: server.recentSaveIds ?? [],
        canvas: server.canvas,
      },
      orphans,
      { ownTabId: tabId },
    )
    await Promise.all(plan.discard.map((draft) => d.drafts.deleteDraft(draft.layoutId, draft.tabId)))
    if (closed) return
    if (plan.moveAside) {
      // This tab's own draft from before a reload, older than the one acted on
      // now. The saver writes under this tab's key, so keep the draft under a
      // fresh one; the next open finds it (as a conflict, if the server moved on).
      const own = plan.moveAside
      if (await d.drafts.putDraft({ ...own, tabId: d.newId() })) await d.drafts.deleteDraft(own.layoutId, own.tabId)
      if (closed) return
    }

    const next = plan.next
    // A draft saved under another name falls back to the one already in hand: the save request takes only Noa or Aiden.
    if (next) fallbackAuthor = asAuthor(next.draft.editedBy) ?? fallbackAuthor
    const baseVersion = next?.decision.kind === 'apply' ? next.decision.baseVersion : server.version
    const ownTab = tabId
    saver = d.createSaver({
      layoutId,
      tabId: ownTab,
      baseVersion,
      editedBy,
      onStatus(status) {
        events.onStatus(status)
        if (status.kind === 'conflict' && conflict?.source !== 'save') {
          setConflict({
            source: 'save',
            partlySaved: false,
            server: { version: status.server.version, editedBy: status.server.editedBy, updatedAt: status.server.updatedAt },
            draft: null,
          })
        }
      },
      onDroppedSeats(dropped) {
        // The server already emptied these seats; do the same on screen, outside
        // undo, through the editor's document so a drag under way keeps going.
        store.patchFromServer((canvas) => clearDroppedSeats(canvas, dropped))
      },
    })
    events.onStatus(saver.getStatus())

    const active = saver
    if (next?.decision.kind === 'apply') {
      store.replace(next.decision.canvas)
      active.noteEdit(next.decision.canvas)
      if (next.draft.tabId !== ownTab) {
        // The closed tab's draft stays until the server confirms a save: if this
        // tab's own draft write fails and the tab dies, it is the only copy.
        const orphan = next.draft
        const stop = active.subscribe(() => {
          if (active.getStatus().kind !== 'saved' || active.hasUnsavedChanges()) return
          stop()
          void d.drafts.deleteDraft(orphan.layoutId, orphan.tabId)
        })
      }
    } else if (next?.decision.kind === 'conflict') {
      setConflict({
        source: 'recovery',
        partlySaved: next.decision.partlySaved,
        server: { version: server.version, editedBy: server.editedBy, updatedAt: server.updatedAt },
        draft: next.draft,
      })
    }

    watch = d.watchRemoteVersion({
      layoutId,
      currentVersion: () => active.getBaseVersion(),
      onChange: () => void loadNewer(),
      onGone: () => events.onGone?.(),
    })
    events.onSaver(active)
  }

  /** Nothing unsaved here and no question open: show the newer version from the server. */
  function quiet(): boolean {
    if (closed || leaving || !saver || conflict) return false
    const kind = saver.getStatus().kind
    return !saver.hasUnsavedChanges() && kind !== 'failed' && kind !== 'conflict'
  }

  async function loadNewer(): Promise<void> {
    if (!quiet()) return
    let fresh: LayoutDetail
    try {
      fresh = await d.getLayout(layoutId)
    } catch (error) {
      if (isGone(error)) events.onGone?.()
      return
    }
    // The person may have made an edit while the request was out.
    if (!quiet() || !saver || fresh.version <= saver.getBaseVersion()) return
    store.replace(fresh.canvas)
    await saver.resetTo(fresh.version)
    if (closed) return
    events.onServerCopy?.(fresh)
    events.onNotice(loadedChangesMessage(fresh.editedBy, getAuthor()))
  }

  async function forgetDraft(draft: DraftSnapshot | null): Promise<void> {
    // This tab's own draft goes with saver.resetTo(); a closed tab's is deleted here.
    if (draft && draft.tabId !== tabId) await d.drafts.deleteDraft(draft.layoutId, draft.tabId)
  }

  /** Make a copy with a chosen id. A retry after a lost reply finds the copy the first try made. */
  async function duplicateAs(id: string, body: Omit<DuplicateLayoutBody, 'id'>): Promise<LayoutDetail> {
    try {
      return await d.duplicateLayout(layoutId, { id, ...body })
    } catch (error) {
      if (!isIdTaken(error)) throw error
      return d.getLayout(id)
    }
  }

  /**
   * "Mine" lives in a copy now: show the server's version of this layout,
   * with no undo steps, and start the saver from it. The store is replaced
   * before the saver resets, so no step in between can send "mine" here.
   */
  async function showServerVersion(settled: ConflictInfo | null): Promise<void> {
    let fresh: LayoutDetail | null = null
    try {
      fresh = await d.getLayout(layoutId)
    } catch {
      // The page is leaving anyway; edits are refused from here on.
    }
    store.replace(fresh ? fresh.canvas : store.getState().canvas)
    if (!saver) return
    const version = fresh?.version ?? Math.max(settled?.server.version ?? 0, saver.getBaseVersion())
    await saver.resetTo(version)
    if (fresh && !closed) events.onServerCopy?.(fresh)
  }

  const ready = start().catch(() => {
    // claimTab and the draft store never throw; a broken fetch above is already handled.
  })

  return {
    ready,

    noteEdit(canvas) {
      if (closed || leaving) return
      saver?.noteEdit(canvas)
    },

    async loadTheirs() {
      const settled = conflict
      const fresh = await d.getLayout(layoutId)
      if (closed) return
      store.replace(fresh.canvas)
      if (saver) await saver.resetTo(fresh.version)
      await forgetDraft(settled?.draft ?? null)
      if (closed) return
      events.onServerCopy?.(fresh)
      setConflict(null)
    },

    async keepMineAsCopy(name, author) {
      const settled = conflict
      const mine = settled?.source === 'recovery' && settled.draft ? settled.draft.canvas : store.getState().canvas
      copyId ??= d.newId()
      const copy = await duplicateAs(copyId, { name, canvas: mine, editedBy: author })
      leaving = true
      await showServerVersion(settled)
      await forgetDraft(settled?.draft ?? null)
      if (!closed) setConflict(null)
      return copy
    },

    async saveAsCopy(name, author) {
      failedCopyId ??= d.newId()
      const copy = await duplicateAs(failedCopyId, { name, canvas: store.getState().canvas, editedBy: author })
      leaving = true
      // This layout can no longer take these edits; the copy holds them now.
      if (saver) {
        saver.dispose()
        await saver.whenStored()
      }
      if (tabId) await d.drafts.deleteDraft(layoutId, tabId)
      return copy
    },

    close() {
      if (closed) return
      closed = true
      watch?.stop()
      const active = saver
      const letGo = () => {
        active?.dispose()
        release?.()
      }
      // Leaving inside the app: the page stays alive, so wait for the save in
      // flight, send what came after it, and only then stop. The tab lock is
      // held until then, so no other page takes this tab's draft meanwhile.
      if (active && !leaving && active.hasUnsavedChanges()) void active.flush().then(letGo, letGo)
      else letGo()
    },
  }
}
