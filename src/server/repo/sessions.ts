import 'server-only'
import { and, desc, eq, gt, lte, ne, or, sql } from 'drizzle-orm'
import { wellFormedText } from '@/domain/canvas-schema'
import type { SessionUser } from '../auth/access'
import { hashOpaqueToken, newOpaqueToken, openSessionCookie, signSessionCookie } from '../auth/tokens'
import { sessions, users } from '../db/schema'
import type { Db, Tx } from '../locks'

/**
 * Sign-in sessions. The cookie holds a random secret, signed; the database
 * holds only the secret's SHA-256, so a copy of the table cannot sign anyone
 * in. Nothing is trusted from the cookie itself: a session counts only while
 * its row exists, has not expired, and its user is not disabled.
 *
 * A session lasts 30 days from the last time it was used, and never more than
 * 365 days from sign-in. Use is written down at most once every 10 minutes per
 * session (touchSession), so reading pages does not write on every request.
 * No IP addresses are kept.
 */

/** A connection or a transaction: both run the same queries. */
type Conn = Db | Tx

export const SESSION_IDLE_DAYS = 30
export const SESSION_MAX_DAYS = 365
export const TOUCH_EVERY_MINUTES = 10
export const MAX_SESSIONS_PER_USER = 20
export const USER_AGENT_MAX = 200

const DAY_MS = 24 * 60 * 60 * 1000

/** The browser's user agent as stored: storable text, no control characters, at most 200 characters. */
export function cleanUserAgent(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null
  const cleaned = wellFormedText(userAgent).replace(/[\u0000-\u001f\u007f]/g, '').trim()
  if (!cleaned) return null
  // Cut by code points, so a cut never splits an emoji into a lone surrogate.
  return Array.from(cleaned).slice(0, USER_AGENT_MAX).join('')
}

export type NewSession = { cookieValue: string; expiresAt: Date; sessionId: string }

/**
 * Starts a session (every sign-in makes a new one) and returns the cookie
 * value. A user keeps at most 20 sessions: the oldest go first. Also notes the
 * sign-in time on the user.
 */
export async function createSession(db: Db, userId: string, opts: { userAgent?: string | null } = {}): Promise<NewSession> {
  const secret = newOpaqueToken()
  // Signed before the row is written, so a server without AUTH_SECRET throws
  // here and never leaves a session row behind that no cookie can name. The
  // cookie's own expiry is the hard cap; the row's expires_at is the real,
  // sliding one.
  const cookieValue = signSessionCookie(secret, Date.now() + SESSION_MAX_DAYS * DAY_MS)
  const row = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(sessions)
      .values({
        userId,
        tokenHash: hashOpaqueToken(secret),
        userAgent: cleanUserAgent(opts.userAgent),
        expiresAt: sql`now() + make_interval(days => ${SESSION_IDLE_DAYS})`,
      })
      .returning({ id: sessions.id, expiresAt: sessions.expiresAt })
    await tx.execute(sql`
      delete from sessions
      where user_id = ${userId}
        and id not in (
          select id from sessions where user_id = ${userId}
          order by created_at desc, id desc
          limit ${MAX_SESSIONS_PER_USER}
        )
    `)
    await tx.update(users).set({ lastLoginAt: sql`now()`, lastSeenAt: sql`now()` }).where(eq(users.id, userId))
    return created!
  })
  return { cookieValue, expiresAt: row.expiresAt, sessionId: row.id }
}

export type SessionLookup = {
  user: SessionUser
  /** The last recorded use is more than 10 minutes old: touchSession would write. */
  touchDue: boolean
}

/**
 * The session behind a cookie, with its user. The signature is checked first,
 * so a missing or forged cookie never reaches the database.
 */
export async function findSession(db: Conn, cookieValue: string | null | undefined): Promise<SessionLookup | null> {
  const opened = openSessionCookie(cookieValue)
  if (!opened) return null
  const result = await db.execute<{
    session_id: string
    user_id: string
    email: string
    display_name: string
    is_admin: boolean
    touch_due: boolean
  }>(sql`
    select s.id as session_id, u.id as user_id, u.email, u.display_name, u.is_admin,
      s.last_seen_at < now() - make_interval(mins => ${TOUCH_EVERY_MINUTES}) as touch_due
    from sessions s
    join users u on u.id = s.user_id
    where s.token_hash = ${hashOpaqueToken(opened.secret)}
      and s.expires_at > now()
      and s.created_at > now() - make_interval(days => ${SESSION_MAX_DAYS})
      and u.disabled_at is null
  `)
  const row = result.rows[0]
  if (!row) return null
  return {
    user: { id: row.user_id, sessionId: row.session_id, email: row.email, displayName: row.display_name, isAdmin: row.is_admin },
    touchDue: row.touch_due,
  }
}

/** The signed-in user behind a cookie, or null. */
export async function lookupSession(db: Conn, cookieValue: string | null | undefined): Promise<SessionUser | null> {
  return (await findSession(db, cookieValue))?.user ?? null
}

/**
 * Notes that the session was just used: moves its expiry to 30 days from now
 * (never past 365 days from sign-in) and the user's last-seen time. Writes at
 * most once every 10 minutes per session; true when it wrote.
 */
export async function touchSession(db: Conn, user: Pick<SessionUser, 'sessionId'>): Promise<boolean> {
  const result = await db.execute<{ user_id: string }>(sql`
    with touched as (
      update sessions set
        last_seen_at = now(),
        expires_at = least(now() + make_interval(days => ${SESSION_IDLE_DAYS}), created_at + make_interval(days => ${SESSION_MAX_DAYS}))
      where id = ${user.sessionId}
        and last_seen_at < now() - make_interval(mins => ${TOUCH_EVERY_MINUTES})
        and expires_at > now()
      returning user_id
    )
    update users set last_seen_at = now()
    where id in (select user_id from touched)
    returning id as user_id
  `)
  return result.rows.length > 0
}

/** Signs one session out. `userId` must own it, so a user can only end their own. False when there was none. */
export async function endSession(db: Conn, sessionId: string, userId: string): Promise<boolean> {
  const deleted = await db
    .delete(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
    .returning({ id: sessions.id })
  return deleted.length > 0
}

/** Signs a user out everywhere, or everywhere but `except`. Returns how many sessions ended. */
export async function endUserSessions(db: Conn, userId: string, opts: { except?: string } = {}): Promise<number> {
  const deleted = await db
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), opts.except ? ne(sessions.id, opts.except) : undefined))
    .returning({ id: sessions.id })
  return deleted.length
}

export type SessionInfo = { id: string; userAgent: string | null; createdAt: string; lastSeenAt: string; expiresAt: string }

/** A user's live sessions, most recently used first. */
export async function listUserSessions(db: Conn, userId: string): Promise<SessionInfo[]> {
  const rows = await db
    .select({
      id: sessions.id,
      userAgent: sessions.userAgent,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, sql`now()`)))
    .orderBy(desc(sessions.lastSeenAt), desc(sessions.id))
  return rows.map((r) => ({
    id: r.id,
    userAgent: r.userAgent,
    createdAt: r.createdAt.toISOString(),
    lastSeenAt: r.lastSeenAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
  }))
}

/** Deletes sessions that can no longer be used. Returns how many went. */
export async function purgeExpiredSessions(db: Conn): Promise<number> {
  const deleted = await db
    .delete(sessions)
    .where(
      or(
        lte(sessions.expiresAt, sql`now()`),
        lte(sessions.createdAt, sql`now() - make_interval(days => ${SESSION_MAX_DAYS})`),
      ),
    )
    .returning({ id: sessions.id })
  return deleted.length
}
