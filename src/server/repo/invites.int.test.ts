/**
 * Invites against the test database: accepting once and only once, every
 * reason an invite is refused, never lowering a role, and registration that
 * rolls back whole.
 */
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestDb, truncateAll } from '../../../test/db'
import { TEST_PASSWORD, makeMember, makeUser } from '../../../test/auth'
import { verifyUserPassword } from '../auth/passwords'
import { hashOpaqueToken } from '../auth/tokens'
import { invites, users, weddingMembers, weddings } from '../db/schema'
import { acceptInvite, createInvite, listInvites, lookupInvite, registerWithInvite, revokeInvite } from './invites'
import { makeWedding } from './test-fixtures'

/** Lets one test make adding the member fail, to see registration roll back. */
const state = vi.hoisted(() => ({ failMembership: false }))
vi.mock('./members', async (importOriginal) => {
  const real = await importOriginal<typeof import('./members')>()
  return {
    ...real,
    addOrUpgradeMember: (...args: Parameters<typeof real.addOrUpgradeMember>) =>
      state.failMembership ? Promise.reject(new Error('membership failed')) : real.addOrUpgradeMember(...args),
  }
})

const { pool, db } = makeTestDb()

beforeEach(async () => {
  state.failMembership = false
  await truncateAll(pool)
})
afterAll(async () => {
  await pool.end()
})

async function roles(weddingId: string) {
  const rows = await db.select({ userId: weddingMembers.userId, role: weddingMembers.role }).from(weddingMembers).where(eq(weddingMembers.weddingId, weddingId))
  return Object.fromEntries(rows.map((r) => [r.userId, r.role]))
}

async function inviteRow(id: string) {
  const [row] = await db.select().from(invites).where(eq(invites.id, id))
  return row!
}

/** A wedding with an owner, who sends the invites. */
async function setup() {
  const weddingId = await makeWedding(db, 'Ann & Ben')
  const owner = await makeUser(db, { displayName: 'Olive' })
  await makeMember(db, weddingId, owner.id, 'owner')
  return { weddingId, owner }
}

const newAccount = (email = 'new@example.com') => ({ email, displayName: 'Newcomer', password: TEST_PASSWORD })

describe('createInvite and lookupInvite', () => {
  it('returns the token once and stores only its hash', async () => {
    const { weddingId, owner } = await setup()
    const { invite, token } = await createInvite(db, { weddingId, role: 'editor', email: ' Pat@Example.com ', note: ' For Pat ', invitedBy: owner.id })
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const row = await inviteRow(invite.id)
    expect(row.tokenHash).toBe(hashOpaqueToken(token))
    expect(JSON.stringify(row)).not.toContain(token)
    expect(invite).toEqual({
      id: row.id,
      weddingId,
      role: 'editor',
      email: 'pat@example.com',
      note: 'For Pat',
      invitedBy: { id: owner.id, name: 'Olive' },
      acceptedBy: null,
      state: 'pending',
      createdAt: expect.any(String),
      expiresAt: expect.any(String),
      acceptedAt: null,
    })
    const days = (row.expiresAt.getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(6.9)
    expect(days).toBeLessThan(7.1)
  })

  it('wants a wedding and a role together, or neither', async () => {
    const { weddingId, owner } = await setup()
    await expect(createInvite(db, { weddingId, invitedBy: owner.id })).rejects.toThrow()
    await expect(createInvite(db, { role: 'editor', invitedBy: owner.id })).rejects.toThrow()
    await expect(createInvite(db, { weddingId, role: 'editor', email: 'nope', invitedBy: owner.id })).rejects.toThrow()
  })

  it('shows what the invite page needs', async () => {
    const { weddingId, owner } = await setup()
    const { token } = await createInvite(db, { weddingId, role: 'owner', invitedBy: owner.id })
    expect(await lookupInvite(db, token)).toEqual({
      id: expect.any(String),
      weddingId,
      weddingName: 'Ann & Ben',
      role: 'owner',
      email: null,
      inviterName: 'Olive',
      status: 'ok',
      expiresAt: expect.any(String),
    })
    expect(await lookupInvite(db, 'x'.repeat(43))).toBeNull()
    expect(await lookupInvite(db, 'short')).toBeNull()
  })
})

describe('acceptInvite', () => {
  it('adds the member with the invited role, once', async () => {
    const { weddingId, owner } = await setup()
    const [pat, sam] = [await makeUser(db), await makeUser(db)]
    const { invite, token } = await createInvite(db, { weddingId, role: 'editor', invitedBy: owner.id })
    expect(await acceptInvite(db, token, pat)).toBe('ok')
    expect(await roles(weddingId)).toEqual({ [owner.id]: 'owner', [pat.id]: 'editor' })
    const row = await inviteRow(invite.id)
    expect(row.acceptedByUserId).toBe(pat.id)
    expect(row.acceptedAt).not.toBeNull()
    expect(await acceptInvite(db, token, sam)).toBe('used')
    expect(await acceptInvite(db, token, pat)).toBe('used')
    expect((await lookupInvite(db, token))!.status).toBe('used')
  })

  it('lets exactly one of two people accept at the same moment', async () => {
    for (let round = 0; round < 3; round++) {
      const { weddingId, owner } = await setup()
      const people = [await makeUser(db), await makeUser(db), await makeUser(db)]
      const { token } = await createInvite(db, { weddingId, role: 'editor', invitedBy: owner.id })
      const results = await Promise.all(people.map((p) => acceptInvite(db, token, p)))
      expect(results.filter((r) => r === 'ok')).toHaveLength(1)
      expect(results.filter((r) => r === 'used')).toHaveLength(2)
      expect(Object.keys(await roles(weddingId))).toHaveLength(2)
    }
  })

  it('refuses an expired or revoked invite', async () => {
    const { weddingId, owner } = await setup()
    const pat = await makeUser(db)
    const expired = await createInvite(db, { weddingId, role: 'editor', invitedBy: owner.id })
    await db.update(invites).set({ expiresAt: sql`now() - interval '1 second'` }).where(eq(invites.id, expired.invite.id))
    expect(await acceptInvite(db, expired.token, pat)).toBe('expired')
    expect((await lookupInvite(db, expired.token))!.status).toBe('expired')

    const revoked = await createInvite(db, { weddingId, role: 'editor', invitedBy: owner.id })
    expect(await revokeInvite(db, revoked.invite.id)).toBe(true)
    expect(await revokeInvite(db, revoked.invite.id)).toBe(false)
    expect(await acceptInvite(db, revoked.token, pat)).toBe('revoked')
    expect(await roles(weddingId)).toEqual({ [owner.id]: 'owner' })
    expect(await acceptInvite(db, 'x'.repeat(43), pat)).toBe('not-found')
    expect(await acceptInvite(db, 'bad', pat)).toBe('not-found')
  })

  it('keeps an email-locked invite for that email only, in any case', async () => {
    const { weddingId, owner } = await setup()
    const [pat, sam] = [await makeUser(db, { email: 'pat@example.com' }), await makeUser(db)]
    const { invite, token } = await createInvite(db, { weddingId, role: 'editor', email: 'PAT@example.com', invitedBy: owner.id })
    expect(await acceptInvite(db, token, sam)).toBe('email-mismatch')
    expect((await inviteRow(invite.id)).acceptedAt).toBeNull()
    expect(await acceptInvite(db, token, { id: pat.id, email: 'Pat@Example.COM' })).toBe('ok')
    expect(await roles(weddingId)).toEqual({ [owner.id]: 'owner', [pat.id]: 'editor' })
  })

  it('refuses an invite to a deleted wedding without using it up', async () => {
    const { weddingId, owner } = await setup()
    const pat = await makeUser(db)
    const { invite, token } = await createInvite(db, { weddingId, role: 'editor', invitedBy: owner.id })
    await db.update(weddings).set({ deletedAt: new Date() }).where(eq(weddings.id, weddingId))
    expect(await acceptInvite(db, token, pat)).toBe('wedding-gone')
    expect((await lookupInvite(db, token))).toMatchObject({ status: 'wedding-gone', weddingName: null })
    expect((await inviteRow(invite.id)).acceptedAt).toBeNull()
    expect(await roles(weddingId)).toEqual({ [owner.id]: 'owner' })
  })

  it('refuses when the sender is turned off, or can no longer give that role', async () => {
    const { weddingId, owner } = await setup()
    const [editor, pat] = [await makeUser(db), await makeUser(db)]
    await makeMember(db, weddingId, editor.id, 'editor')

    const fromOwner = await createInvite(db, { weddingId, role: 'owner', invitedBy: owner.id })
    const fromEditor = await createInvite(db, { weddingId, role: 'editor', invitedBy: editor.id })
    const editorOffersOwner = await createInvite(db, { weddingId, role: 'owner', invitedBy: editor.id })
    expect(await acceptInvite(db, editorOffersOwner.token, pat)).toBe('inviter-lost-access')

    // The owner is turned off directly (setUserDisabled would also revoke the invite).
    await db.update(users).set({ disabledAt: new Date() }).where(eq(users.id, owner.id))
    expect(await acceptInvite(db, fromOwner.token, pat)).toBe('inviter-disabled')
    expect((await lookupInvite(db, fromOwner.token))!.status).toBe('inviter-disabled')

    // The editor leaves the wedding: their invite stops working.
    await db.delete(weddingMembers).where(eq(weddingMembers.userId, editor.id))
    expect(await acceptInvite(db, fromEditor.token, pat)).toBe('inviter-lost-access')
    expect(await roles(weddingId)).toEqual({ [owner.id]: 'owner' })
  })

  it('never lowers a role, and still uses the invite up', async () => {
    const { weddingId, owner } = await setup()
    const coOwner = await makeUser(db)
    await makeMember(db, weddingId, coOwner.id, 'owner')
    const { invite, token } = await createInvite(db, { weddingId, role: 'editor', invitedBy: owner.id })
    expect(await acceptInvite(db, token, coOwner)).toBe('ok')
    expect(await roles(weddingId)).toEqual({ [owner.id]: 'owner', [coOwner.id]: 'owner' })
    expect((await inviteRow(invite.id)).acceptedByUserId).toBe(coOwner.id)
  })

  it('raises an existing editor to owner', async () => {
    const { weddingId, owner } = await setup()
    const editor = await makeUser(db)
    await makeMember(db, weddingId, editor.id, 'editor')
    const { token } = await createInvite(db, { weddingId, role: 'owner', invitedBy: owner.id })
    expect(await acceptInvite(db, token, editor)).toBe('ok')
    expect(await roles(weddingId)).toEqual({ [owner.id]: 'owner', [editor.id]: 'owner' })
  })

  it('uses up a planner invite without adding anyone anywhere', async () => {
    const admin = await makeUser(db, { isAdmin: true })
    const pat = await makeUser(db)
    const { token } = await createInvite(db, { invitedBy: admin.id })
    expect(await acceptInvite(db, token, pat)).toBe('ok')
    expect(await db.select().from(weddingMembers)).toEqual([])
    expect(await acceptInvite(db, token, pat)).toBe('used')
  })
})

describe('registerWithInvite', () => {
  it('makes the account and the membership together', async () => {
    const { weddingId, owner } = await setup()
    const { invite, token } = await createInvite(db, { weddingId, role: 'editor', invitedBy: owner.id })
    const result = await registerWithInvite(db, token, newAccount(' New@Example.com '))
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.user).toMatchObject({ email: 'new@example.com', displayName: 'Newcomer', isAdmin: false })
    expect(await roles(weddingId)).toEqual({ [owner.id]: 'owner', [result.user.id]: 'editor' })
    expect((await inviteRow(invite.id)).acceptedByUserId).toBe(result.user.id)
    const [row] = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, result.user.id))
    expect(await verifyUserPassword(row!.hash, TEST_PASSWORD)).toBe(true)
    expect(await registerWithInvite(db, token, newAccount('other@example.com'))).toEqual({ status: 'used' })
  })

  it('makes only the account for a planner invite', async () => {
    const admin = await makeUser(db, { isAdmin: true })
    const { token } = await createInvite(db, { invitedBy: admin.id, email: 'planner@example.com' })
    const result = await registerWithInvite(db, token, newAccount('planner@example.com'))
    expect(result.status).toBe('ok')
    expect(await db.select().from(weddingMembers)).toEqual([])
  })

  it('refuses a planner invite from someone who is no longer an admin', async () => {
    const admin = await makeUser(db, { isAdmin: true })
    const { token } = await createInvite(db, { invitedBy: admin.id })
    await db.update(users).set({ isAdmin: false }).where(eq(users.id, admin.id))
    expect(await registerWithInvite(db, token, newAccount())).toEqual({ status: 'inviter-lost-access' })
    expect(await db.select().from(users).where(eq(users.email, 'new@example.com'))).toEqual([])
  })

  it('refuses a taken email and leaves the invite unused', async () => {
    const { weddingId, owner } = await setup()
    await makeUser(db, { email: 'new@example.com' })
    const { invite, token } = await createInvite(db, { weddingId, role: 'editor', invitedBy: owner.id })
    expect(await registerWithInvite(db, token, newAccount('NEW@example.com'))).toEqual({ status: 'email-taken' })
    const row = await inviteRow(invite.id)
    expect(row.acceptedAt).toBeNull()
    expect(row.acceptedByUserId).toBeNull()
    expect(Object.keys(await roles(weddingId))).toHaveLength(1)
  })

  it('refuses an email that does not match the lock, before doing anything', async () => {
    const { weddingId, owner } = await setup()
    const { token } = await createInvite(db, { weddingId, role: 'editor', email: 'pat@example.com', invitedBy: owner.id })
    expect(await registerWithInvite(db, token, newAccount('sam@example.com'))).toEqual({ status: 'email-mismatch' })
    expect(await registerWithInvite(db, token, newAccount('PAT@example.com'))).toMatchObject({ status: 'ok' })
  })

  it('makes no account when the invite cannot be used', async () => {
    const { weddingId, owner } = await setup()
    const expired = await createInvite(db, { weddingId, role: 'editor', invitedBy: owner.id })
    await db.update(invites).set({ expiresAt: sql`now() - interval '1 second'` }).where(eq(invites.id, expired.invite.id))
    expect(await registerWithInvite(db, expired.token, newAccount())).toEqual({ status: 'expired' })
    const gone = await createInvite(db, { weddingId, role: 'editor', invitedBy: owner.id })
    await db.update(weddings).set({ deletedAt: new Date() }).where(eq(weddings.id, weddingId))
    expect(await registerWithInvite(db, gone.token, newAccount())).toEqual({ status: 'wedding-gone' })
    expect(await registerWithInvite(db, 'x'.repeat(43), newAccount())).toEqual({ status: 'not-found' })
    expect(await db.select().from(users).where(eq(users.email, 'new@example.com'))).toEqual([])
  })

  it('rolls back the account and the acceptance when a later step fails', async () => {
    const { weddingId, owner } = await setup()
    const { invite, token } = await createInvite(db, { weddingId, role: 'editor', invitedBy: owner.id })
    state.failMembership = true
    await expect(registerWithInvite(db, token, newAccount())).rejects.toThrow('membership failed')
    state.failMembership = false
    expect(await db.select().from(users).where(eq(users.email, 'new@example.com'))).toEqual([])
    expect((await inviteRow(invite.id)).acceptedAt).toBeNull()
    expect(await registerWithInvite(db, token, newAccount())).toMatchObject({ status: 'ok' })
  })

  it('lets exactly one of two sign-ups through the same invite', async () => {
    const { weddingId, owner } = await setup()
    const { token } = await createInvite(db, { weddingId, role: 'editor', invitedBy: owner.id })
    const results = await Promise.all([
      registerWithInvite(db, token, newAccount('one@example.com')),
      registerWithInvite(db, token, newAccount('two@example.com')),
    ])
    expect(results.map((r) => r.status).sort()).toEqual(['ok', 'used'])
    const made = await db.select({ email: users.email }).from(users).where(sql`${users.email} in ('one@example.com', 'two@example.com')`)
    expect(made).toHaveLength(1)
  })
})

describe('listInvites', () => {
  it("lists a wedding's invites, or the planner invites, newest first with their state", async () => {
    const { weddingId, owner } = await setup()
    const admin = await makeUser(db, { isAdmin: true, displayName: 'Ada' })
    const pat = await makeUser(db, { displayName: 'Pat' })
    const pending = await createInvite(db, { weddingId, role: 'editor', invitedBy: owner.id })
    const accepted = await createInvite(db, { weddingId, role: 'editor', invitedBy: owner.id })
    const revoked = await createInvite(db, { weddingId, role: 'editor', invitedBy: owner.id })
    const expired = await createInvite(db, { weddingId, role: 'owner', invitedBy: owner.id })
    await acceptInvite(db, accepted.token, pat)
    await revokeInvite(db, revoked.invite.id)
    await db.update(invites).set({ expiresAt: sql`now() - interval '1 second'` }).where(eq(invites.id, expired.invite.id))
    expect(await revokeInvite(db, accepted.invite.id)).toBe(false)
    const planner = await createInvite(db, { invitedBy: admin.id })

    const list = await listInvites(db, weddingId)
    expect(list.map((i) => [i.id, i.state])).toEqual([
      [expired.invite.id, 'expired'],
      [revoked.invite.id, 'revoked'],
      [accepted.invite.id, 'accepted'],
      [pending.invite.id, 'pending'],
    ])
    expect(list[2]!.acceptedBy).toEqual({ id: pat.id, name: 'Pat' })
    expect(JSON.stringify(list)).not.toMatch(/token/i)
    expect((await listInvites(db, null)).map((i) => [i.id, i.invitedBy.name])).toEqual([[planner.invite.id, 'Ada']])
  })
})
