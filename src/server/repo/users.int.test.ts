/**
 * Users against the test database: making accounts, the sign-in lookup,
 * changing a password, and turning accounts off and on.
 */
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { makeTestDb, truncateAll } from '../../../test/db'
import { TEST_PASSWORD, makeMember, makeUser } from '../../../test/auth'
import { verifyUserPassword } from '../auth/passwords'
import { invites, passwordResets, users } from '../db/schema'
import { createInvite } from './invites'
import { createResetLink, lookupReset } from './password-resets'
import { createSession, lookupSession } from './sessions'
import { makeWedding } from './test-fixtures'
import {
  changePassword,
  countUsers,
  createUser,
  findLoginCandidate,
  getUserDto,
  listUsersForAdmin,
  setUserDisabled,
  updateDisplayName,
} from './users'

const { pool, db } = makeTestDb()

beforeEach(async () => {
  await truncateAll(pool)
})
afterAll(async () => {
  await pool.end()
})

async function userRow(userId: string) {
  const [row] = await db.select().from(users).where(eq(users.id, userId))
  return row!
}

async function storedHash(userId: string) {
  return (await userRow(userId)).passwordHash
}

describe('createUser', () => {
  it('stores the email trimmed and lower case, and the password as argon2id', async () => {
    const result = await createUser(db, { email: '  Pat@Example.COM ', displayName: ' Pat Lee ', password: TEST_PASSWORD })
    expect(result.status).toBe('created')
    if (result.status !== 'created') return
    expect(result.user).toEqual({
      id: expect.any(String),
      email: 'pat@example.com',
      displayName: 'Pat Lee',
      isAdmin: false,
      disabled: false,
      createdAt: expect.any(String),
    })
    const hash = await storedHash(result.user.id)
    expect(hash).toMatch(/^\$argon2id\$/)
    expect(await verifyUserPassword(hash, TEST_PASSWORD)).toBe(true)
  })

  it('answers email-taken for the same address in any case', async () => {
    await makeUser(db, { email: 'pat@example.com' })
    expect(await createUser(db, { email: 'PAT@example.com', displayName: 'Pat', password: TEST_PASSWORD })).toEqual({
      status: 'email-taken',
    })
    expect(await countUsers(db)).toBe(1)
  })

  it('refuses input the routes should have caught', async () => {
    await expect(createUser(db, { email: 'not an email', displayName: 'Pat', password: TEST_PASSWORD })).rejects.toThrow()
    await expect(createUser(db, { email: 'a@example.com', displayName: '  ', password: TEST_PASSWORD })).rejects.toThrow()
    await expect(createUser(db, { email: 'a@example.com', displayName: 'Pat', password: 'short' })).rejects.toThrow()
    expect(await countUsers(db)).toBe(0)
  })
})

describe('reading users', () => {
  it('finds the sign-in candidate by email in any case, with the hash', async () => {
    const user = await makeUser(db, { email: 'pat@example.com' })
    const candidate = await findLoginCandidate(db, ' PAT@example.com')
    expect(candidate).toEqual({ id: user.id, passwordHash: await storedHash(user.id), disabled: false })
    expect(await findLoginCandidate(db, 'nobody@example.com')).toBeNull()
    expect(await findLoginCandidate(db, 'not an email')).toBeNull()
  })

  it('never hands out the hash anywhere else', async () => {
    const user = await makeUser(db, { isAdmin: true })
    const hash = await storedHash(user.id)
    const dto = await getUserDto(db, user.id)
    expect(dto).toEqual({ id: user.id, email: user.email, displayName: 'Pat', isAdmin: true, disabled: false, createdAt: expect.any(String) })
    expect(JSON.stringify(dto)).not.toContain(hash)
    expect(JSON.stringify(await listUsersForAdmin(db))).not.toContain(hash)
    expect(JSON.stringify(await updateDisplayName(db, user.id, 'Pat B'))).not.toContain(hash)
    expect(await getUserDto(db, '00000000-0000-4000-8000-000000000000')).toBeNull()
  })

  it('lists users for the admin page with their live wedding count', async () => {
    const a = await makeUser(db, { displayName: 'Ann' })
    const b = await makeUser(db, { displayName: 'Ben', disabled: true })
    const [w1, w2, gone] = [await makeWedding(db), await makeWedding(db), await makeWedding(db)]
    await makeMember(db, w1, a.id, 'owner')
    await makeMember(db, w2, a.id, 'editor')
    await makeMember(db, gone, a.id, 'owner')
    await pool.query(`update weddings set deleted_at = now() where id = $1`, [gone])
    const list = await listUsersForAdmin(db)
    expect(list.map((u) => [u.displayName, u.weddingCount, u.disabled])).toEqual([
      ['Ann', 2, false],
      ['Ben', 0, true],
    ])
    expect(list[1]!.disabledAt).not.toBeNull()
    expect(b.disabled).toBe(true)
  })

  it('renames, trimming, and refuses a blank name', async () => {
    const user = await makeUser(db)
    expect((await updateDisplayName(db, user.id, '  Pat Lee  '))!.displayName).toBe('Pat Lee')
    await expect(updateDisplayName(db, user.id, ' ')).rejects.toThrow()
    expect(await updateDisplayName(db, '00000000-0000-4000-8000-000000000000', 'X')).toBeNull()
  })
})

describe('changePassword', () => {
  it('refuses a wrong current password and changes nothing', async () => {
    const user = await makeUser(db)
    const s = await createSession(db, user.id)
    const before = await storedHash(user.id)
    expect(await changePassword(db, user.id, 'wrong password', 'a brand new password')).toBe('wrong-password')
    expect(await storedHash(user.id)).toBe(before)
    expect(await lookupSession(db, s.cookieValue)).not.toBeNull()
  })

  it('sets the new password, ends every session and cancels reset links', async () => {
    const user = await makeUser(db)
    const [s1, s2] = [await createSession(db, user.id), await createSession(db, user.id)]
    const reset = (await createResetLink(db, user.id, null))!
    const before = (await userRow(user.id)).passwordChangedAt
    expect(await changePassword(db, user.id, TEST_PASSWORD, 'a brand new password')).toBe('ok')
    const hash = await storedHash(user.id)
    expect(await verifyUserPassword(hash, 'a brand new password')).toBe(true)
    expect(await verifyUserPassword(hash, TEST_PASSWORD)).toBe(false)
    expect(await lookupSession(db, s1.cookieValue)).toBeNull()
    expect(await lookupSession(db, s2.cookieValue)).toBeNull()
    expect((await lookupReset(db, reset.token))!.state).toBe('expired')
    expect((await userRow(user.id)).passwordChangedAt.getTime()).toBeGreaterThan(before.getTime())
  })

  it('lets only one of two changes at once win', async () => {
    const user = await makeUser(db)
    const results = await Promise.all([
      changePassword(db, user.id, TEST_PASSWORD, 'first new password'),
      changePassword(db, user.id, TEST_PASSWORD, 'second new password'),
    ])
    expect(results.filter((r) => r === 'ok')).toHaveLength(1)
    const hash = await storedHash(user.id)
    const winner = results[0] === 'ok' ? 'first new password' : 'second new password'
    expect(await verifyUserPassword(hash, winner)).toBe(true)
  })

  it('answers wrong-password for a disabled or missing account', async () => {
    const user = await makeUser(db, { disabled: true })
    expect(await changePassword(db, user.id, TEST_PASSWORD, 'a brand new password')).toBe('wrong-password')
    expect(await changePassword(db, '00000000-0000-4000-8000-000000000000', TEST_PASSWORD, 'a brand new password')).toBe(
      'wrong-password',
    )
  })
})

describe('setUserDisabled', () => {
  it('will not turn off your own account, or someone who is not there', async () => {
    const admin = await makeUser(db, { isAdmin: true })
    expect(await setUserDisabled(db, admin.id, admin.id, true)).toBe('self')
    expect(await setUserDisabled(db, admin.id, '00000000-0000-4000-8000-000000000000', true)).toBe('not-found')
  })

  it('ends sessions, cancels unused invites and reset links; turning back on restores sign-in only', async () => {
    const admin = await makeUser(db, { isAdmin: true })
    const user = await makeUser(db)
    const weddingId = await makeWedding(db)
    await makeMember(db, weddingId, user.id, 'owner')
    const s = await createSession(db, user.id)
    const pending = await createInvite(db, { weddingId, role: 'editor', invitedBy: user.id })
    const used = await createInvite(db, { weddingId, role: 'editor', invitedBy: user.id })
    await db.update(invites).set({ acceptedAt: new Date() }).where(eq(invites.id, used.invite.id))
    const reset = (await createResetLink(db, user.id, admin.id))!

    expect(await setUserDisabled(db, admin.id, user.id, true)).toBe('ok')
    expect(await lookupSession(db, s.cookieValue)).toBeNull()
    expect((await findLoginCandidate(db, user.email))!.disabled).toBe(true)
    const rows = await db.select({ id: invites.id, revokedAt: invites.revokedAt }).from(invites)
    expect(rows.find((r) => r.id === pending.invite.id)!.revokedAt).not.toBeNull()
    expect(rows.find((r) => r.id === used.invite.id)!.revokedAt).toBeNull()
    expect((await lookupReset(db, reset.token))!.state).toBe('expired')

    // A second "off" keeps the first time.
    const offAt = (await userRow(user.id)).disabledAt
    expect(offAt).not.toBeNull()
    expect(await setUserDisabled(db, admin.id, user.id, true)).toBe('ok')
    expect((await userRow(user.id)).disabledAt).toEqual(offAt)

    expect(await setUserDisabled(db, admin.id, user.id, false)).toBe('ok')
    expect((await getUserDto(db, user.id))!.disabled).toBe(false)
    expect(await lookupSession(db, s.cookieValue)).toBeNull()
    const fresh = await createSession(db, user.id)
    expect(await lookupSession(db, fresh.cookieValue)).not.toBeNull()
    const after = await db.select({ revokedAt: invites.revokedAt }).from(invites).where(eq(invites.id, pending.invite.id))
    expect(after[0]!.revokedAt).not.toBeNull()
  })

  it('will not turn off the last admin who is on', async () => {
    const [a, b] = [await makeUser(db, { isAdmin: true }), await makeUser(db, { isAdmin: true })]
    expect(await setUserDisabled(db, a.id, b.id, true)).toBe('ok')
    // b is off; an admin who is off still cannot leave the site without a working admin.
    const c = await makeUser(db)
    expect(await setUserDisabled(db, c.id, a.id, true)).toBe('last-admin')
    expect((await getUserDto(db, a.id))!.disabled).toBe(false)
  })

  it('lets only one of two admins turn the other off at the same moment', async () => {
    for (let round = 0; round < 3; round++) {
      await truncateAll(pool)
      const [a, b] = [await makeUser(db, { isAdmin: true }), await makeUser(db, { isAdmin: true })]
      const results = await Promise.all([setUserDisabled(db, a.id, b.id, true), setUserDisabled(db, b.id, a.id, true)])
      expect(results.sort()).toEqual(['last-admin', 'ok'])
      const on = await db.execute<{ n: number }>(sql`select count(*)::int as n from users where is_admin and disabled_at is null`)
      expect(on.rows[0]!.n).toBe(1)
    }
  })

  it('leaves password resets by others alone', async () => {
    const admin = await makeUser(db, { isAdmin: true })
    const [user, other] = [await makeUser(db), await makeUser(db)]
    const theirs = (await createResetLink(db, other.id, admin.id))!
    await setUserDisabled(db, admin.id, user.id, true)
    expect((await lookupReset(db, theirs.token))!.state).toBe('ok')
    expect(await db.select().from(passwordResets)).toHaveLength(1)
  })
})
