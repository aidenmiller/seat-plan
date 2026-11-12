import 'server-only'
import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import type { AdminWedding } from '@/shared/accounts-api'
import type { Role } from '../auth/access'
import { users, weddingMembers, weddings } from '../db/schema'
import type { Db, Tx } from '../locks'
import { addOrUpgradeMember, isLastOwnerViolation } from './members'

/**
 * Every wedding for the admin pages, deleted ones included, with who belongs
 * to each. Only admins reach these (the admin routes and pages check).
 */

// Explicit table names, as in weddings.ts: inside sql`` drizzle prints a column without its table.
const liveGuestCount = sql<number>`(select count(*)::int from "guests" g where g."wedding_id" = "weddings"."id" and g."deleted_at" is null)`
const liveLayoutCount = sql<number>`(select count(*)::int from "layouts" l where l."wedding_id" = "weddings"."id" and l."deleted_at" is null)`

const weddingColumns = {
  id: weddings.id,
  name: weddings.name,
  createdAt: weddings.createdAt,
  updatedAt: weddings.updatedAt,
  deletedAt: weddings.deletedAt,
  guestCount: liveGuestCount,
  layoutCount: liveLayoutCount,
}

type WeddingRow = {
  id: string
  name: string
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
  guestCount: number
  layoutCount: number
}

/** The weddings with their members (owners first, then by name), in the given order. */
async function withMembers(db: Db, rows: WeddingRow[]): Promise<AdminWedding[]> {
  const ids = rows.map((r) => r.id)
  const members =
    ids.length === 0
      ? []
      : await db
          .select({
            weddingId: weddingMembers.weddingId,
            userId: weddingMembers.userId,
            displayName: users.displayName,
            email: users.email,
            role: weddingMembers.role,
          })
          .from(weddingMembers)
          .innerJoin(users, eq(users.id, weddingMembers.userId))
          .where(inArray(weddingMembers.weddingId, ids))
          .orderBy(sql`case when ${weddingMembers.role} = 'owner' then 0 else 1 end`, asc(sql`lower(${users.displayName})`), asc(users.id))
  const byWedding = new Map<string, AdminWedding['members']>()
  for (const m of members) {
    const list = byWedding.get(m.weddingId) ?? []
    list.push({ userId: m.userId, displayName: m.displayName, email: m.email, role: m.role })
    byWedding.set(m.weddingId, list)
  }
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    deletedAt: r.deletedAt?.toISOString() ?? null,
    guestCount: Number(r.guestCount),
    layoutCount: Number(r.layoutCount),
    members: byWedding.get(r.id) ?? [],
  }))
}

/** Every wedding, live and deleted, oldest first, with live guest and layout counts and its members. */
export async function listWeddingsForAdmin(db: Db): Promise<AdminWedding[]> {
  const rows = await db.select(weddingColumns).from(weddings).orderBy(asc(weddings.createdAt), asc(weddings.id))
  return withMembers(db, rows)
}

/** One wedding as listWeddingsForAdmin shows it, deleted or not. Null when there is no such wedding. */
export async function getWeddingForAdmin(db: Db, weddingId: string): Promise<AdminWedding | null> {
  const rows = await db.select(weddingColumns).from(weddings).where(eq(weddings.id, weddingId))
  const [wedding] = await withMembers(db, rows)
  return wedding ?? null
}

export type ClaimResult = 'ok' | 'not-found' | 'has-owner'

/**
 * Makes the admin the owner of a wedding that has no owner (deleted ones
 * too, so restoring one later does not bring back a wedding nobody can
 * open). Refused while it has an owner: an admin can already open any
 * wedding, so taking one over that someone owns is never needed. The wedding
 * row is locked first, so two admins claiming at once queue up and the second
 * sees the first one's claim.
 */
export async function claimOwnerlessWedding(db: Db, weddingId: string, adminId: string): Promise<ClaimResult> {
  return db.transaction(async (tx): Promise<ClaimResult> => {
    const [wedding] = await tx.select({ id: weddings.id }).from(weddings).where(eq(weddings.id, weddingId)).for('update')
    if (!wedding) return 'not-found'
    const [owner] = await tx
      .select({ userId: weddingMembers.userId })
      .from(weddingMembers)
      .where(and(eq(weddingMembers.weddingId, weddingId), eq(weddingMembers.role, 'owner')))
      .limit(1)
    if (owner) return 'has-owner'
    await addOrUpgradeMember(tx, weddingId, adminId, 'owner', adminId)
    return 'ok'
  })
}

// ---------------------------------------------------------------- the admin's changes (milestone 8)

export type UndeleteResult = 'undeleted' | 'not-deleted' | 'not-found'

/** Clears a deleted wedding's deleted_at, and nothing else: its rows were never touched (DECISIONS 32). */
export async function undeleteWedding(db: Db, weddingId: string): Promise<UndeleteResult> {
  const updated = await db
    .update(weddings)
    .set({ deletedAt: null, updatedAt: sql`${weddings.updatedAt}` })
    .where(and(eq(weddings.id, weddingId), isNotNull(weddings.deletedAt)))
    .returning({ id: weddings.id })
  if (updated.length > 0) return 'undeleted'
  const [live] = await db.select({ id: weddings.id }).from(weddings).where(eq(weddings.id, weddingId))
  return live ? 'not-deleted' : 'not-found'
}

/** Why an admin's change to a wedding's people was refused. */
export type AdminMemberRefusal = 'not-found' | 'deleted' | 'no-user' | 'user-disabled'

/** Locks the live wedding row and checks the person, inside the caller's transaction. */
async function checkWeddingAndUser(tx: Tx, weddingId: string, userId: string): Promise<AdminMemberRefusal | null> {
  const [wedding] = await tx.select({ deletedAt: weddings.deletedAt }).from(weddings).where(eq(weddings.id, weddingId)).for('update')
  if (!wedding) return 'not-found'
  if (wedding.deletedAt) return 'deleted'
  const [user] = await tx.select({ disabledAt: users.disabledAt }).from(users).where(eq(users.id, userId))
  if (!user) return 'no-user'
  if (user.disabledAt) return 'user-disabled'
  return null
}

/**
 * Adds someone with an account to a live wedding, with no invite: the
 * admin's page offers it for people who already have accounts. 'exists' when
 * they belong already (their role changes through the members route).
 */
export async function adminAddMember(
  db: Db,
  weddingId: string,
  userId: string,
  role: Role,
  adminId: string,
): Promise<'added' | 'exists' | AdminMemberRefusal> {
  return db.transaction(async (tx) => {
    const refused = await checkWeddingAndUser(tx, weddingId, userId)
    if (refused) return refused
    const inserted = await tx
      .insert(weddingMembers)
      .values({ weddingId, userId, role, addedByUserId: adminId })
      .onConflictDoNothing()
      .returning({ userId: weddingMembers.userId })
    return inserted.length > 0 ? 'added' : 'exists'
  })
}

export type TransferResult = { status: 'ok'; previousOwners: string[] } | { status: AdminMemberRefusal | 'last-owner' }

/**
 * Makes `toUserId` an owner of a live wedding (adding them if they do not
 * belong), and with `demotePrevious` makes its other owners editors, in one
 * transaction. The owner rows are locked in id order first, as every member
 * change does (members.ts), so this queues behind a change already under
 * way. The new owner is an owner before anyone is demoted, so the wedding
 * always keeps one; the trigger's refusal at COMMIT would read 'last-owner'.
 */
export async function transferOwnership(
  db: Db,
  weddingId: string,
  toUserId: string,
  demotePrevious: boolean,
  adminId: string,
): Promise<TransferResult> {
  try {
    return await db.transaction(async (tx): Promise<TransferResult> => {
      const refused = await checkWeddingAndUser(tx, weddingId, toUserId)
      if (refused) return { status: refused }
      const owners = await tx
        .select({ userId: weddingMembers.userId })
        .from(weddingMembers)
        .where(and(eq(weddingMembers.weddingId, weddingId), eq(weddingMembers.role, 'owner')))
        .orderBy(asc(weddingMembers.userId))
        .for('update')
      const previousOwners = owners.map((o) => o.userId).filter((id) => id !== toUserId)
      await addOrUpgradeMember(tx, weddingId, toUserId, 'owner', adminId)
      if (demotePrevious && previousOwners.length > 0) {
        await tx
          .update(weddingMembers)
          .set({ role: 'editor' })
          .where(and(eq(weddingMembers.weddingId, weddingId), inArray(weddingMembers.userId, previousOwners)))
      }
      return { status: 'ok', previousOwners }
    })
  } catch (err) {
    if (isLastOwnerViolation(err)) return { status: 'last-owner' }
    throw err
  }
}
