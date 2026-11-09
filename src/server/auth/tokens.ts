/**
 * Signed cookie tokens and the password compare. Runs in the proxy and in
 * route handlers (both Node). No 'server-only' import so Vitest can load it;
 * it holds no secrets itself and reads them from the environment at call time.
 *
 * Two keys (PLAN change 23):
 *  - the site key comes from AUTH_SECRET and SITE_PASSWORD, so a new site
 *    password makes every old site cookie fail;
 *  - the share key comes from AUTH_SECRET alone, so changing the site password
 *    leaves venue viewers signed in.
 * Every payload names its type, so a share cookie can never pass as a site cookie.
 */
import { createHash, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'

export const SITE_COOKIE = 'sp_site'
export const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60
export function shareCookieName(linkId: string): string {
  return `sp_share_${linkId}`
}

type SitePayload = { typ: 'site'; exp: number }
type SharePayload = { typ: 'share'; linkId: string; cv: number; exp: number }

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

function mac(key: Buffer, body: string): Buffer {
  return createHmac('sha256', key).update(body, 'utf8').digest()
}

function sign(payload: SitePayload | SharePayload, key: Buffer): string {
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
