/**
 * Signing out on purpose (the user menu's Log out). On a shared device the
 * next person must find nothing of this one's, so in order:
 *
 *  1. Send what every save engine holds, in this tab and this person's other
 *     tabs, waiting up to 3 seconds.
 *  2. If anything is still unsaved, ask "Some changes are not saved yet. Sign
 *     out anyway?" No: nothing more happens.
 *  3. End the session (POST /api/auth/logout). If that fails (no
 *     connection), stop here: nothing is deleted while still signed in.
 *  4. Stop this tab's savers, then delete this person's IndexedDB databases
 *     (their drafts and queued guest edits) and the editor's clipboard, and
 *     the old Noa / Aiden choice.
 *  5. Tell this person's other tabs, which stop and go to the sign-in page.
 *  6. Go to the sign-in page, loading it afresh so nothing of this page lives on.
 *
 * Device preferences (camera, Edit or View, wheel, venue unit) stay. A
 * session that runs out is not a sign-out: nothing is deleted then, and the
 * edits are sent once the same person signs in again.
 */
import { flushOtherTabs, postAuthMessage, type AuthMessage } from './auth-channel'
import { appFetch, isStalePage } from './http'
import { deleteDatabase } from './sync/idb'
import { flushAll, markLeavingForSignOut, stopAll } from './sync/saver-registry'
import { CLIPBOARD_STORAGE_KEY, draftDbName, LEGACY_AUTHOR_KEY, rowDbName } from './sync/storage-names'

export const UNSAVED_QUESTION = 'Some changes are not saved yet. Sign out anyway?'
export const SIGN_OUT_FAILED = 'Could not sign out. Check your connection and try again.'

/** 'other-user': someone else signed in on this browser since this page opened; nothing was ended or deleted. */
export type SignOutResult = 'signed-out' | 'cancelled' | 'failed' | 'other-user'

export type SignOutDeps = {
  /** Sends what this tab's savers hold (saver-registry.ts). */
  flushHere: (waitMs: number) => Promise<{ unsaved: boolean }>
  /** Asks this person's other tabs to do the same (auth-channel.ts). */
  flushOtherTabs: (userId: string, waitMs: number) => Promise<{ unsaved: boolean }>
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
  const [here, elsewhere] = await Promise.all([
    deps.flushHere(FLUSH_WAIT_MS).catch(() => ({ unsaved: true })),
    deps.flushOtherTabs(userId, FLUSH_WAIT_MS).catch(() => ({ unsaved: true })),
  ])
  if ((here.unsaved || elsewhere.unsaved) && !(await deps.confirm(UNSAVED_QUESTION))) return 'cancelled'

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
    flushHere: (waitMs) => flushAll(waitMs),
    flushOtherTabs: (userId, waitMs) => flushOtherTabs(userId, { waitMs }),
    confirm: (question) => window.confirm(question),
    logout: () => appFetch('/api/auth/logout', { method: 'POST', cache: 'no-store' }),
    stopSavers: () => stopAll(),
    wipe: wipeUserStorage,
    broadcast: (message) => postAuthMessage(message),
    leave: goToSignIn,
  }
}
