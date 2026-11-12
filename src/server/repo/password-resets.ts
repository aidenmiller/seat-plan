import 'server-only'
import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { hashUserPassword } from '../auth/passwords'
import { OPAQUE_TOKEN_PATTERN, hashOpaqueToken, newOpaqueToken } from '../auth/tokens'
import { passwordResets, users } from '../db/schema'
import type { Db, Tx } from '../locks'
import { endUserSessions } from './sessions'

/**
 * Reset links. There is no email sending: an admin makes a link and passes it
 * on. A link works once, for 24 hours, and only the newest one for a user
 * works (making a new one, changing the password or turning the account off
 * cancels the others). Only the token's hash is stored; the token itself is
 * returned once, when the link is made.
 */

/** A connection or a transaction: both run the same queries. */
type Conn = Db | Tx

export const RESET_HOURS = 24

export type ResetState = 'ok' | 'used' | 'expired'

/** Cancels a user's unused links by moving their expiry to now. Used links stay as they were. */
export async function expireResetLinks(conn: Conn, userId: string): Promise<void> {
  await conn
    .update(passwordResets)
    .set({ expiresAt: sql`now()` })
    .where(and(eq(passwordResets.userId, userId), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, sql`now()`)))
}

/**
 * A new reset link for the user, cancelling the earlier unused ones. The token
 * is returned here and never again. Null when there is no such user.
 */
export async function createResetLink(
  db: Db,
  userId: string,
  createdBy: string | null,
): Promise<{ token: string; expiresAt: Date } | null> {
  const token = newOpaqueToken()
  return db.transaction(async (tx) => {
    const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update')
    if (!user) return null
    await expireResetLinks(tx, userId)
    const [row] = await tx
      .insert(passwordResets)
      .values({
        tokenHash: hashOpaqueToken(token),
        userId,
        createdByUserId: createdBy,
        expiresAt: sql`now() + make_interval(hours => ${RESET_HOURS})`,
      })
      .returning({ expiresAt: passwordResets.expiresAt })
    return { token, expiresAt: row!.expiresAt }
  })
}

export type ResetInfo = { userId: string; email: string; displayName: string; state: ResetState; expiresAt: string }

async function resetRow(conn: Conn, token: string) {
  if (!OPAQUE_TOKEN_PATTERN.test(token)) return null
  const [row] = await conn
    .select({
      userId: passwordResets.userId,
      email: users.email,
      displayName: users.displayName,
      usedAt: passwordResets.usedAt,
      expiresAt: passwordResets.expiresAt,
      expired: sql<boolean>`${passwordResets.expiresAt} <= now()`,
    })
    .from(passwordResets)
    .innerJoin(users, eq(users.id, passwordResets.userId))
    .where(eq(passwordResets.tokenHash, hashOpaqueToken(token)))
  if (!row) return null
  const state: ResetState = row.usedAt !== null ? 'used' : row.expired ? 'expired' : 'ok'
  return { ...row, state }
}

/** What the reset page shows: whose link it is and whether it still works. Null for an unknown token. */
export async function lookupReset(db: Conn, token: string): Promise<ResetInfo | null> {
  const row = await resetRow(db, token)
  if (!row) return null
  return { userId: row.userId, email: row.email, displayName: row.displayName, state: row.state, expiresAt: row.expiresAt.toISOString() }
}

export type CompleteResetResult = { status: 'ok'; userId: string } | { status: 'used' | 'expired' | 'not-found' }

/**
 * Sets a new password through a reset link. The link is checked before the
 * (slow) password hash is made, then used up in one statement that only
 * succeeds once, so two tries at the same moment cannot both set a password.
 * In the same transaction: the new hash, every session ended, and the user's
 * other links cancelled. The caller may then sign the user in afresh.
 */
export async function completeReset(db: Db, token: string, newPassword: string): Promise<CompleteResetResult> {
  const found = await resetRow(db, token)
  if (!found) return { status: 'not-found' }
  if (found.state !== 'ok') return { status: found.state }
  const passwordHash = await hashUserPassword(newPassword)
  return db.transaction(async (tx): Promise<CompleteResetResult> => {
    const [used] = await tx
      .update(passwordResets)
      .set({ usedAt: sql`now()` })
      .where(
        and(
          eq(passwordResets.tokenHash, hashOpaqueToken(token)),
          isNull(passwordResets.usedAt),
          gt(passwordResets.expiresAt, sql`now()`),
        ),
      )
      .returning({ userId: passwordResets.userId })
    if (!used) {
      const now = await resetRow(tx, token)
      return { status: now && now.state !== 'ok' ? now.state : 'not-found' }
    }
    await tx.update(users).set({ passwordHash, passwordChangedAt: sql`now()` }).where(eq(users.id, used.userId))
    await endUserSessions(tx, used.userId)
    await expireResetLinks(tx, used.userId)
    return { status: 'ok', userId: used.userId }
  })
}
