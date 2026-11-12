/**
 * The one place the browser sends requests to the app's own routes from.
 * Every change (any method but GET, HEAD or OPTIONS) carries the id of the
 * user this page was rendered for in the user header. The server refuses a
 * change from a browser page whose header does not match the session's user
 * (401 stale_page, src/server/auth/guards.ts): another site cannot add the
 * header, and a tab left open from before someone else signed in on this
 * browser sends the old id, so its edits never land under the new account.
 *
 * The save engines take a fetch bound to the user they were made for
 * (appFetchAs), so a queue made for one person can never send under a header
 * that names someone else, whatever the page renders later.
 *
 * A unit test (http.test.ts) fails if client code calls fetch itself to send
 * a change, outside the public sign-in forms.
 */
import { USER_HEADER } from '@/shared/user-header'
import { currentUserId } from './current-user'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

function send(input: RequestInfo | URL, init: RequestInit, userId: string | null): Promise<Response> {
  const method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
  if (SAFE_METHODS.has(method)) return fetch(input, init)
  const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined))
  if (userId) headers.set(USER_HEADER, userId)
  return fetch(input, { ...init, headers })
}

/** fetch, plus the user header on a change. */
export function appFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  return send(input, init, currentUserId())
}

/** appFetch for one user: changes always carry this user's id, whoever the page shows now. */
export function appFetchAs(userId: string): typeof fetch {
  return (input, init = {}) => send(input, init, userId)
}

/**
 * True for the server's answer to a change from a page of someone other than
 * the signed-in user: 401 { error: 'stale_page' }. Unlike a plain 401 (the
 * session ended), trying again can never help: the edit belongs to the
 * person the page was opened for.
 */
export function isStalePage(status: number, body: unknown): boolean {
  return status === 401 && Boolean(body) && typeof body === 'object' && (body as { error?: unknown }).error === 'stale_page'
}
