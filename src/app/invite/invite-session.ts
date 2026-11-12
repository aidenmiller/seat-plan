/**
 * Signing out, signing in and making an account from the invite page, the
 * way the rest of the app does:
 *
 * - Sign out goes through the shared sign-out (src/client/sign-out.ts): send
 *   what waits, ask before dropping anything unsaved, end the session, delete
 *   this person's storage and the editor's clipboard, tell their other tabs.
 *   It then loads this page again rather than the sign-in page: the invite's
 *   token is in the #fragment, so the page shows the invite to nobody now.
 * - Signing in tells this browser's other tabs who signed in, as the sign-in
 *   page does (src/app/login/LoginForm.tsx), so a previous person's tabs stop
 *   at once instead of at their next save.
 * - Making an account signs it in too, but the reply does not carry the new
 *   account's id: the first page after it tells the other tabs
 *   (announceSignInOnNextPage, src/client/BrowserSession.tsx).
 */
import { registerWithInvite, signIn } from '@/client/accounts-api'
import { announceSignInOnNextPage, postAuthMessage, type AuthMessage } from '@/client/auth-channel'
import { browserSignOutDeps, signOut, type SignOutDeps, type SignOutResult } from '@/client/sign-out'
import { markLeavingForSignOut } from '@/client/sync/saver-registry'
import type { InviteAccepted, RegisterWithInviteBody } from '@/shared/accounts-api'

/** The shared sign-out's steps, leaving by loading this invite page again. */
export function inviteSignOutDeps(base: SignOutDeps = browserSignOutDeps()): SignOutDeps {
  return {
    ...base,
    leave() {
      markLeavingForSignOut()
      window.location.reload()
    },
  }
}

export function signOutFromInvite(userId: string, deps: SignOutDeps = inviteSignOutDeps()): Promise<SignOutResult> {
  return signOut(userId, deps)
}

export type InviteSignInDeps = {
  signIn: (email: string, password: string) => Promise<{ userId?: string }>
  post: (message: AuthMessage) => void
}

/** Signs in, then tells the other tabs who did. Throws as signIn does. */
export async function signInFromInvite(
  email: string,
  password: string,
  deps: InviteSignInDeps = { signIn, post: (message) => postAuthMessage(message) },
): Promise<void> {
  const reply = await deps.signIn(email, password)
  if (reply.userId) deps.post({ type: 'signed-in', userId: reply.userId })
}

export type InviteRegisterDeps = {
  register: (body: RegisterWithInviteBody) => Promise<InviteAccepted>
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
  now?: () => number
}

/** Makes the account (which signs it in), and leaves word for the next page to tell the other tabs. Throws as registerWithInvite does. */
export async function registerFromInvite(body: RegisterWithInviteBody, deps: InviteRegisterDeps = { register: registerWithInvite }): Promise<InviteAccepted> {
  const done = await deps.register(body)
  announceSignInOnNextPage(body.email, {
    ...(deps.storage !== undefined ? { storage: deps.storage } : {}),
    ...(deps.now ? { now: deps.now } : {}),
  })
  return done
}
