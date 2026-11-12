/**
 * Invite and reset links: /invite#<token> and /reset#<token>. The token sits
 * in the #fragment, which a browser never sends to a server, so it stays out
 * of request lines, server logs and Referer headers. The pages read it in the
 * browser and send it to the server only inside a JSON body.
 *
 * Pure, so the rules have tests.
 */

/** Invite and reset tokens: 32 random bytes in base64url, 43 characters. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/

/**
 * The token in an address's #fragment ("#abc…"), or null when there is none
 * or it is not a whole token (a link cut short when it was copied).
 */
export function tokenFromHash(hash: string): string | null {
  const raw = (hash.startsWith('#') ? hash.slice(1) : hash).trim()
  return TOKEN.test(raw) ? raw : null
}

/** The path of an invite link, to show to the person who made it. */
export function invitePath(token: string): string {
  return `/invite#${token}`
}

/** The path of a reset link, to show to the admin who made it. */
export function resetPath(token: string): string {
  return `/reset#${token}`
}

const AFTER_INVITE = /^\/w\/[0-9a-f-]{36}\/layouts$/

/**
 * Where to go after accepting an invite: the wedding the server named, or
 * home. Anything else the reply might hold goes home, so the page can only
 * ever leave for a path of this site, and never one carrying the token.
 */
export function afterInvitePath(redirect: unknown): string {
  return typeof redirect === 'string' && AFTER_INVITE.test(redirect) ? redirect : '/'
}
