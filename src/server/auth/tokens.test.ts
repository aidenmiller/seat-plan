import { createHash, createHmac, hkdfSync } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  COOKIE_MAX_AGE_SECONDS,
  createShareToken,
  createSiteToken,
  passwordsMatch,
  sitePasswordMatches,
  verifyShareToken,
  verifySiteToken,
} from './tokens'

const SECRET = 'test-secret-that-is-at-least-32-characters-long'
const saved = { ...process.env }

beforeEach(() => {
  process.env.AUTH_SECRET = SECRET
  process.env.SITE_PASSWORD = 'correct horse'
})
afterEach(() => {
  process.env = { ...saved }
})

describe('site tokens', () => {
  it('verifies a fresh token', () => {
    expect(verifySiteToken(createSiteToken())).toBe(true)
  })

  it('lasts 30 days and then expires', () => {
    const now = Date.UTC(2026, 0, 1)
    const token = createSiteToken(now)
    expect(verifySiteToken(token, now + (COOKIE_MAX_AGE_SECONDS - 60) * 1000)).toBe(true)
    expect(verifySiteToken(token, now + (COOKIE_MAX_AGE_SECONDS + 1) * 1000)).toBe(false)
  })

  it('rejects a tampered payload or signature', () => {
    const token = createSiteToken()
    const [body, sig] = token.split('.')
    const longer = Buffer.from(JSON.stringify({ typ: 'site', exp: 9e15 })).toString('base64url')
    expect(verifySiteToken(`${longer}.${sig}`)).toBe(false)
    expect(verifySiteToken(`${body}.${sig}x`)).toBe(false)
    expect(verifySiteToken(`${body}.`)).toBe(false)
    expect(verifySiteToken(`${body}`)).toBe(false)
    expect(verifySiteToken('')).toBe(false)
    expect(verifySiteToken(undefined)).toBe(false)
  })

  it('stops working when the site password changes', () => {
    const token = createSiteToken()
    process.env.SITE_PASSWORD = 'a new password'
    expect(verifySiteToken(token)).toBe(false)
  })

  it('stops working when AUTH_SECRET changes', () => {
    const token = createSiteToken()
    process.env.AUTH_SECRET = `${SECRET}-rotated`
    expect(verifySiteToken(token)).toBe(false)
  })

  it('fails closed without a usable secret', () => {
    const token = createSiteToken()
    process.env.AUTH_SECRET = 'short'
    expect(verifySiteToken(token)).toBe(false)
    delete process.env.AUTH_SECRET
    expect(verifySiteToken(token)).toBe(false)
    expect(() => createSiteToken()).toThrow()
  })
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

  it('can never pass as a site token, and a site token never passes as a share token', () => {
    expect(verifySiteToken(createShareToken('link-1', 1))).toBe(false)
    expect(verifyShareToken(createSiteToken())).toBeNull()
  })

  it('checks the payload type even when the signature is right', () => {
    // Sign payloads of the wrong type with each cookie's own key, the way tokens.ts derives them.
    const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest()
    const siteKey = Buffer.from(hkdfSync('sha256', SECRET, sha('correct horse'), 'seat-plan site cookie v1', 32))
    const shareKey = Buffer.from(hkdfSync('sha256', SECRET, Buffer.alloc(0), 'seat-plan share cookie v1', 32))
    const signWith = (key: Buffer, payload: object) => {
      const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
      return `${body}.${createHmac('sha256', key).update(body).digest('base64url')}`
    }
    const exp = Date.now() + 60_000
    expect(verifySiteToken(signWith(siteKey, { typ: 'site', exp }))).toBe(true)
    expect(verifySiteToken(signWith(siteKey, { typ: 'share', linkId: 'x', cv: 1, exp }))).toBe(false)
    expect(verifyShareToken(signWith(shareKey, { typ: 'share', linkId: 'x', cv: 1, exp }))).not.toBeNull()
    expect(verifyShareToken(signWith(shareKey, { typ: 'site', linkId: 'x', cv: 1, exp }))).toBeNull()
  })
})

describe('password compare', () => {
  it('matches only the exact password', () => {
    expect(passwordsMatch('abc', 'abc')).toBe(true)
    expect(passwordsMatch('abc', 'abcd')).toBe(false)
    expect(passwordsMatch('', 'abc')).toBe(false)
    expect(passwordsMatch('ABC', 'abc')).toBe(false)
  })

  it('checks against SITE_PASSWORD and fails closed when it is missing', () => {
    expect(sitePasswordMatches('correct horse')).toBe(true)
    expect(sitePasswordMatches('wrong')).toBe(false)
    delete process.env.SITE_PASSWORD
    expect(sitePasswordMatches('')).toBe(false)
  })
})
