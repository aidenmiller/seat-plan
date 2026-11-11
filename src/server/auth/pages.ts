import 'server-only'
import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { cache } from 'react'
import { runAfterResponse } from '../after-response'
import { getDb } from '../db/client'
import { recordEvent } from '../repo/activity'
import { findSession, touchSession } from '../repo/sessions'
import { effectiveRole, needsAdminPower, roleAtLeast, weddingAccess, type Role, type SessionUser, type WeddingAccess } from './access'
import { safeNextPath } from './paths'
import { SESSION_COOKIE, openSessionCookie } from './tokens'
import { templateAccess, type TemplateAccess } from './venue-access'

/**
 * The checks for pages (server components). A layout's check does not stop
 * its pages from rendering (Next.js docs, "Layouts and auth checks"), so each
 * page calls one of these itself. Signed-out visitors go to /login with a
 * `next` back to the page; anyone signed in who may not see the page gets the
 * 404 page, so a wedding or template they cannot open looks like one that
 * does not exist.
 *
 * getSessionUser is wrapped in React's cache, so a page and its components
 * share one lookup per render. Pages cannot set cookies, so the session is
 * touched here (after the render) but the browser cookie is renewed only by
 * the API routes and, later, the proxy.
 */

export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const value = (await cookies()).get(SESSION_COOKIE)?.value
  if (!openSessionCookie(value)) return null
  const found = await findSession(getDb(), value)
  if (!found) return null
  if (found.touchDue) await runAfterResponse(() => touchSession(getDb(), found.user))
  return found.user
})

function loginPath(nextPath: string): string {
  const next = safeNextPath(nextPath)
  return next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`
}

/** The signed-in user, or a redirect to /login that comes back here. */
export async function requireUser(nextPath: string): Promise<SessionUser> {
  const user = await getSessionUser()
  if (!user) redirect(loginPath(nextPath))
  return user
}

/** Admin pages: anyone else gets the 404 page. */
export async function requireAdminPage(nextPath: string): Promise<SessionUser> {
  const user = await requireUser(nextPath)
  if (!user.isAdmin) notFound()
  return user
}

/**
 * Wedding pages: a member with at least `minRole`, or an admin (logged once a
 * day per wedding). A missing or deleted wedding, a non-member, or a role
 * that is too low all get the 404 page.
 */
export async function requireWeddingPage(weddingId: string, nextPath: string, minRole: Role = 'editor'): Promise<WeddingAccess> {
  const user = await requireUser(nextPath)
  const db = getDb()
  const found = await weddingAccess(db, user, weddingId)
  if (!found || !roleAtLeast(effectiveRole(found.role, user.isAdmin), minRole)) notFound()
  const access: WeddingAccess = { ...found, viaAdmin: needsAdminPower(found.role, user.isAdmin, minRole) }
  if (access.viaAdmin) {
    const day = new Date().toISOString().slice(0, 10)
    await runAfterResponse(() =>
      recordEvent(getDb(), {
        kind: 'admin_access',
        userId: user.id,
        weddingId: access.weddingId,
        detail: { method: 'GET', path: nextPath.slice(0, 200), page: true, write: false },
        dedupeKey: `admin_access:${user.id}:${access.weddingId}:${day}`,
      }),
    )
  }
  return access
}

/** Template pages: anyone who may read the template (see venue-access.ts); everyone else gets the 404 page. */
export async function requireVenuePage(
  templateId: string,
  nextPath: string,
): Promise<{ user: SessionUser; templateId: string; template: TemplateAccess }> {
  const user = await requireUser(nextPath)
  const template = await templateAccess(getDb(), { userId: user.id, isAdmin: user.isAdmin }, templateId)
  if (!template || !template.read) notFound()
  return { user, templateId: templateId.toLowerCase(), template }
}
