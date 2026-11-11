'use client'

import { createContext, useContext, type ReactNode } from 'react'

/**
 * The signed-in user, as the app and editor layouts hand it down. Never holds
 * the session id or anything secret: only what the screens show.
 */
export type CurrentUser = { id: string; displayName: string; email: string; isAdmin: boolean }

const CurrentUserContext = createContext<CurrentUser | null>(null)

/**
 * The user id this page was rendered for, outside React: the save engine and
 * the other request helpers send it with every change (src/client/http.ts).
 * Browser only; on the server it stays null, so one request's user can never
 * leak into another's render.
 */
let renderedForUserId: string | null = null

/** The id of the user this page was rendered for, or null on a page with no signed-in user. */
export function currentUserId(): string | null {
  return renderedForUserId
}

/** Notes the page's user. Called while the provider renders, before any child's effect can send a request. */
function rememberCurrentUser(id: string): void {
  if (typeof window !== 'undefined') renderedForUserId = id
}

/**
 * Wraps every signed-in screen. It records the user during its own render,
 * which comes before its children render and before any effect runs, so the
 * first save after the page loads already carries the user's id.
 */
export function CurrentUserProvider({ user, children }: { user: CurrentUser; children: ReactNode }) {
  rememberCurrentUser(user.id)
  return <CurrentUserContext value={user}>{children}</CurrentUserContext>
}

/** The signed-in user. Only for components inside CurrentUserProvider (every signed-in screen). */
export function useCurrentUser(): CurrentUser {
  const user = useContext(CurrentUserContext)
  if (!user) throw new Error('useCurrentUser needs CurrentUserProvider')
  return user
}
