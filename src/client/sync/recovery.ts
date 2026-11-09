/**
 * What to do with drafts left by closed tabs when a layout opens (PLAN
 * section 5, "Opening a layout"). decideRecovery and pickRecovery are pure;
 * findOrphanDrafts reads storage through the deps it is given.
 *
 * The editor, on opening a layout, before it creates the saver:
 * 1. claimTab() for this tab's id and lock.
 * 2. Load the layout (canvas, version, lastSaveId, recentSaveIds).
 * 3. findOrphanDrafts(layoutId, { drafts, isTabAlive, ownTabId }) and
 *    pickRecovery(server, orphans, { ownTabId }).
 * 4. Delete every draft in plan.discard, and move plan.moveAside (this tab's
 *    own older draft) to a fresh key, since the saver writes under this tab's key.
 * 5. For plan.next 'apply': create the saver with baseVersion = decision.baseVersion,
 *    show decision.canvas and call saver.noteEdit(decision.canvas); once the
 *    saver confirms its first save, delete the orphan draft if its tabId is not this tab's.
 *    For 'conflict': show the conflict dialog with decision.canvas as "mine",
 *    and delete the orphan draft once the person has chosen.
 */
import type { Canvas } from '@/domain/canvas-schema'
import type { DraftSnapshot, DraftStore } from './types'

export type ServerState = {
  version: number
  lastSaveId: string | null
  /**
   * The ids of the most recent saves that landed, newest first. A draft's
   * in-flight save can have landed even when someone saved after it.
   */
  recentSaveIds?: readonly string[]
  /**
   * The server's canvas, when known. A draft that already matches it holds
   * nothing unsaved, even if the draft never heard back about its save.
   */
  canvas?: Canvas
}

export type RecoveryDecision =
  /** Nothing in the draft is missing from the server: delete it. */
  | 'discard'
  /** Load the draft's canvas into the editor and save it, starting from baseVersion. */
  | { kind: 'apply'; canvas: Canvas; baseVersion: number }
  /**
   * The server moved on without this draft: show the conflict dialog with the
   * draft as "mine". partlySaved: the draft's in-flight save landed, so only
   * the edits made after it are missing from the server.
   */
  | { kind: 'conflict'; canvas: Canvas; partlySaved: boolean }

/**
 * Deep equality for JSON values, ignoring key order (Postgres jsonb sorts
 * keys) and keys whose value is undefined (JSON drops them).
 */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, i) => jsonEqual(value, b[i]))
  }
  const ra = a as Record<string, unknown>
  const rb = b as Record<string, unknown>
  const ka = Object.keys(ra).filter((k) => ra[k] !== undefined)
  const kb = Object.keys(rb).filter((k) => rb[k] !== undefined)
  return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(rb, k) && jsonEqual(ra[k], rb[k]))
}

/** Same canvas content (drafts lose shared references once stored). */
export function sameCanvas(a: Canvas, b: Canvas): boolean {
  return jsonEqual(a, b)
}

/** True when the draft's in-flight save is among the saves the server has. */
export function inFlightLanded(server: ServerState, draft: DraftSnapshot): boolean {
  const saveId = draft.inFlight?.saveId
  if (!saveId) return false
  return server.lastSaveId === saveId || (server.recentSaveIds ?? []).includes(saveId)
}

export function decideRecovery(server: ServerState, draft: DraftSnapshot): RecoveryDecision {
  if (server.canvas && sameCanvas(server.canvas, draft.canvas)) return 'discard'

  const inFlight = draft.inFlight
  if (inFlight && inFlightLanded(server, draft)) {
    // The save that was in flight landed. Nothing after it: nothing is missing.
    if (sameCanvas(inFlight.canvas, draft.canvas)) return 'discard'
    // The server has not moved since: send the later edits on top of it.
    if (server.lastSaveId === inFlight.saveId) return { kind: 'apply', canvas: draft.canvas, baseVersion: server.version }
    // Someone saved after it: only the later edits are in question.
    return { kind: 'conflict', canvas: draft.canvas, partlySaved: true }
  }

  if (!draft.dirty && !inFlight) return 'discard'

  // While a save is in flight the draft's base is the version that save started from.
  const base = inFlight ? inFlight.baseVersion : draft.baseVersion
  if (base === server.version) return { kind: 'apply', canvas: draft.canvas, baseVersion: server.version }
  return { kind: 'conflict', canvas: draft.canvas, partlySaved: false }
}

export type RecoveryPlan = {
  /** Drafts holding nothing unsaved. Delete them. */
  discard: DraftSnapshot[]
  /**
   * The draft to act on now (the newest one that holds something), with its
   * decision. Delete that draft once the editor has taken its canvas over
   * (after the saver's first noteEdit, or after the conflict dialog).
   */
  next: { draft: DraftSnapshot; decision: Exclude<RecoveryDecision, 'discard'> } | null
  /** Older drafts that also hold something. Left for the next time the layout opens. */
  later: DraftSnapshot[]
  /**
   * This tab's own draft (from before a reload) when it is in `later`. The
   * saver writes under this tab's key, which would wipe it, so move it to a
   * fresh key first; it then shows up again the next time the layout opens.
   */
  moveAside: DraftSnapshot | null
}

export type PickRecoveryOptions = {
  /** This tab's id: its draft lives under the key the saver is about to use. */
  ownTabId?: string
}

/** Decide every orphan draft at once. `drafts` should be newest first, as findOrphanDrafts returns them. */
export function pickRecovery(
  server: ServerState,
  drafts: DraftSnapshot[],
  options: PickRecoveryOptions = {},
): RecoveryPlan {
  const plan: RecoveryPlan = { discard: [], next: null, later: [], moveAside: null }
  const ordered = [...drafts].sort((x, y) => (x.updatedAt < y.updatedAt ? 1 : x.updatedAt > y.updatedAt ? -1 : 0))
  for (const draft of ordered) {
    const decision = decideRecovery(server, draft)
    if (decision === 'discard') plan.discard.push(draft)
    else if (!plan.next) plan.next = { draft, decision }
    else plan.later.push(draft)
  }
  if (options.ownTabId !== undefined) {
    plan.moveAside = plan.later.find((draft) => draft.tabId === options.ownTabId) ?? null
  }
  return plan
}

export type OrphanDeps = {
  drafts: Pick<DraftStore, 'listDrafts'>
  isTabAlive: (tabId: string) => Promise<boolean>
  /**
   * This tab's id. Its own draft comes from an earlier page in this tab (a
   * reload), so it counts as an orphan even though this page holds the lock now.
   */
  ownTabId?: string
}

/** Drafts of this layout whose tab is closed (its lock is free), newest first. */
export async function findOrphanDrafts(layoutId: string, deps: OrphanDeps): Promise<DraftSnapshot[]> {
  const drafts = await deps.drafts.listDrafts(layoutId)
  const alive = await Promise.all(
    drafts.map((d) => (d.tabId === deps.ownTabId ? Promise.resolve(false) : deps.isTabAlive(d.tabId))),
  )
  return drafts
    .filter((d, i) => d.layoutId === layoutId && !alive[i])
    .sort((x, y) => (x.updatedAt < y.updatedAt ? 1 : x.updatedAt > y.updatedAt ? -1 : 0))
}
