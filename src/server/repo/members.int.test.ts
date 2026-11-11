/**
 * Wedding members against the test database: the last-owner rule (in the app
 * and in the trigger behind it), changes at the same moment, and handing
 * ownerless weddings to the first admin.
 */
import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { makeTestDb, truncateAll } from '../../../test/db'
import { makeMember, makeUser } from '../../../test/auth'
import { weddingAccess, type SessionUser } from '../auth/access'
import { weddingMembers, weddings } from '../db/schema'
import {
  addOrUpgradeMember,
  assignOwnerlessWeddings,
  changeRole,
  isLastOwnerViolation,
  listMembers,
  listWeddingIdsForUser,
  removeMember,
} from './members'
import { makeWedding } from './test-fixtures'

const { pool, db } = makeTestDb()

beforeEach(async () => {
  await truncateAll(pool)
})
afterAll(async () => {
  await pool.end()
})

async function roles(weddingId: string) {
  const rows = await db.select({ userId: weddingMembers.userId, role: weddingMembers.role }).from(weddingMembers).where(eq(weddingMembers.weddingId, weddingId))
  return Object.fromEntries(rows.map((r) => [r.userId, r.role]))
}

function sessionUser(u: { id: string; email: string; displayName: string; isAdmin: boolean }): SessionUser {
  return { id: u.id, sessionId: 'test', email: u.email, displayName: u.displayName, isAdmin: u.isAdmin }
}

describe('listMembers and listWeddingIdsForUser', () => {
  it('lists owners first, then by name', async () => {
    const weddingId = await makeWedding(db)
    const [zoe, amy, bob] = [
      await makeUser(db, { displayName: 'Zoe' }),
      await makeUser(db, { displayName: 'amy' }),
      await makeUser(db, { displayName: 'Bob', disabled: true }),
    ]
    await makeMember(db, weddingId, bob.id, 'editor')
    await makeMember(db, weddingId, zoe.id, 'owner')
    await makeMember(db, weddingId, amy.id, 'editor')
    const list = await listMembers(db, weddingId)
    expect(list.map((m) => [m.displayName, m.role, m.disabled])).toEqual([
      ['Zoe', 'owner', false],
      ['amy', 'editor', false],
      ['Bob', 'editor', true],
    ])
    expect(list[0]).toEqual({ userId: zoe.id, email: zoe.email, displayName: 'Zoe', role: 'owner', disabled: false, addedAt: expect.any(String) })
  })

  it('lists only live weddings for a user', async () => {
    const user = await makeUser(db)
    const [a, b, gone] = [await makeWedding(db), await makeWedding(db), await makeWedding(db)]
    for (const w of [a, b, gone]) await makeMember(db, w, user.id, 'owner')
    await db.update(weddings).set({ deletedAt: new Date() }).where(eq(weddings.id, gone))
    expect((await listWeddingIdsForUser(db, user.id)).sort()).toEqual([a, b].sort())
  })
})

describe('addOrUpgradeMember', () => {
  it('adds, raises an editor to owner, and never lowers an owner', async () => {
    const weddingId = await makeWedding(db)
    const [owner, user] = [await makeUser(db), await makeUser(db)]
    expect(await addOrUpgradeMember(db, weddingId, owner.id, 'owner', null)).toBe('added')
    expect(await addOrUpgradeMember(db, weddingId, user.id, 'editor', owner.id)).toBe('added')
    expect(await addOrUpgradeMember(db, weddingId, user.id, 'editor', owner.id)).toBe('unchanged')
    expect(await addOrUpgradeMember(db, weddingId, user.id, 'owner', owner.id)).toBe('upgraded')
    expect(await addOrUpgradeMember(db, weddingId, user.id, 'editor', owner.id)).toBe('unchanged')
    expect(await roles(weddingId)).toEqual({ [owner.id]: 'owner', [user.id]: 'owner' })
    const [row] = await db
      .select({ addedBy: weddingMembers.addedByUserId })
      .from(weddingMembers)
      .where(and(eq(weddingMembers.weddingId, weddingId), eq(weddingMembers.userId, user.id)))
    expect(row!.addedBy).toBe(owner.id)
  })
})

describe('changeRole and removeMember', () => {
  it('change roles and remove members while an owner remains', async () => {
    const weddingId = await makeWedding(db)
    const [a, b] = [await makeUser(db), await makeUser(db)]
    await makeMember(db, weddingId, a.id, 'owner')
    await makeMember(db, weddingId, b.id, 'editor')
    expect(await changeRole(db, weddingId, b.id, 'owner')).toBe('ok')
    expect(await changeRole(db, weddingId, a.id, 'editor')).toBe('ok')
    expect(await changeRole(db, weddingId, a.id, 'editor')).toBe('ok')
    expect(await roles(weddingId)).toEqual({ [a.id]: 'editor', [b.id]: 'owner' })
    expect(await removeMember(db, weddingId, a.id)).toBe('ok')
    expect(await roles(weddingId)).toEqual({ [b.id]: 'owner' })
  })

  it('answer not-found for someone who is not a member', async () => {
    const weddingId = await makeWedding(db)
    const [a, b] = [await makeUser(db), await makeUser(db)]
    await makeMember(db, weddingId, a.id, 'owner')
    expect(await changeRole(db, weddingId, b.id, 'owner')).toBe('not-found')
    expect(await removeMember(db, weddingId, b.id)).toBe('not-found')
  })

  it('refuse to lower or remove the last owner (the app check), changing nothing', async () => {
    const weddingId = await makeWedding(db)
    const [a, b] = [await makeUser(db), await makeUser(db)]
    await makeMember(db, weddingId, a.id, 'owner')
    await makeMember(db, weddingId, b.id, 'editor')
    expect(await changeRole(db, weddingId, a.id, 'editor')).toBe('last-owner')
    expect(await removeMember(db, weddingId, a.id)).toBe('last-owner')
    expect(await roles(weddingId)).toEqual({ [a.id]: 'owner', [b.id]: 'editor' })
  })

  it('let exactly one of two owners step down when both try at once', async () => {
    for (let round = 0; round < 5; round++) {
      const weddingId = await makeWedding(db)
      const [a, b] = [await makeUser(db), await makeUser(db)]
      await makeMember(db, weddingId, a.id, 'owner')
      await makeMember(db, weddingId, b.id, 'owner')
      const results = await Promise.all([changeRole(db, weddingId, a.id, 'editor'), changeRole(db, weddingId, b.id, 'editor')])
      expect(results.sort()).toEqual(['last-owner', 'ok'])
      expect(Object.values(await roles(weddingId)).sort()).toEqual(['editor', 'owner'])
    }
  })

  it('let exactly one of two owners leave when both try at once', async () => {
    for (let round = 0; round < 5; round++) {
      const weddingId = await makeWedding(db)
      const [a, b] = [await makeUser(db), await makeUser(db)]
      await makeMember(db, weddingId, a.id, 'owner')
      await makeMember(db, weddingId, b.id, 'owner')
      const results = await Promise.all([removeMember(db, weddingId, a.id), changeRole(db, weddingId, b.id, 'editor')])
      expect(results.sort()).toEqual(['last-owner', 'ok'])
      expect(Object.values(await roles(weddingId))).toContain('owner')
    }
  })
})

describe('the trigger behind the app check', () => {
  it('refuses at COMMIT, and its error reads as the last-owner refusal', async () => {
    const weddingId = await makeWedding(db)
    const user = await makeUser(db)
    await makeMember(db, weddingId, user.id, 'owner')
    let caught: unknown = null
    try {
      await db.transaction(async (tx) => {
        await tx.update(weddingMembers).set({ role: 'editor' }).where(eq(weddingMembers.weddingId, weddingId))
      })
    } catch (err) {
      caught = err
    }
    expect(caught).not.toBeNull()
    expect(isLastOwnerViolation(caught)).toBe(true)
    expect(await roles(weddingId)).toEqual({ [user.id]: 'owner' })
  })

  it('is told apart from a table check with the same code', async () => {
    const weddingId = await makeWedding(db)
    const user = await makeUser(db)
    let caught: unknown = null
    try {
      await db.execute(sql`insert into wedding_members (wedding_id, user_id, role) values (${weddingId}, ${user.id}, 'viewer')`)
    } catch (err) {
      caught = err
    }
    expect(caught).not.toBeNull()
    expect(isLastOwnerViolation(caught)).toBe(false)
    expect(isLastOwnerViolation(new Error('wedding x would have no owner'))).toBe(false)
    expect(isLastOwnerViolation(null)).toBe(false)
  })
})

describe('assignOwnerlessWeddings', () => {
  it('makes the user owner of every wedding without one, deleted ones included', async () => {
    const [admin, someone] = [await makeUser(db, { isAdmin: true }), await makeUser(db)]
    const bare = await makeWedding(db)
    const deleted = await makeWedding(db)
    await db.update(weddings).set({ deletedAt: new Date() }).where(eq(weddings.id, deleted))
    const owned = await makeWedding(db)
    await makeMember(db, owned, someone.id, 'owner')
    const editorsOnly = await makeWedding(db)
    await makeMember(db, editorsOnly, someone.id, 'editor')
    const adminEditor = await makeWedding(db)
    await makeMember(db, adminEditor, admin.id, 'editor')

    expect(await db.transaction((tx) => assignOwnerlessWeddings(tx, admin.id))).toBe(4)
    expect(await roles(bare)).toEqual({ [admin.id]: 'owner' })
    expect(await roles(deleted)).toEqual({ [admin.id]: 'owner' })
    expect(await roles(owned)).toEqual({ [someone.id]: 'owner' })
    expect(await roles(editorsOnly)).toEqual({ [someone.id]: 'editor', [admin.id]: 'owner' })
    expect(await roles(adminEditor)).toEqual({ [admin.id]: 'owner' })
    expect(await db.transaction((tx) => assignOwnerlessWeddings(tx, admin.id))).toBe(0)
  })
})

describe('weddingAccess', () => {
  it('gives a member their role, hides the wedding from others, and lets an admin in', async () => {
    const weddingId = await makeWedding(db)
    const [owner, editor, stranger, admin] = [
      await makeUser(db),
      await makeUser(db),
      await makeUser(db),
      await makeUser(db, { isAdmin: true }),
    ]
    await makeMember(db, weddingId, owner.id, 'owner')
    await makeMember(db, weddingId, editor.id, 'editor')
    expect(await weddingAccess(db, sessionUser(owner), weddingId)).toEqual({
      user: sessionUser(owner),
      weddingId,
      role: 'owner',
      viaAdmin: false,
    })
    expect((await weddingAccess(db, sessionUser(editor), weddingId))!.role).toBe('editor')
    expect(await weddingAccess(db, sessionUser(stranger), weddingId)).toBeNull()
    expect(await weddingAccess(db, sessionUser(admin), weddingId)).toMatchObject({ role: null, viaAdmin: true })
    expect(await weddingAccess(db, sessionUser(admin), 'not-a-uuid')).toBeNull()
    expect(await weddingAccess(db, sessionUser(admin), '00000000-0000-4000-8000-000000000000')).toBeNull()
  })

  it('is null for a deleted wedding, for members and admins alike', async () => {
    const weddingId = await makeWedding(db)
    const [owner, admin] = [await makeUser(db), await makeUser(db, { isAdmin: true })]
    await makeMember(db, weddingId, owner.id, 'owner')
    await db.update(weddings).set({ deletedAt: new Date() }).where(eq(weddings.id, weddingId))
    expect(await weddingAccess(db, sessionUser(owner), weddingId)).toBeNull()
    expect(await weddingAccess(db, sessionUser(admin), weddingId)).toBeNull()
  })
})
