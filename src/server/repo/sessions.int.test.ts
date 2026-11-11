/**
 * Sessions against the test database: what makes one count, the sliding and
 * hard expiry, the 10-minute touch, the per-user cap, and signing out.
 */
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { makeTestDb, truncateAll } from '../../../test/db'
import { makeUser } from '../../../test/auth'
import { hashOpaqueToken, newOpaqueToken, openSessionCookie, signSessionCookie } from '../auth/tokens'
import { sessions, users } from '../db/schema'
import {
  MAX_SESSIONS_PER_USER,
  cleanUserAgent,
  createSession,
  endSession,
  endUserSessions,
  findSession,
  listUserSessions,
  lookupSession,
  purgeExpiredSessions,
  touchSession,
} from './sessions'

const { pool, db } = makeTestDb()

beforeEach(async () => {
  await truncateAll(pool)
})
afterAll(async () => {
  await pool.end()
})

const DAY = 24 * 60 * 60 * 1000

async function sessionRow(id: string) {
  const [row] = await db.select().from(sessions).where(eq(sessions.id, id))
  return row
}

describe('createSession', () => {
  it('stores only the hash of the secret, and gives a cookie that signs the user in', async () => {
    const user = await makeUser(db, { displayName: 'Pat Lee', isAdmin: true })
    const s = await createSession(db, user.id, { userAgent: 'Firefox' })
    const opened = openSessionCookie(s.cookieValue)!
    const row = await sessionRow(s.sessionId)
    expect(row!.tokenHash).toBe(hashOpaqueToken(opened.secret))
    expect(JSON.stringify(row)).not.toContain(opened.secret)
    expect(row!.userAgent).toBe('Firefox')
    expect(await lookupSession(db, s.cookieValue)).toEqual({
      id: user.id,
      sessionId: s.sessionId,
      email: user.email,
      displayName: 'Pat Lee',
      isAdmin: true,
    })
  })

  it('lasts 30 days in the database, and the cookie carries the 365-day cap', async () => {
    const user = await makeUser(db)
    const before = Date.now()
    const s = await createSession(db, user.id)
    expect(s.expiresAt.getTime() - before).toBeGreaterThan(29.9 * DAY)
    expect(s.expiresAt.getTime() - before).toBeLessThan(30.1 * DAY)
    const exp = openSessionCookie(s.cookieValue)!.exp
    expect(exp - before).toBeGreaterThan(364.9 * DAY)
    expect(exp - before).toBeLessThan(365.1 * DAY)
  })

  it('makes a new session every time and notes the sign-in', async () => {
    const user = await makeUser(db)
    const a = await createSession(db, user.id)
    const b = await createSession(db, user.id)
    expect(a.sessionId).not.toBe(b.sessionId)
    expect(a.cookieValue).not.toBe(b.cookieValue)
    const [row] = await db.select({ lastLoginAt: users.lastLoginAt }).from(users).where(eq(users.id, user.id))
    expect(row!.lastLoginAt).not.toBeNull()
  })

  it(`keeps at most ${MAX_SESSIONS_PER_USER} per user, dropping the oldest`, async () => {
    const user = await makeUser(db)
    const other = await makeUser(db)
    const otherSession = await createSession(db, other.id)
    const made = []
    for (let i = 0; i < MAX_SESSIONS_PER_USER + 1; i++) made.push(await createSession(db, user.id))
    const left = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, user.id))
    expect(left).toHaveLength(MAX_SESSIONS_PER_USER)
    expect(left.map((r) => r.id)).not.toContain(made[0]!.sessionId)
    expect(await lookupSession(db, made[0]!.cookieValue)).toBeNull()
    expect(await lookupSession(db, made[1]!.cookieValue)).not.toBeNull()
    expect(await lookupSession(db, otherSession.cookieValue)).not.toBeNull()
  })

  it('keeps no IP address, and cuts the user agent to 200 characters', async () => {
    const user = await makeUser(db)
    const s = await createSession(db, user.id, { userAgent: `\u0000Mozilla ${'x'.repeat(300)}` })
    const row = await sessionRow(s.sessionId)
    expect(row!.userAgent).toHaveLength(200)
    expect(row!.userAgent!.startsWith('Mozilla ')).toBe(true)
    const columns = await db.execute<{ column_name: string }>(
      sql`select column_name from information_schema.columns where table_name = 'sessions'`,
    )
    expect(columns.rows.map((c) => c.column_name).filter((c) => /ip|addr/i.test(c))).toEqual([])
  })
})

describe('cleanUserAgent', () => {
  it('drops control characters and never splits an emoji', () => {
    expect(cleanUserAgent(null)).toBeNull()
    expect(cleanUserAgent('  \u0001 ')).toBeNull()
    expect(cleanUserAgent('a\tb\u007f')).toBe('ab')
    const cut = cleanUserAgent(`${'x'.repeat(199)}😀😀`)!
    expect(Array.from(cut)).toHaveLength(200)
    expect(cut.isWellFormed()).toBe(true)
  })
})

describe('lookupSession', () => {
  it('refuses a forged cookie, and a validly signed one with no row', async () => {
    const user = await makeUser(db)
    await createSession(db, user.id)
    expect(await lookupSession(db, 'forged')).toBeNull()
    expect(await lookupSession(db, null)).toBeNull()
    const unknown = signSessionCookie(newOpaqueToken(), Date.now() + DAY)
    expect(await lookupSession(db, unknown)).toBeNull()
  })

  it('refuses an expired session', async () => {
    const user = await makeUser(db)
    const s = await createSession(db, user.id)
    await db.update(sessions).set({ expiresAt: sql`now() - interval '1 second'` }).where(eq(sessions.id, s.sessionId))
    expect(await lookupSession(db, s.cookieValue)).toBeNull()
  })

  it('refuses a session past the 365-day cap even if its expiry says otherwise', async () => {
    const user = await makeUser(db)
    const s = await createSession(db, user.id)
    await db
      .update(sessions)
      .set({ createdAt: sql`now() - interval '366 days'`, expiresAt: sql`now() + interval '1 day'` })
      .where(eq(sessions.id, s.sessionId))
    expect(await lookupSession(db, s.cookieValue)).toBeNull()
  })

  it('refuses every session of a disabled user', async () => {
    const user = await makeUser(db)
    const s = await createSession(db, user.id)
    await db.update(users).set({ disabledAt: new Date() }).where(eq(users.id, user.id))
    expect(await lookupSession(db, s.cookieValue)).toBeNull()
    await db.update(users).set({ disabledAt: null }).where(eq(users.id, user.id))
    expect(await lookupSession(db, s.cookieValue)).not.toBeNull()
  })

  it('follows the database, not the cookie: a promoted user is an admin at once', async () => {
    const user = await makeUser(db)
    const s = await createSession(db, user.id)
    expect((await lookupSession(db, s.cookieValue))!.isAdmin).toBe(false)
    await db.update(users).set({ isAdmin: true, displayName: 'New Name' }).where(eq(users.id, user.id))
    expect(await lookupSession(db, s.cookieValue)).toMatchObject({ isAdmin: true, displayName: 'New Name' })
  })
})

describe('touchSession', () => {
  it('writes at most once every 10 minutes', async () => {
    const user = await makeUser(db)
    const s = await createSession(db, user.id)
    const found = (await findSession(db, s.cookieValue))!
    expect(found.touchDue).toBe(false)
    expect(await touchSession(db, found.user)).toBe(false)

    await db.update(sessions).set({ lastSeenAt: sql`now() - interval '9 minutes'` }).where(eq(sessions.id, s.sessionId))
    expect((await findSession(db, s.cookieValue))!.touchDue).toBe(false)
    expect(await touchSession(db, found.user)).toBe(false)

    await db
      .update(sessions)
      .set({ lastSeenAt: sql`now() - interval '11 minutes'`, expiresAt: sql`now() + interval '1 day'` })
      .where(eq(sessions.id, s.sessionId))
    await db.update(users).set({ lastSeenAt: null }).where(eq(users.id, user.id))
    expect((await findSession(db, s.cookieValue))!.touchDue).toBe(true)
    expect(await touchSession(db, found.user)).toBe(true)
    expect(await touchSession(db, found.user)).toBe(false)

    const row = await sessionRow(s.sessionId)
    expect(row!.expiresAt.getTime() - Date.now()).toBeGreaterThan(29.9 * DAY)
    expect(Date.now() - row!.lastSeenAt.getTime()).toBeLessThan(60_000)
    const [u] = await db.select({ lastSeenAt: users.lastSeenAt }).from(users).where(eq(users.id, user.id))
    expect(u!.lastSeenAt).not.toBeNull()
  })

  it('never moves the expiry past 365 days from sign-in', async () => {
    const user = await makeUser(db)
    const s = await createSession(db, user.id)
    await db
      .update(sessions)
      .set({ createdAt: sql`now() - interval '360 days'`, lastSeenAt: sql`now() - interval '1 hour'` })
      .where(eq(sessions.id, s.sessionId))
    expect(await touchSession(db, { sessionId: s.sessionId })).toBe(true)
    const row = await sessionRow(s.sessionId)
    // 365 calendar days in the database's time zone: within an hour of 365 * 24 hours across a clock change.
    expect(Math.abs(row!.expiresAt.getTime() - row!.createdAt.getTime() - 365 * DAY)).toBeLessThanOrEqual(3_600_000)
    expect(row!.expiresAt.getTime() - Date.now()).toBeLessThan(6 * DAY)
  })

  it('does not bring an expired session back', async () => {
    const user = await makeUser(db)
    const s = await createSession(db, user.id)
    await db
      .update(sessions)
      .set({ expiresAt: sql`now() - interval '1 second'`, lastSeenAt: sql`now() - interval '31 days'` })
      .where(eq(sessions.id, s.sessionId))
    expect(await touchSession(db, { sessionId: s.sessionId })).toBe(false)
    expect(await lookupSession(db, s.cookieValue)).toBeNull()
  })
})

describe('signing out', () => {
  it('endSession ends only the owner’s session', async () => {
    const [a, b] = [await makeUser(db), await makeUser(db)]
    const s = await createSession(db, a.id)
    expect(await endSession(db, s.sessionId, b.id)).toBe(false)
    expect(await lookupSession(db, s.cookieValue)).not.toBeNull()
    expect(await endSession(db, s.sessionId, a.id)).toBe(true)
    expect(await lookupSession(db, s.cookieValue)).toBeNull()
    expect(await endSession(db, s.sessionId, a.id)).toBe(false)
  })

  it('endUserSessions ends all, or all but one, and leaves other users alone', async () => {
    const [a, b] = [await makeUser(db), await makeUser(db)]
    const [a1, a2, a3] = [await createSession(db, a.id), await createSession(db, a.id), await createSession(db, a.id)]
    const b1 = await createSession(db, b.id)
    expect(await endUserSessions(db, a.id, { except: a2.sessionId })).toBe(2)
    expect(await lookupSession(db, a1.cookieValue)).toBeNull()
    expect(await lookupSession(db, a2.cookieValue)).not.toBeNull()
    expect(await lookupSession(db, a3.cookieValue)).toBeNull()
    expect(await endUserSessions(db, a.id)).toBe(1)
    expect(await lookupSession(db, a2.cookieValue)).toBeNull()
    expect(await lookupSession(db, b1.cookieValue)).not.toBeNull()
  })

  it('lists live sessions, most recently used first', async () => {
    const user = await makeUser(db)
    const older = await createSession(db, user.id, { userAgent: 'old' })
    const newer = await createSession(db, user.id, { userAgent: 'new' })
    const dead = await createSession(db, user.id, { userAgent: 'dead' })
    await db.update(sessions).set({ lastSeenAt: sql`now() - interval '1 hour'` }).where(eq(sessions.id, older.sessionId))
    await db.update(sessions).set({ expiresAt: sql`now() - interval '1 second'` }).where(eq(sessions.id, dead.sessionId))
    const list = await listUserSessions(db, user.id)
    expect(list.map((s) => s.id)).toEqual([newer.sessionId, older.sessionId])
    expect(list[0]).toEqual({
      id: newer.sessionId,
      userAgent: 'new',
      createdAt: expect.any(String),
      lastSeenAt: expect.any(String),
      expiresAt: expect.any(String),
    })
  })

  it('purges sessions that can no longer be used', async () => {
    const user = await makeUser(db)
    const live = await createSession(db, user.id)
    const expired = await createSession(db, user.id)
    const capped = await createSession(db, user.id)
    await db.update(sessions).set({ expiresAt: sql`now() - interval '1 second'` }).where(eq(sessions.id, expired.sessionId))
    await db.update(sessions).set({ createdAt: sql`now() - interval '366 days'` }).where(eq(sessions.id, capped.sessionId))
    expect(await purgeExpiredSessions(db)).toBe(2)
    expect((await db.select({ id: sessions.id }).from(sessions)).map((r) => r.id)).toEqual([live.sessionId])
  })
})
