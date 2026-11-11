/**
 * Reset links against the test database: one use only, every session ended,
 * and only the newest link working.
 */
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { makeTestDb, truncateAll } from '../../../test/db'
import { TEST_PASSWORD, makeUser } from '../../../test/auth'
import { verifyUserPassword } from '../auth/passwords'
import { hashOpaqueToken } from '../auth/tokens'
import { passwordResets, users } from '../db/schema'
import { completeReset, createResetLink, lookupReset } from './password-resets'
import { createSession, lookupSession } from './sessions'

const { pool, db } = makeTestDb()

beforeEach(async () => {
  await truncateAll(pool)
})
afterAll(async () => {
  await pool.end()
})

async function hashOf(userId: string) {
  const [row] = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, userId))
  return row!.hash
}

describe('createResetLink and lookupReset', () => {
  it('returns a token once, stores its hash, and lasts 24 hours', async () => {
    const [admin, user] = [await makeUser(db, { isAdmin: true }), await makeUser(db, { displayName: 'Pat' })]
    const link = (await createResetLink(db, user.id, admin.id))!
    expect(link.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const [row] = await db.select().from(passwordResets)
    expect(row!.tokenHash).toBe(hashOpaqueToken(link.token))
    expect(row!.createdByUserId).toBe(admin.id)
    expect(JSON.stringify(row)).not.toContain(link.token)
    const hours = (link.expiresAt.getTime() - Date.now()) / 3_600_000
    expect(hours).toBeGreaterThan(23.9)
    expect(hours).toBeLessThan(24.1)
    expect(await lookupReset(db, link.token)).toEqual({
      userId: user.id,
      email: user.email,
      displayName: 'Pat',
      state: 'ok',
      expiresAt: link.expiresAt.toISOString(),
    })
    expect(await lookupReset(db, 'x'.repeat(43))).toBeNull()
    expect(await lookupReset(db, 'bad')).toBeNull()
  })

  it('is null for a user who is not there', async () => {
    expect(await createResetLink(db, '00000000-0000-4000-8000-000000000000', null)).toBeNull()
  })

  it('cancels the earlier unused links for that user only', async () => {
    const [user, other] = [await makeUser(db), await makeUser(db)]
    const first = (await createResetLink(db, user.id, null))!
    const theirs = (await createResetLink(db, other.id, null))!
    const second = (await createResetLink(db, user.id, null))!
    expect((await lookupReset(db, first.token))!.state).toBe('expired')
    expect((await lookupReset(db, second.token))!.state).toBe('ok')
    expect((await lookupReset(db, theirs.token))!.state).toBe('ok')
    expect(await completeReset(db, first.token, 'a brand new password')).toEqual({ status: 'expired' })
    expect(await verifyUserPassword(await hashOf(user.id), TEST_PASSWORD)).toBe(true)
  })
})

describe('completeReset', () => {
  it('sets the password, ends every session, and works once', async () => {
    const user = await makeUser(db)
    const [s1, s2] = [await createSession(db, user.id), await createSession(db, user.id)]
    const link = (await createResetLink(db, user.id, null))!
    expect(await completeReset(db, link.token, 'a brand new password')).toEqual({ status: 'ok', userId: user.id })
    const hash = await hashOf(user.id)
    expect(await verifyUserPassword(hash, 'a brand new password')).toBe(true)
    expect(await verifyUserPassword(hash, TEST_PASSWORD)).toBe(false)
    expect(await lookupSession(db, s1.cookieValue)).toBeNull()
    expect(await lookupSession(db, s2.cookieValue)).toBeNull()
    expect((await lookupReset(db, link.token))!.state).toBe('used')
    expect(await completeReset(db, link.token, 'another new password')).toEqual({ status: 'used' })
    expect(await verifyUserPassword(await hashOf(user.id), 'a brand new password')).toBe(true)
  })

  it('refuses an expired or unknown link', async () => {
    const user = await makeUser(db)
    const link = (await createResetLink(db, user.id, null))!
    await db.update(passwordResets).set({ expiresAt: sql`now() - interval '1 second'` })
    expect(await completeReset(db, link.token, 'a brand new password')).toEqual({ status: 'expired' })
    expect(await completeReset(db, 'x'.repeat(43), 'a brand new password')).toEqual({ status: 'not-found' })
    expect(await completeReset(db, 'bad', 'a brand new password')).toEqual({ status: 'not-found' })
    expect(await verifyUserPassword(await hashOf(user.id), TEST_PASSWORD)).toBe(true)
  })

  it('lets exactly one of two tries at the same moment set a password', async () => {
    const user = await makeUser(db)
    const link = (await createResetLink(db, user.id, null))!
    const results = await Promise.all([
      completeReset(db, link.token, 'first new password'),
      completeReset(db, link.token, 'second new password'),
    ])
    expect(results.map((r) => r.status).sort()).toEqual(['ok', 'used'])
    const winner = results[0]!.status === 'ok' ? 'first new password' : 'second new password'
    expect(await verifyUserPassword(await hashOf(user.id), winner)).toBe(true)
  })

  it('refuses a password outside the limits without using the link up', async () => {
    const user = await makeUser(db)
    const link = (await createResetLink(db, user.id, null))!
    await expect(completeReset(db, link.token, 'short')).rejects.toThrow()
    expect((await lookupReset(db, link.token))!.state).toBe('ok')
  })
})
