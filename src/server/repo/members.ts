import 'server-only'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import type { Role } from '../auth/access'
import { users, weddingMembers, weddings } from '../db/schema'
import type { Db, Tx } from '../locks'

/**
 * Who belongs to each wedding, and as what. A wedding with members always
 * keeps an owner. The app checks that itself before every change, holding
 * locks on the wedding's owner rows so two changes at once cannot each leave
 * the other as the last owner; the trigger from migration 0006 is the
 * backstop, and its refusal at COMMIT reads as 'last-owner' too.
 */

/** A connection or a transaction: both run the same queries. */
type Conn = Db | Tx

export type Member = {
  userId: string
  email: string
  displayName: string
  role: Role
  disabled: boolean
  addedAt: string
}

/** The members of a wedding: owners first, then by name. */
export async function listMembers(db: Conn, weddingId: string): Promise<Member[]> {
  const rows = await db
    .select({
      userId: weddingMembers.userId,
      email: users.email,
      displayName: users.displayName,
      role: weddingMembers.role,
      disabledAt: users.disabledAt,
      addedAt: weddingMembers.createdAt,
    })
    .from(weddingMembers)
    .innerJoin(users, eq(users.id, weddingMembers.userId))
    .where(eq(weddingMembers.weddingId, weddingId))
    .orderBy(sql`case when ${weddingMembers.role} = 'owner' then 0 else 1 end`, asc(sql`lower(${users.displayName})`), asc(users.id))
  return rows.map((r) => ({
    userId: r.userId,
    email: r.email,
    displayName: r.displayName,
    role: r.role,
    disabled: r.disabledAt !== null,
    addedAt: r.addedAt.toISOString(),
  }))
}

/** Ids of the live weddings a user belongs to. */
export async function listWeddingIdsForUser(db: Conn, userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: weddingMembers.weddingId })
    .from(weddingMembers)
    .innerJoin(weddings, eq(weddings.id, weddingMembers.weddingId))
    .where(and(eq(weddingMembers.userId, userId), isNull(weddings.deletedAt)))
    .orderBy(asc(weddings.createdAt), asc(weddings.id))
  return rows.map((r) => r.id)
}

export type AddMemberResult = 'added' | 'upgraded' | 'unchanged'

/**
 * Adds someone to a wedding, or raises an editor to owner. Never lowers a
 * role: adding an owner as an editor leaves them an owner.
 */
export async function addOrUpgradeMember(
  tx: Conn,
  weddingId: string,
  userId: string,
  role: Role,
  addedBy: string | null,
): Promise<AddMemberResult> {
  const inserted = await tx
    .insert(weddingMembers)
    .values({ weddingId, userId, role, addedByUserId: addedBy })
    .onConflictDoNothing()
    .returning({ userId: weddingMembers.userId })
  if (inserted.length > 0) return 'added'
  if (role !== 'owner') return 'unchanged'
  const upgraded = await tx
    .update(weddingMembers)
    .set({ role: 'owner' })
    .where(and(eq(weddingMembers.weddingId, weddingId), eq(weddingMembers.userId, userId), eq(weddingMembers.role, 'editor')))
    .returning({ userId: weddingMembers.userId })
  return upgraded.length > 0 ? 'upgraded' : 'unchanged'
}

/**
 * True for the trigger's refusal (SQLSTATE 23514 raised by
 * wedding_members_keep_an_owner), looking through drizzle's wrapper to the
 * pg error. A table check that fails has the same code but names its
 * constraint, so the two are told apart.
 */
export function isLastOwnerViolation(err: unknown): boolean {
  let current: unknown = err
  for (let depth = 0; depth < 5 && current !== null && typeof current === 'object'; depth++) {
    const e = current as { code?: unknown; message?: unknown; where?: unknown; constraint?: unknown }
    if (e.code === '23514' && !e.constraint) {
      const text = `${String(e.message ?? '')} ${String(e.where ?? '')}`
      if (text.includes('would have no owner') || text.includes('wedding_members_keep_an_owner')) return true
    }
    current = (current as { cause?: unknown }).cause
  }
  return false
}

type RoleChange = 'ok' | 'not-found' | 'last-owner'

/**
 * Runs a member change for one person: locks the wedding's owner rows (in id
 * order, the same order everywhere, so two changes queue up rather than
 * deadlock), then that person's row, and hands both to `change`. A refusal
 * from the trigger at COMMIT reads as 'last-owner'.
 */
async function withOwnersLocked(
  db: Db,
  weddingId: string,
  userId: string,
  change: (tx: Tx, current: Role, otherOwners: number) => Promise<RoleChange>,
): Promise<RoleChange> {
  try {
    return await db.transaction(async (tx) => {
      const owners = await tx
        .select({ userId: weddingMembers.userId })
        .from(weddingMembers)
        .where(and(eq(weddingMembers.weddingId, weddingId), eq(weddingMembers.role, 'owner')))
        .orderBy(asc(weddingMembers.userId))
        .for('update')
      const [target] = await tx
        .select({ role: weddingMembers.role })
        .from(weddingMembers)
        .where(and(eq(weddingMembers.weddingId, weddingId), eq(weddingMembers.userId, userId)))
        .for('update')
      if (!target) return 'not-found'
      return change(tx, target.role, owners.filter((o) => o.userId !== userId).length)
    })
  } catch (err) {
    if (isLastOwnerViolation(err)) return 'last-owner'
    throw err
  }
}

/** Sets a member's role. 'last-owner' when that would leave the wedding with no owner. */
export function changeRole(db: Db, weddingId: string, userId: string, role: Role): Promise<RoleChange> {
  return withOwnersLocked(db, weddingId, userId, async (tx, current, otherOwners) => {
    if (current === role) return 'ok'
    if (current === 'owner' && otherOwners === 0) return 'last-owner'
    await tx
      .update(weddingMembers)
      .set({ role })
      .where(and(eq(weddingMembers.weddingId, weddingId), eq(weddingMembers.userId, userId)))
    return 'ok'
  })
}

/** Takes someone out of a wedding. 'last-owner' when they are its only owner. */
export function removeMember(db: Db, weddingId: string, userId: string): Promise<RoleChange> {
  return withOwnersLocked(db, weddingId, userId, async (tx, current, otherOwners) => {
    if (current === 'owner' && otherOwners === 0) return 'last-owner'
    await tx.delete(weddingMembers).where(and(eq(weddingMembers.weddingId, weddingId), eq(weddingMembers.userId, userId)))
    return 'ok'
  })
}

/**
 * Makes the user the owner of every wedding that has no owner, deleted
 * weddings included (so restoring one later does not bring back a wedding
 * nobody can open). Used when the first admin sets the site up. Returns how
 * many weddings it took.
 */
export async function assignOwnerlessWeddings(tx: Conn, userId: string): Promise<number> {
  const result = await tx.execute<{ wedding_id: string }>(sql`
    insert into wedding_members (wedding_id, user_id, role, added_by_user_id)
    select w.id, ${userId}::uuid, 'owner', null
    from weddings w
    where not exists (select 1 from wedding_members m where m.wedding_id = w.id and m.role = 'owner')
    on conflict (wedding_id, user_id) do update set role = 'owner', updated_at = now()
    returning wedding_id
  `)
  return result.rows.length
}
