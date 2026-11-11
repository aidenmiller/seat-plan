/**
 * The short sentences the people, invite, reset, account and admin screens
 * show, and the 409 messages their routes send. Pure, so every wording rule
 * has a test.
 */
import type { InviteProblem, Role } from '@/shared/accounts-api'
import { plural } from './wording'

export function roleLabel(role: Role): string {
  return role === 'owner' ? 'Owner' : 'Editor'
}

/** What each role may do, for the invite form and the member list. */
export function roleHint(role: Role): string {
  return role === 'owner' ? 'Can also invite and remove people, change settings and delete the wedding' : 'Can change guests, layouts and rules'
}

/** Why an invite link cannot be used, as the invite page and the 409 replies say it. */
export function inviteProblemMessage(problem: InviteProblem): string {
  switch (problem) {
    case 'used':
      return 'This invite has already been used. If you used it, sign in instead.'
    case 'expired':
      return 'This invite has expired. Ask for a new one.'
    case 'revoked':
      return 'This invite was cancelled. Ask for a new one if you still need it.'
    case 'email-mismatch':
      return 'This invite is for a different email address.'
    case 'wedding-gone':
      return 'The wedding this invite was for has been deleted.'
    case 'inviter-disabled':
    case 'inviter-lost-access':
      return 'This invite no longer works. Ask for a new one.'
  }
}

/** Why a reset link cannot be used. Only an admin can make a new one. */
export function resetProblemMessage(problem: 'used' | 'expired'): string {
  return problem === 'used'
    ? 'This reset link has already been used. Ask an admin for a new one if you still need it.'
    : 'This reset link has expired, or a newer one was made. Ask an admin for a new one.'
}

/** The 409 when a change would leave a wedding with no owner. */
export const LAST_OWNER_MESSAGE = 'A wedding needs at least one owner. Make someone else an owner first.'
export const LAST_OWNER_LEAVE_MESSAGE = 'You are the only owner. Make someone else an owner before you leave.'

/** "Expires in 7 days", "Expires in 3 hours", "Expired". For invite and reset links. */
export function expiresIn(iso: string, nowMs: number): string {
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return ''
  const minutes = Math.floor((at - nowMs) / 60_000)
  if (minutes <= 0) return 'Expired'
  if (minutes < 60) return `Expires in ${plural(minutes, 'minute')}`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Expires in ${plural(hours, 'hour')}`
  return `Expires in ${plural(Math.round(hours / 24), 'day')}`
}

const BROWSERS: [RegExp, string][] = [
  [/\bEdg(e|A|iOS)?\//, 'Edge'],
  [/\bOPR\/|\bOpera\b/, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\bFirefox\/|\bFxiOS\//, 'Firefox'],
  [/\bChrome\/|\bCriOS\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
]

const SYSTEMS: [RegExp, string][] = [
  [/\biPhone\b/, 'iPhone'],
  [/\biPad\b/, 'iPad'],
  [/\bAndroid\b/, 'Android'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bWindows\b/, 'Windows'],
  [/\bMac OS X\b|\bMacintosh\b/, 'Mac'],
  [/\bLinux\b/, 'Linux'],
]

/**
 * "Chrome on Windows", "Safari on iPhone": a short name for the device a
 * session was signed in from, from its user agent. Unknown parts are left
 * out; with nothing known it says "Unknown browser".
 */
export function describeUserAgent(userAgent: string | null): string {
  if (!userAgent) return 'Unknown browser'
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? null
  const system = SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? null
  if (browser && system) return `${browser} on ${system}`
  return browser ?? system ?? 'Unknown browser'
}
