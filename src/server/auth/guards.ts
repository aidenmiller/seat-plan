import 'server-only'
import { createHash, timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { json, notFound } from '../api-route'
import { runAfterResponse } from '../after-response'
import { getDb } from '../db/client'
import { recordEvent } from '../repo/activity'
import { touchSession, type SessionLookup } from '../repo/sessions'
import {
  effectiveRole,
  needsAdminPower,
  roleAtLeast,
  weddingAccess,
  type Role,
  type SessionUser,
  type WeddingAccess,
} from './access'
import { isUnsafeMethod, userHeaderMatches } from './origin'
import type { TemplateResolver, WeddingResolver } from './resolvers'
import { refreshSessionCookie, sessionFromRequest } from './session'
import { requireTemplate, type TemplateAccess, type Viewer } from './venue-access'

/**
 * Wrappers for route handlers. Each one checks who is asking before the
 * handler runs, and tags the handler with its policy (AUTH_POLICY) so a test
 * can read every route's policy without calling it.
 *
 * Every wrapper but publicRoute and withCronSecret (which takes no session,
 * only the cron secret), in this order:
 *  1. The session cookie: none, forged, expired, or a disabled user answers
 *     401 { error: 'unauthorized' }, the reply the proxy gives too. A missing
 *     or forged cookie is answered before the database is touched.
 *  2. On a change sent by a browser page (any method but GET, HEAD or
 *     OPTIONS, with an Origin header), the page must send the signed-in
 *     user's id in x-seat-plan-user; otherwise 401 { error: 'stale_page' }.
 *     That catches a tab left open from before someone else signed in on
 *     this browser, and another site's forms and scripts, which cannot add
 *     the header.
 * Then each wrapper's own checks. After the reply, the session is touched
 * (at most every 10 minutes) and the browser's cookie lifetime renewed with it.
 *
 * A non-member gets 404 for a wedding, never 403, so they cannot tell it
 * exists. A member whose role is too low gets 403 { error: 'forbidden' }.
 */

export type { Role, SessionUser, WeddingAccess } from './access'

export const AUTH_POLICY: unique symbol = Symbol.for('seat-plan.auth-policy')

export type AuthPolicy =
  | { kind: 'public'; reason: string }
  | { kind: 'user' }
  | { kind: 'admin' }
  | { kind: 'share' }
  | { kind: 'cron' }
  | { kind: 'wedding'; minRole: Role; resolver: string }
  | { kind: 'venue'; mode: 'list' | 'read' | 'write' | 'create' }

export type Guarded<Ctx> = ((req: NextRequest, ctx: Ctx) => Promise<Response>) & { readonly [AUTH_POLICY]: AuthPolicy }

type MaybePromise<T> = T | Promise<T>

/**
 * Marks a handler with its policy. Exported for the one wrapper that lives
 * elsewhere, withShareAuth (share.ts); routes use the wrappers below.
 */
export function tagPolicy<Ctx>(policy: AuthPolicy, handler: (req: NextRequest, ctx: Ctx) => Promise<Response>): Guarded<Ctx> {
  Object.defineProperty(handler, AUTH_POLICY, { value: Object.freeze({ ...policy }), enumerable: false, writable: false })
  return handler as Guarded<Ctx>
}

/** The policy a handler was wrapped with, or null for a handler no wrapper made. */
export function policyOf(handler: unknown): AuthPolicy | null {
  if (typeof handler !== 'function') return null
  return (handler as { [AUTH_POLICY]?: AuthPolicy })[AUTH_POLICY] ?? null
}

/** No session, or one that has ended: the reply every signed-in route gives. */
export function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
}

export function stalePage(): Response {
  return json({ error: 'stale_page' }, 401)
}

export function forbidden(): Response {
  return json({ error: 'forbidden' }, 403)
}

type Signed = { ok: true; session: SessionLookup } | { ok: false; response: Response }

/** Steps 1 and 2 above. */
async function signedIn(req: NextRequest): Promise<Signed> {
  const session = await sessionFromRequest(req)
  if (!session) return { ok: false, response: unauthorized() }
  if (isUnsafeMethod(req.method) && req.headers.get('origin') !== null && !userHeaderMatches(req, session.user.id)) {
    return { ok: false, response: stalePage() }
  }
  return { ok: true, session }
}

/** After a reply to a signed-in request: renew the cookie and touch the session when due. */
async function afterSignedIn(req: NextRequest, session: SessionLookup, res: Response): Promise<Response> {
  if (session.touchDue) {
    refreshSessionCookie(res, req)
    await runAfterResponse(() => touchSession(getDb(), session.user))
  }
  return res
}

/** A route anyone may call. The reason is required, so each exception is written down. */
export function publicRoute<Ctx>(reason: string, handler: (req: NextRequest, ctx: Ctx) => MaybePromise<Response>): Guarded<Ctx> {
  if (!reason.trim()) throw new Error('publicRoute needs a reason')
  return tagPolicy({ kind: 'public', reason }, async (req, ctx) => handler(req, ctx))
}

/** The shortest CRON_SECRET the cron route accepts (the production build also insists on letters and digits only). */
export const CRON_SECRET_MIN_LENGTH = 32

/**
 * True when the Authorization header is exactly "Bearer <CRON_SECRET>". False
 * when CRON_SECRET is unset or shorter than CRON_SECRET_MIN_LENGTH, whatever
 * is sent. The two are compared as SHA-256 digests with timingSafeEqual, so
 * the time taken says nothing about the secret, not even its length.
 */
export function cronSecretMatches(authorization: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < CRON_SECRET_MIN_LENGTH || authorization === null) return false
  const sent = createHash('sha256').update(authorization, 'utf8').digest()
  const expected = createHash('sha256').update(`Bearer ${secret}`, 'utf8').digest()
  return timingSafeEqual(sent, expected)
}

/**
 * Vercel Cron only: the request must carry Authorization: Bearer <CRON_SECRET>
 * (Vercel sends it on every cron call when the variable is set). Decided
 * before anything else, the database included; a session cookie counts for
 * nothing here. Anything else gets the same 401 as a signed-out request.
 */
export function withCronSecret<Ctx>(handler: (req: NextRequest, ctx: Ctx) => MaybePromise<Response>): Guarded<Ctx> {
  return tagPolicy({ kind: 'cron' }, async (req, ctx) => {
    if (!cronSecretMatches(req.headers.get('authorization'), process.env.CRON_SECRET)) return unauthorized()
    return handler(req, ctx)
  })
}

/** Any signed-in user. */
export function withUser<Ctx>(handler: (req: NextRequest, ctx: Ctx, user: SessionUser) => MaybePromise<Response>): Guarded<Ctx> {
  return tagPolicy({ kind: 'user' }, async (req, ctx) => {
    const signed = await signedIn(req)
    if (!signed.ok) return signed.response
    const res = await handler(req, ctx, signed.session.user)
    return afterSignedIn(req, signed.session, res)
  })
}

/**
 * Admins only. Anyone else gets 404, as admin pages do (notFound), so the
 * admin routes look the same as routes that do not exist.
 */
export function withAdmin<Ctx>(handler: (req: NextRequest, ctx: Ctx, user: SessionUser) => MaybePromise<Response>): Guarded<Ctx> {
  return tagPolicy({ kind: 'admin' }, async (req, ctx) => {
    const signed = await signedIn(req)
    if (!signed.ok) return signed.response
    if (!signed.session.user.isAdmin) return notFound()
    const res = await handler(req, ctx, signed.session.user)
    return afterSignedIn(req, signed.session, res)
  })
}

/** The UTC day, for the once-a-day key on an admin's reads. */
function utcDay(now = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/**
 * Records an admin opening or changing a wedding through their admin power.
 * Every change is logged; reads once a day per admin per wedding.
 */
async function recordAdminAccess(req: NextRequest, access: WeddingAccess, resolver: string): Promise<void> {
  const write = isUnsafeMethod(req.method)
  await runAfterResponse(() =>
    recordEvent(getDb(), {
      kind: 'admin_access',
      userId: access.user.id,
      weddingId: access.weddingId,
      detail: { method: req.method, path: req.nextUrl.pathname.slice(0, 200), resolver, write },
      dedupeKey: write ? null : `admin_access:${access.user.id}:${access.weddingId}:${utcDay()}`,
    }),
  )
}

/**
 * A member of the wedding the resolver finds, with at least `minRole`, or an
 * admin. After steps 1 and 2: the resolver finds no wedding → 404; the wedding
 * is deleted or the caller is not a member (and not an admin) → 404; the role
 * is too low → 403. An admin who gets in only through their admin power is
 * logged (admin_access).
 */
export function withWeddingRole<Ctx>(
  resolver: WeddingResolver<Ctx>,
  minRole: Role,
  handler: (req: NextRequest, ctx: Ctx, access: WeddingAccess) => MaybePromise<Response>,
): Guarded<Ctx> {
  return tagPolicy({ kind: 'wedding', minRole, resolver: resolver.name }, async (req, ctx) => {
    const signed = await signedIn(req)
    if (!signed.ok) return signed.response
    const { user } = signed.session
    const db = getDb()
    const weddingId = await resolver.resolve(req, ctx, db)
    if (!weddingId) return notFound()
    const found = await weddingAccess(db, user, weddingId)
    if (!found) return notFound()
    if (!roleAtLeast(effectiveRole(found.role, user.isAdmin), minRole)) return forbidden()
    const access: WeddingAccess = { ...found, viaAdmin: needsAdminPower(found.role, user.isAdmin, minRole) }
    // Logged before the handler runs, so an attempt that fails part way is still on record.
    if (access.viaAdmin) await recordAdminAccess(req, access, resolver.name)
    const res = await handler(req, ctx, access)
    return afterSignedIn(req, signed.session, res)
  })
}

export type VenueAccess = { user: SessionUser; viewer: Viewer }
export type VenueTemplateAccess = VenueAccess & { templateId: string; template: TemplateAccess }

/**
 * Venue template routes. 'list' and 'create' need only a signed-in user (the
 * handler filters with readableTemplateSql, and new templates belong to their
 * maker). 'read' and 'write' look the template up through the resolver: 404
 * when the caller cannot read it, 403 when they can read but not change it.
 */
export function withVenueAccess<Ctx>(
  mode: 'list' | 'create',
  resolver: null,
  handler: (req: NextRequest, ctx: Ctx, access: VenueAccess) => MaybePromise<Response>,
): Guarded<Ctx>
export function withVenueAccess<Ctx>(
  mode: 'read' | 'write',
  resolver: TemplateResolver<Ctx>,
  handler: (req: NextRequest, ctx: Ctx, access: VenueTemplateAccess) => MaybePromise<Response>,
): Guarded<Ctx>
export function withVenueAccess<Ctx>(
  mode: 'list' | 'create' | 'read' | 'write',
  resolver: TemplateResolver<Ctx> | null,
  handler: (req: NextRequest, ctx: Ctx, access: VenueTemplateAccess) => MaybePromise<Response>,
): Guarded<Ctx> {
  return tagPolicy({ kind: 'venue', mode }, async (req, ctx) => {
    const signed = await signedIn(req)
    if (!signed.ok) return signed.response
    const { user } = signed.session
    const viewer: Viewer = { userId: user.id, isAdmin: user.isAdmin }
    let res: Response
    if (mode === 'list' || mode === 'create') {
      res = await (handler as (req: NextRequest, ctx: Ctx, access: VenueAccess) => MaybePromise<Response>)(req, ctx, { user, viewer })
    } else {
      const templateId = resolver ? await resolver.resolve(req, ctx) : null
      if (!templateId) return notFound()
      const checked = await requireTemplate(getDb(), viewer, templateId, mode === 'write' ? 'edit' : 'read')
      if (!checked.ok) return checked.response
      res = await handler(req, ctx, { user, viewer, templateId, template: checked.access })
    }
    return afterSignedIn(req, signed.session, res)
  })
}
