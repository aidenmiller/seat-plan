/**
 * The header a page sends its signed-in user's id in, on every change it asks
 * for (any method but GET, HEAD or OPTIONS). The server refuses a change from
 * a browser page whose header does not name the user its cookie signs in
 * (src/server/auth/origin.ts and guards.ts), so a tab left open from before
 * someone else signed in on this browser cannot save under the new account.
 * The browser adds it in one place, src/client/http.ts.
 */
export const USER_HEADER = 'x-seat-plan-user'
