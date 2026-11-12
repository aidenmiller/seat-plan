/**
 * Signing out on purpose (the user menu's Log out, and the invite page's Sign
 * out). On a shared device the next person must find nothing of this one's,
 * so in order:
 *
 *  1. Send what every save engine holds, in this tab and this person's other
 *     tabs, waiting up to 3 seconds. This tab also starts this person's guest
 *     and group queue, which takes over and sends the edits closed tabs left.
 *  2. Read this person's databases: drafts and queued edits no live saver
 *     holds (a closed, crashed or frozen tab's, a failed save's, ones moved
 *     in from before accounts) are only there, and step 4 deletes them. A
 *     layout draft cannot be sent without its editor open (recovery and the
 *     conflict dialog live there), so it is counted, not sent.
 *  3. If anything is still unsaved, or might be (a page that did not finish,
 *     a database that cannot be read), ask: "Some changes are not saved yet."
 *     with what is stored ("Changes to 2 layouts and 3 guests are kept only
 *     on this device…"). No: nothing more happens.
 *  4. End the session (POST /api/auth/logout). If that fails (no
 *     connection), stop here: nothing is deleted while still signed in.
 *  5. Stop this tab's savers, then delete this person's IndexedDB databases
 *     (their drafts and queued guest edits) and the editor's clipboard, and
 *     the old Noa / Aiden choice.
 *  6. Tell this person's other tabs, which stop and go to the sign-in page.
 *  7. Leave: the sign-in page (the invite page loads itself again), loaded
 *     afresh so nothing of this page lives on.
 *
 * Device preferences (camera, Edit or View, wheel, venue unit) stay. A
 * session that runs out is not a sign-out: nothing is deleted then, and the
 * edits are sent once the same person signs in again.
 */
import { flushOtherTabs, postAuthMessage, type AuthMessage } from './auth-channel'
import { appFetch, isStalePage } from './http'
import { deleteDatabase } from './sync/idb'
import { rowSaverFor } from './sync/row-save'
import { flushAll, markLeavingForSignOut, stopAll } from './sync/saver-registry'
import { CLIPBOARD_STORAGE_KEY, draftDbName, LEGACY_AUTHOR_KEY, rowDbName } from './sync/storage-names'
import { unsentOnDevice, type UnsentOnDevice } from './sync/unsent'

/** The question when a page holds edits not saved yet and none are stored, or what is stored cannot be read. */
export const UNSAVED_QUESTION = 'Some changes are not saved yet. Sign out anyway?'
export const SIGN_OUT_FAILED = 'Could not sign out. Check your connection and try again.'

/** 'other-user': someone else signed in on this browser since this page opened; nothing was ended or deleted. */
export type SignOutResult = 'signed-out' | 'cancelled' | 'failed' | 'other-user'

export type SignOutDeps = {
  /** Starts this person's guest and group queue in this page, which takes over and sends the edits closed tabs left (row-save.ts). */
  sendStoredRows: (userId: string) => void
  /** Sends what this tab's savers hold (saver-registry.ts). */
  flushHere: (waitMs: number) => Promise<{ unsaved: boolean }>
  /** Asks this person's other tabs to do the same (auth-channel.ts). */
  flushOtherTabs: (userId: string, waitMs: number) => Promise<{ unsaved: boolean }>
  /** What this person's databases still hold unsent, after the flushes (sync/unsent.ts). Rejects when it cannot tell. */
  inspectStored: (userId: string) => Promise<UnsentOnDevice>
  confirm: (question: string) => boolean | Promise<boolean>
  /** Ends the session. */
  logout: () => Promise<Response>
  /** Stops this tab's savers, waiting for their storage writes. */
  stopSavers: () => Promise<void>
  /** Deletes what this person keeps in the browser. */
  wipe: (userId: string) => Promise<void>
  broadcast: (message: AuthMessage) => void
  /** Leaves for the sign-in page. */
  leave: () => void
}

/** How long sign-out waits for the save engines. */
export const FLUSH_WAIT_MS = 3000

export async function signOut(userId: string, deps: SignOutDeps = browserSignOutDeps()): Promise<SignOutResult> {
  try {
    deps.sendStoredRows(userId)
  } catch {
    // Whatever it could not take over is still stored, and counted below.
  }
  const [here, elsewhere] = await Promise.all([
    deps.flushHere(FLUSH_WAIT_MS).catch(() => ({ unsaved: true })),
    deps.flushOtherTabs(userId, FLUSH_WAIT_MS).catch(() => ({ unsaved: true })),
  ])
  // Read after the flushes, so what they just sent is gone from storage. Null: it cannot tell.
  const stored = await deps.inspectStored(userId).catch(() => null)
  const question = unsavedQuestion({ live: here.unsaved || elsewhere.unsaved }, stored)
  if (question && !(await deps.confirm(question))) return 'cancelled'

  let res: Response
  try {
    res = await deps.logout()
  } catch {
    return 'failed'
  }
  if (res.status === 401) {
    const body: unknown = await res.json().catch(() => null)
    // Someone else is signed in on this browser now: their session is not this page's to end, and this person's edits stay.
    if (isStalePage(res.status, body)) return 'other-user'
    // Otherwise the session had already ended, so this browser is signed out either way.
  } else if (!res.ok) {
    return 'failed'
  }

  await deps.stopSavers().catch(() => undefined)
  await deps.wipe(userId).catch(() => undefined)
  deps.broadcast({ type: 'signed-out', userId })
  deps.leave()
  return 'signed-out'
}

function counted(n: number, one: string, many: string): string | null {
  return n === 0 ? null : `${n} ${n === 1 ? one : many}`
}

/**
 * What to ask before signing out, or null when nothing is unsent anywhere.
 * `live`: a page (this one or another tab) holds edits it could not send, or
 * did not finish. `stored`: what this person's databases hold unsent, or
 * null when they could not be read (then it may be anything).
 */
export function unsavedQuestion({ live }: { live: boolean }, stored: UnsentOnDevice | null): string | null {
  if (!stored) return UNSAVED_QUESTION
  const parts = [counted(stored.layouts, 'layout', 'layouts'), counted(stored.guests, 'guest', 'guests'), counted(stored.groups, 'group', 'groups')].filter(
    (part): part is string => part !== null,
  )
  if (parts.length === 0) return live ? UNSAVED_QUESTION : null
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
  const toSave =
    stored.layouts === 0 ? 'try again later' : stored.layouts === 1 ? 'open the layout again' : 'open those layouts again'
  return `Some changes are not saved yet. Changes to ${list} are kept only on this device, and signing out deletes them. To save them first, cancel and ${toSave}. Sign out anyway?`
}

/** Deletes this person's databases and the editor's clipboard. Never throws; a database another tab holds open goes once it lets go. */
export async function wipeUserStorage(userId: string): Promise<void> {
  await Promise.all([deleteDatabase(draftDbName(userId)), deleteDatabase(rowDbName(userId))])
  for (const key of [CLIPBOARD_STORAGE_KEY, LEGACY_AUTHOR_KEY]) {
    try {
      window.localStorage.removeItem(key)
    } catch {
      // Storage blocked: nothing was kept there either.
    }
  }
}

/** Leaves for the sign-in page with a full load, so no save engine or user of this page lives on. */
export function goToSignIn(): void {
  markLeavingForSignOut()
  window.location.replace('/login')
}

export function browserSignOutDeps(): SignOutDeps {
  return {
    sendStoredRows: (userId) => void rowSaverFor(userId),
    flushHere: (waitMs) => flushAll(waitMs),
    flushOtherTabs: (userId, waitMs) => flushOtherTabs(userId, { waitMs }),
    inspectStored: unsentOnDevice,
    confirm: (question) => window.confirm(question),
    logout: () => appFetch('/api/auth/logout', { method: 'POST', cache: 'no-store' }),
    stopSavers: () => stopAll(),
    wipe: wipeUserStorage,
    broadcast: (message) => postAuthMessage(message),
    leave: goToSignIn,
  }
}
