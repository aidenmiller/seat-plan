import { describe, expect, it } from 'vitest'
import type { InviteProblem } from '@/shared/accounts-api'
import { describeUserAgent, expiresIn, inviteProblemMessage, resetProblemMessage, roleHint, roleLabel, tooManyTriesMessage } from './account-wording'

const NOW = Date.parse('2026-11-11T12:00:00.000Z')

describe('roles', () => {
  it('names each role and what it may do', () => {
    expect(roleLabel('owner')).toBe('Owner')
    expect(roleLabel('editor')).toBe('Editor')
    expect(roleHint('editor')).toBe('Can change guests, layouts and rules')
    expect(roleHint('owner')).toMatch(/^Can also invite and remove people/)
  })
})

describe('inviteProblemMessage and resetProblemMessage', () => {
  it('has a plain sentence for every reason a link stops working', () => {
    const problems: InviteProblem[] = ['used', 'expired', 'revoked', 'email-mismatch', 'wedding-gone', 'inviter-disabled', 'inviter-lost-access']
    for (const problem of problems) expect(inviteProblemMessage(problem), problem).toMatch(/^[A-Z].*\.$/)
    expect(inviteProblemMessage('revoked')).toBe('This invite was cancelled. Ask for a new one if you still need it.')
    // The sender being turned off or losing the role reads the same: the person cannot fix either.
    expect(inviteProblemMessage('inviter-disabled')).toBe(inviteProblemMessage('inviter-lost-access'))
    expect(resetProblemMessage('used')).toMatch(/already been used/)
    expect(resetProblemMessage('expired')).toMatch(/expired/)
  })
})

describe('tooManyTriesMessage', () => {
  it('rounds the wait up to whole minutes, as the sign-in page does', () => {
    expect(tooManyTriesMessage(840)).toBe('Too many tries. Try again in 14 minutes.')
    expect(tooManyTriesMessage(30)).toBe('Too many tries. Try again in 1 minute.')
    expect(tooManyTriesMessage(undefined)).toBe('Too many tries. Try again in 15 minutes.')
  })
})

describe('expiresIn', () => {
  it('counts down in days, hours or minutes, then says it has expired', () => {
    expect(expiresIn('2026-11-18T12:00:00.000Z', NOW)).toBe('Expires in 7 days')
    expect(expiresIn('2026-11-12T11:00:00.000Z', NOW)).toBe('Expires in 23 hours')
    expect(expiresIn('2026-11-11T13:00:00.000Z', NOW)).toBe('Expires in 1 hour')
    expect(expiresIn('2026-11-11T12:05:00.000Z', NOW)).toBe('Expires in 5 minutes')
    expect(expiresIn('2026-11-11T12:00:00.000Z', NOW)).toBe('Expired')
    expect(expiresIn('2026-11-01T12:00:00.000Z', NOW)).toBe('Expired')
    expect(expiresIn('not a date', NOW)).toBe('')
  })
})

describe('describeUserAgent', () => {
  it('names the browser and the device', () => {
    const cases: [string, string][] = [
      ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', 'Chrome on Windows'],
      ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0', 'Edge on Windows'],
      ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15', 'Safari on Mac'],
      ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1', 'Safari on iPhone'],
      ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1', 'Chrome on iPhone'],
      ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36', 'Chrome on Android'],
      ['Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36', 'Samsung Internet on Android'],
      ['Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0', 'Firefox on Linux'],
      ['Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', 'Safari on iPad'],
    ]
    for (const [ua, expected] of cases) expect(describeUserAgent(ua), ua).toBe(expected)
  })

  it('says what it can, and "Unknown browser" for nothing', () => {
    expect(describeUserAgent('curl/8.4.0')).toBe('Unknown browser')
    expect(describeUserAgent('vitest')).toBe('Unknown browser')
    expect(describeUserAgent(null)).toBe('Unknown browser')
    expect(describeUserAgent('Something (Windows NT 10.0)')).toBe('Windows')
  })
})
