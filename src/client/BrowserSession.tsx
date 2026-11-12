'use client'

/**
 * What every signed-in page does about this browser, once it has loaded
 * (mounted by the app and editor layouts, inside CurrentUserProvider):
 *
 * - Moves unsaved edits from before accounts into this user's storage
 *   (src/client/sync/legacy-drafts.ts), and drops the old Noa / Aiden choice.
 * - Listens to the other tabs (src/client/auth-channel.ts). When someone else
 *   signs in, this page stops and asks to reload: its edits stay in this
 *   user's storage and are never sent under the other person's session. When
 *   this person signs out in another tab, this page stops its savers and goes
 *   to the sign-in page. When this person signs in again, waiting saves go.
 *   When a tab signing this person out asks, this page sends what it holds.
 */
import { useEffect, useSyncExternalStore } from 'react'
import { listenForAuthChanges, markOtherUser, pageAuthState, subscribePageAuthState } from './auth-channel'
import { useCurrentUser } from './current-user'
import { goToSignIn } from './sign-out'
import { ensureLegacyAdopted } from './sync/legacy-drafts'
import { flushAll, stopAll } from './sync/saver-registry'
import { LEGACY_AUTHOR_KEY } from './sync/storage-names'
import { Dialog } from './ui/Dialog'
import { primaryButton } from './ui/styles'

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

  useEffect(
    () =>
      listenForAuthChanges({
        userId: user.id,
        onOtherUser: markOtherUser,
        onSignedInAgain: () => void flushAll(),
        onSignedOut: () => {
          void stopAll().finally(goToSignIn)
        },
        flush: () => flushAll(2500),
      }),
    [user.id],
  )

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
