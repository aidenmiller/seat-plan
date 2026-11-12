'use client'

/**
 * What every signed-in page does about this browser, once it has loaded
 * (mounted by the app and editor layouts, inside CurrentUserProvider):
 *
 * - Moves unsaved edits from before accounts into this user's storage
 *   (src/client/sync/legacy-drafts.ts), and drops the old Noa / Aiden choice.
 * - Right after the invite page made this account, tells the other tabs who
 *   signed in (announcePendingSignIn), as the sign-in page does.
 * - Listens to the other tabs (src/client/auth-channel.ts). When someone else
 *   signs in, this page stops and asks to reload: its edits stay in this
 *   user's storage and are never sent under the other person's session. When
 *   this person signs out in another tab, this page stops its savers and goes
 *   to the sign-in page. When this person signs in again (after their session
 *   ran out, or after someone else signed in meanwhile), the page stops
 *   asking to reload and its savers send what they kept.
 *   When a tab signing this person out asks, this page sends what it holds.
 */
import { useEffect, useSyncExternalStore } from 'react'
import {
  announcePendingSignIn,
  clearOtherUser,
  listenForAuthChanges,
  markOtherUser,
  pageAuthState,
  subscribePageAuthState,
  type AuthListenerHandlers,
} from './auth-channel'
import { useCurrentUser } from './current-user'
import { goToSignIn } from './sign-out'
import { ensureLegacyAdopted } from './sync/legacy-drafts'
import { flushAll, resumeAll, stopAll } from './sync/saver-registry'
import { LEGACY_AUTHOR_KEY } from './sync/storage-names'
import { Dialog } from './ui/Dialog'
import { primaryButton } from './ui/styles'

/** What this page does on each message from the other tabs. */
export function pageAuthHandlers(userId: string): AuthListenerHandlers {
  return {
    userId,
    onOtherUser: markOtherUser,
    onSignedInAgain: () => {
      // The session is this page's user's again: their edits, kept in their storage, may go.
      clearOtherUser()
      resumeAll()
      void flushAll()
    },
    onSignedOut: () => {
      void stopAll().finally(goToSignIn)
    },
    flush: () => flushAll(2500),
  }
}

export function BrowserSession() {
  const user = useCurrentUser()

  useEffect(() => {
    void ensureLegacyAdopted(user.id)
    try {
      window.localStorage.removeItem(LEGACY_AUTHOR_KEY)
    } catch {
      // Storage blocked: nothing kept there either.
    }
  }, [user.id])

  // The invite page just made this account: tell the other tabs who is signed in now.
  useEffect(() => announcePendingSignIn({ id: user.id, email: user.email }), [user.id, user.email])

  useEffect(() => listenForAuthChanges(pageAuthHandlers(user.id)), [user.id])

  const state = useSyncExternalStore(subscribePageAuthState, pageAuthState, () => 'current' as const)
  return (
    <Dialog
      open={state === 'other-user'}
      onClose={() => undefined}
      dismissable={false}
      size="sm"
      title="Someone else signed in"
      description={`This page was opened for ${user.displayName}. Changes made here are kept on this device for ${user.displayName}, and are not saved while someone else is signed in.`}
      testId="other-user-dialog"
    >
      <div className="mt-4 flex justify-end">
        <button type="button" className={primaryButton} onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    </Dialog>
  )
}
