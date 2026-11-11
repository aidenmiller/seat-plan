import 'server-only'
import { and, eq, isNull } from 'drizzle-orm'
import { uuid } from '@/shared/api'
import { weddingMembers, weddings } from '../db/schema'
import type { Db, Tx } from '../locks'

/**
 * Who may open a wedding. A member's role says what they may do there; an
 * admin may do anything anywhere, and every use of that power is logged
 * (the guards record admin_access).
 *
 * The role checks are plain functions; weddingAccess is the one query.
 */

export type Role = 'owner' | 'editor'

/** The signed-in person, as the guards hand them to a handler. Never holds the password hash or the session secret. */
export type SessionUser = { id: string; sessionId: string; email: string; displayName: string; isAdmin: boolean }

/**
 * Access to one live wedding. `role` is the caller's own membership (null for
 * an admin who is not a member); `viaAdmin` is true when the access needed the
 * admin's power.
 */
export type WeddingAccess = { user: SessionUser; weddingId: string; role: Role | null; viaAdmin: boolean }

const RANK: Record<Role, number> = { editor: 1, owner: 2 }

/** True when `role` is `min` or above. No role is below everything. */
export function roleAtLeast(role: Role | null | undefined, min: Role): boolean {
  return role != null && RANK[role] >= RANK[min]
}

/**
 * The role someone acts with. An admin acts as an owner everywhere, member or
 * not: being an editor somewhere never takes an admin's power away.
 */
export function effectiveRole(memberRole: Role | null, isAdmin: boolean): Role | null {
  return isAdmin ? 'owner' : memberRole
}

/** True when doing something that needs `min` relies on the admin's power rather than the member's own role. */
export function needsAdminPower(memberRole: Role | null, isAdmin: boolean, min: Role): boolean {
  return isAdmin && !roleAtLeast(memberRole, min)
}

/**
 * The caller's access to a wedding, in one query: the wedding (live only)
 * with the caller's member row, if any. Null when the wedding is missing or
 * deleted, or when a non-admin is not a member (the caller answers 404 either
 * way, so a non-member cannot tell a wedding exists).
 */
export async function weddingAccess(db: Db | Tx, user: SessionUser, weddingId: string): Promise<WeddingAccess | null> {
  if (!uuid.safeParse(weddingId).success) return null
  const [row] = await db
    .select({ id: weddings.id, role: weddingMembers.role })
    .from(weddings)
    .leftJoin(weddingMembers, and(eq(weddingMembers.weddingId, weddings.id), eq(weddingMembers.userId, user.id)))
    .where(and(eq(weddings.id, weddingId), isNull(weddings.deletedAt)))
  if (!row) return null
  const role = row.role ?? null
  if (role === null && !user.isAdmin) return null
  return { user, weddingId: row.id, role, viaAdmin: role === null }
}
