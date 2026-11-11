/**
 * The one place the browser sends requests to the app's own routes from.
 * Every change (any method but GET, HEAD or OPTIONS) carries the id of the
 * user this page was rendered for in the user header. The server refuses a
 * change from a browser page whose header does not match the session's user
 * (401 stale_page, src/server/auth/guards.ts): another site cannot add the
 * header, and a tab left open from before someone else signed in on this
 * browser sends the old id, so its edits never land under the new account.
 *
 * A unit test (http.test.ts) fails if client code calls fetch itself to send
 * a change, outside the public sign-in forms.
 */
import { USER_HEADER } from '@/shared/user-header'
import { currentUserId } from './current-user'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** fetch, plus the user header on a change. */
export function appFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
  if (SAFE_METHODS.has(method)) return fetch(input, init)
  const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined))
  const userId = currentUserId()
  if (userId) headers.set(USER_HEADER, userId)
  return fetch(input, { ...init, headers })
}
