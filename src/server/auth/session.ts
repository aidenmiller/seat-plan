import 'server-only'
import { NextResponse, type NextRequest } from 'next/server'
import { getDb } from '../db/client'
import { findSession, type SessionLookup } from '../repo/sessions'
import type { SessionUser } from './access'
import { authCookieOptions } from './cookie-options'
import { SESSION_COOKIE, SESSION_COOKIE_MAX_AGE_SECONDS, SITE_COOKIE, openSessionCookie } from './tokens'

/**
 * The session cookie on requests and replies. Reading checks the signature
 * before anything else, so a request with no cookie, or a forged one, is
 * answered without touching the database.
 */

/** The session behind the request's cookie, with whether it is due a touch. */
export async function sessionFromRequest(req: NextRequest): Promise<SessionLookup | null> {
  const value = req.cookies.get(SESSION_COOKIE)?.value
  if (!openSessionCookie(value)) return null
  return findSession(getDb(), value)
}

/** The signed-in user behind the request's cookie, or null. */
export async function sessionUserFromRequest(req: NextRequest): Promise<SessionUser | null> {
  return (await sessionFromRequest(req))?.user ?? null
}

/**
 * Sets the session cookie on a reply. The browser keeps it until `expiresAt`
 * (the session's current expiry), and never longer than 30 days from now.
 */
export function setSessionCookie(res: NextResponse, req: NextRequest, value: string, expiresAt: Date): void {
  const seconds = Math.floor((expiresAt.getTime() - Date.now()) / 1000)
  const maxAge = Math.max(0, Math.min(SESSION_COOKIE_MAX_AGE_SECONDS, seconds))
  res.cookies.set(SESSION_COOKIE, value, authCookieOptions(req, maxAge))
}

/** Clears the old site-password cookie, when the browser still sends one. */
export function clearLegacySiteCookie(res: NextResponse, req: NextRequest): void {
  if (req.cookies.has(SITE_COOKIE)) res.cookies.set(SITE_COOKIE, '', authCookieOptions(req, 0))
}

/** Clears the session cookie and the old site-password cookie on this device. */
export function clearAuthCookies(res: NextResponse, req: NextRequest): void {
  res.cookies.set(SESSION_COOKIE, '', authCookieOptions(req, 0))
  res.cookies.set(SITE_COOKIE, '', authCookieOptions(req, 0))
}

/**
 * Sets the request's own session cookie again with a fresh 30-day lifetime,
 * so the browser keeps it as long as the database does (the session slides
 * forward on use). Skipped when the reply already sets or clears the cookie
 * (sign-in, sign-out, a password change) and for replies whose headers cannot
 * change (a redirect, a stream that is not a NextResponse).
 */
export function refreshSessionCookie(res: Response, req: NextRequest): void {
  const value = req.cookies.get(SESSION_COOKIE)?.value
  if (!value || !(res instanceof NextResponse)) return
  try {
    if (res.cookies.get(SESSION_COOKIE) !== undefined) return
    res.cookies.set(SESSION_COOKIE, value, authCookieOptions(req, SESSION_COOKIE_MAX_AGE_SECONDS))
  } catch {
    // Headers that cannot change: the next reply will refresh the cookie.
  }
}
