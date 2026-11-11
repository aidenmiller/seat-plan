/**
 * Signed cookie tokens and the password compare. Runs in the proxy and in
 * route handlers (both Node). No 'server-only' import so Vitest can load it;
 * it holds no secrets itself and reads them from the environment at call time.
 *
 * Three keys (PLAN change 23):
 *  - the site key comes from AUTH_SECRET and SITE_PASSWORD, so a new site
 *    password makes every old site cookie fail;
 *  - the share key comes from AUTH_SECRET alone, so changing the site password
 *    leaves venue viewers signed in;
 *  - the user session key comes from AUTH_SECRET alone too. A session cookie
 *    only carries a random secret; the sessions table decides whether it is
 *    still good (src/server/repo/sessions.ts).
 * Every payload names its type, so one kind of cookie can never pass as another.
 */
import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'

export const SITE_COOKIE = 'sp_site'
export const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60
export function shareCookieName(linkId: string): string {
  return `sp_share_${linkId}`
}

export const SESSION_COOKIE = 'sp_session'
/** How long the browser keeps the session cookie after it was last set. */
export const SESSION_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 3600

/** Session, invite and reset tokens: 32 random bytes in base64url. */
export const OPAQUE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

type SitePayload = { typ: 'site'; exp: number }
type SharePayload = { typ: 'share'; linkId: string; cv: number; exp: number }
type SessionPayload = { typ: 'user'; s: string; exp: number }

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

function authSecret(): string | null {
  const secret = process.env.AUTH_SECRET
  return secret && secret.length >= 32 ? secret : null
}

function siteKey(): Buffer | null {
  const secret = authSecret()
  const password = process.env.SITE_PASSWORD
  if (!secret || !password) return null
  return Buffer.from(hkdfSync('sha256', secret, sha256(password), 'seat-plan site cookie v1', 32))
}

function shareKey(): Buffer | null {
  const secret = authSecret()
  if (!secret) return null
  return Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), 'seat-plan share cookie v1', 32))
}

/** Does not depend on SITE_PASSWORD, which goes away once everyone has an account. */
function sessionKey(): Buffer | null {
  const secret = authSecret()
  if (!secret) return null
  return Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), 'seat-plan user session v1', 32))
}

function mac(key: Buffer, body: string): Buffer {
  return createHmac('sha256', key).update(body, 'utf8').digest()
}

function sign(payload: SitePayload | SharePayload | SessionPayload, key: Buffer): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${body}.${mac(key, body).toString('base64url')}`
}

function open(token: string, key: Buffer, now: number): Record<string, unknown> | null {
  if (token.length > 4096) return null
  const dot = token.indexOf('.')
  if (dot <= 0 || dot !== token.lastIndexOf('.')) return null
  const body = token.slice(0, dot)
  const given = Buffer.from(token.slice(dot + 1), 'base64url')
  const expected = mac(key, body)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  let payload: unknown
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (typeof payload !== 'object' || payload === null) return null
  const exp = (payload as { exp?: unknown }).exp
  if (typeof exp !== 'number' || !Number.isFinite(exp) || exp <= now) return null
  return payload as Record<string, unknown>
}

/**
 * Site tokens are from the shared-password days: nothing in the app makes or
 * accepts one any more (the proxy and the sign-in routes only clear an old
 * sp_site cookie). They stay, with the tests that show such a cookie opens
 * nothing, until the next phase removes them.
 */
export function createSiteToken(now: number = Date.now()): string {
  const key = siteKey()
  if (!key) throw new Error('AUTH_SECRET (32+ characters) and SITE_PASSWORD must be set')
  return sign({ typ: 'site', exp: now + COOKIE_MAX_AGE_SECONDS * 1000 }, key)
}

/** True only for an unexpired site token signed with the current key. Fails closed. */
export function verifySiteToken(token: string | undefined | null, now: number = Date.now()): boolean {
  if (!token) return false
  const key = siteKey()
  if (!key) return false
  const payload = open(token, key, now)
  return payload?.typ === 'site'
}

export function createShareToken(linkId: string, credentialVersion: number, now: number = Date.now()): string {
  const key = shareKey()
  if (!key) throw new Error('AUTH_SECRET (32+ characters) must be set')
  return sign({ typ: 'share', linkId, cv: credentialVersion, exp: now + COOKIE_MAX_AGE_SECONDS * 1000 }, key)
}

/** The link id and credential version inside a valid share token, or null. */
export function verifyShareToken(
  token: string | undefined | null,
  now: number = Date.now(),
): { linkId: string; credentialVersion: number } | null {
  if (!token) return null
  const key = shareKey()
  if (!key) return null
  const payload = open(token, key, now)
  if (!payload || payload.typ !== 'share') return null
  if (typeof payload.linkId !== 'string' || typeof payload.cv !== 'number') return null
  return { linkId: payload.linkId, credentialVersion: payload.cv }
}

/** 32 random bytes in base64url: 43 characters. Only its hash is ever stored. */
export function newOpaqueToken(): string {
  return randomBytes(32).toString('base64url')
}

/** SHA-256 in hex (64 characters): what the database keeps in place of a token. */
export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/**
 * The session cookie's value: the session's random secret, signed. `expMs` is
 * the latest the cookie can be any good (the session's hard cap); the
 * sessions table decides the real expiry.
 */
export function signSessionCookie(secret: string, expMs: number): string {
  const key = sessionKey()
  if (!key) throw new Error('AUTH_SECRET (32+ characters) must be set')
  if (!OPAQUE_TOKEN_PATTERN.test(secret)) throw new Error('A session secret is 43 base64url characters')
  return sign({ typ: 'user', s: secret, exp: expMs }, key)
}

/**
 * The secret inside a validly signed, unexpired session cookie, or null.
 * Proves only that this server signed it: the caller must still find the
 * session in the database.
 */
export function openSessionCookie(
  value: string | null | undefined,
  now: number = Date.now(),
): { secret: string; exp: number } | null {
  if (!value) return null
  const key = sessionKey()
  if (!key) return null
  const payload = open(value, key, now)
  if (!payload || payload.typ !== 'user') return null
  if (typeof payload.s !== 'string' || !OPAQUE_TOKEN_PATTERN.test(payload.s)) return null
  return { secret: payload.s, exp: payload.exp as number }
}

/**
 * Compares a typed password with the expected one in constant time. Hashing
 * both first gives equal-length buffers, so the time does not depend on length.
 */
export function passwordsMatch(input: string, expected: string): boolean {
  return timingSafeEqual(sha256(input), sha256(expected))
}

export function sitePasswordMatches(input: string): boolean {
  const expected = process.env.SITE_PASSWORD
  if (!expected) return false
  return passwordsMatch(input, expected)
}
