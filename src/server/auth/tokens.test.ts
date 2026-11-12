import { createHash, createHmac, hkdfSync } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  OPAQUE_TOKEN_PATTERN,
  createShareToken,
  hashOpaqueToken,
  newOpaqueToken,
  openSessionCookie,
  passwordsMatch,
  signSessionCookie,
  verifyShareToken,
} from './tokens'

const SECRET = 'test-secret-that-is-at-least-32-characters-long'
const saved = { ...process.env }

function signWith(key: Buffer, payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${createHmac('sha256', key).update(body).digest('base64url')}`
}

/**
 * A cookie as the shared-password days signed it (that code is gone): the
 * old site key, from AUTH_SECRET and SITE_PASSWORD, over a 'site' payload.
 */
function oldSiteToken(): string {
  const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest()
  const siteKey = Buffer.from(hkdfSync('sha256', SECRET, sha('correct horse'), 'seat-plan site cookie v1', 32))
  return signWith(siteKey, { typ: 'site', exp: Date.now() + 60_000 })
}

beforeEach(() => {
  process.env.AUTH_SECRET = SECRET
  process.env.SITE_PASSWORD = 'correct horse'
})
afterEach(() => {
  process.env = { ...saved }
})

describe('share tokens', () => {
  it('round-trips the link id and credential version', () => {
    const token = createShareToken('link-1', 3)
    expect(verifyShareToken(token)).toEqual({ linkId: 'link-1', credentialVersion: 3 })
  })

  it('survives a site password change', () => {
    const token = createShareToken('link-1', 1)
    process.env.SITE_PASSWORD = 'a new password'
    expect(verifyShareToken(token)).toEqual({ linkId: 'link-1', credentialVersion: 1 })
  })

  it('never accepts an old site cookie (signed with the old site key) as a share token', () => {
    expect(verifyShareToken(oldSiteToken())).toBeNull()
  })

  it('checks the payload type even when the signature is right', () => {
    // Sign payloads of the wrong type with the share key, the way tokens.ts derives it.
    const shareKey = Buffer.from(hkdfSync('sha256', SECRET, Buffer.alloc(0), 'seat-plan share cookie v1', 32))
    const exp = Date.now() + 60_000
    expect(verifyShareToken(signWith(shareKey, { typ: 'share', linkId: 'x', cv: 1, exp }))).not.toBeNull()
    expect(verifyShareToken(signWith(shareKey, { typ: 'site', linkId: 'x', cv: 1, exp }))).toBeNull()
  })
})

describe('opaque tokens', () => {
  it('are 43 base64url characters and never repeat', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => newOpaqueToken()))
    expect(tokens.size).toBe(200)
    for (const t of tokens) expect(t).toMatch(OPAQUE_TOKEN_PATTERN)
  })

  it('hash to 64 hex characters, the same way every time', () => {
    const token = newOpaqueToken()
    expect(hashOpaqueToken(token)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashOpaqueToken(token)).toBe(createHash('sha256').update(token).digest('hex'))
    expect(hashOpaqueToken(token)).not.toBe(hashOpaqueToken(newOpaqueToken()))
  })
})

describe('session cookies', () => {
  const secret = 'A'.repeat(43)
  const now = Date.UTC(2026, 0, 1)
  const sessionKey = () => Buffer.from(hkdfSync('sha256', SECRET, Buffer.alloc(0), 'seat-plan user session v1', 32))
  it('round-trip the secret and expiry', () => {
    const value = signSessionCookie(secret, now + 60_000)
    expect(openSessionCookie(value, now)).toEqual({ secret, exp: now + 60_000 })
  })

  it('stop at their expiry', () => {
    const value = signSessionCookie(secret, now + 60_000)
    expect(openSessionCookie(value, now + 59_999)).not.toBeNull()
    expect(openSessionCookie(value, now + 60_000)).toBeNull()
  })

  it('reject a tampered payload or signature', () => {
    const value = signSessionCookie(secret, now + 60_000)
    const [body, sig] = value.split('.')
    const other = Buffer.from(JSON.stringify({ typ: 'user', s: 'B'.repeat(43), exp: now + 60_000 })).toString('base64url')
    expect(openSessionCookie(`${other}.${sig}`, now)).toBeNull()
    expect(openSessionCookie(`${body}.${sig}x`, now)).toBeNull()
    expect(openSessionCookie(`${body}.`, now)).toBeNull()
    expect(openSessionCookie(body, now)).toBeNull()
    expect(openSessionCookie(`${value}.extra`, now)).toBeNull()
    expect(openSessionCookie('', now)).toBeNull()
    expect(openSessionCookie(null, now)).toBeNull()
    expect(openSessionCookie(undefined, now)).toBeNull()
  })

  it('refuse a share token or an old site cookie in their place, and are refused as a share token', () => {
    expect(openSessionCookie(createShareToken('link-1', 1))).toBeNull()
    expect(openSessionCookie(oldSiteToken())).toBeNull()
    const value = signSessionCookie(secret, Date.now() + 60_000)
    expect(verifyShareToken(value)).toBeNull()
  })

  it('check the payload type and secret shape even when the signature is right', () => {
    const exp = Date.now() + 60_000
    expect(openSessionCookie(signWith(sessionKey(), { typ: 'user', s: secret, exp }))).toEqual({ secret, exp })
    expect(openSessionCookie(signWith(sessionKey(), { typ: 'share', s: secret, linkId: 'x', cv: 1, exp }))).toBeNull()
    expect(openSessionCookie(signWith(sessionKey(), { typ: 'user', s: 'short', exp }))).toBeNull()
    expect(openSessionCookie(signWith(sessionKey(), { typ: 'user', s: 42, exp }))).toBeNull()
    expect(openSessionCookie(signWith(sessionKey(), { typ: 'user', s: secret }))).toBeNull()
    // Signed with the share key (same secret, other label): refused.
    const shareKey = Buffer.from(hkdfSync('sha256', SECRET, Buffer.alloc(0), 'seat-plan share cookie v1', 32))
    expect(openSessionCookie(signWith(shareKey, { typ: 'user', s: secret, exp }))).toBeNull()
  })

  it('do not depend on SITE_PASSWORD', () => {
    const exp = Date.now() + 60_000
    const value = signSessionCookie(secret, exp)
    process.env.SITE_PASSWORD = 'a new password'
    expect(openSessionCookie(value)).not.toBeNull()
    expect(signSessionCookie(secret, exp)).toBe(value)
    delete process.env.SITE_PASSWORD
    expect(openSessionCookie(value)).not.toBeNull()
    expect(signSessionCookie(secret, exp)).toBe(value)
  })

  it('stop working when AUTH_SECRET changes, and fail closed without one', () => {
    const value = signSessionCookie(secret, Date.now() + 60_000)
    process.env.AUTH_SECRET = `${SECRET}-rotated`
    expect(openSessionCookie(value)).toBeNull()
    process.env.AUTH_SECRET = 'short'
    expect(openSessionCookie(value)).toBeNull()
    expect(() => signSessionCookie(secret, Date.now() + 60_000)).toThrow()
  })

  it('refuse to sign a secret that is not a 43-character token', () => {
    expect(() => signSessionCookie('short', Date.now() + 60_000)).toThrow()
    expect(() => signSessionCookie(`${'A'.repeat(42)}=`, Date.now() + 60_000)).toThrow()
  })
})

describe('password compare', () => {
  it('matches only the exact password', () => {
    expect(passwordsMatch('abc', 'abc')).toBe(true)
    expect(passwordsMatch('abc', 'abcd')).toBe(false)
    expect(passwordsMatch('', 'abc')).toBe(false)
    expect(passwordsMatch('ABC', 'abc')).toBe(false)
  })

})
