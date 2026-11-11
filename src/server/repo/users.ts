import 'server-only'
import { and, asc, eq, isNull, sql, type SQL } from 'drizzle-orm'
import { cleanDisplayName, isPlausibleEmail, normalizeEmail } from '@/domain/accounts'
import { hashUserPassword, verifyUserPassword } from '../auth/passwords'
import { invites, users } from '../db/schema'
import type { Db, Tx } from '../locks'
import { expireResetLinks } from './password-resets'
import { endUserSessions } from './sessions'

/**
 * People who can sign in. Emails are stored trimmed and lower case
 * (normalizeEmail), and every lookup normalizes first.
 *
 * The password hash leaves the database through one place only,
 * passwordRow(); every other read uses userColumns, which leaves it out.
 */

/** A connection or a transaction: both run the same queries. */
type Conn = Db | Tx

export type UserDto = {
  id: string
  email: string
  displayName: string
  isAdmin: boolean
  disabled: boolean
  createdAt: string
}

export type AdminUserSummary = UserDto & {
  disabledAt: string | null
  lastLoginAt: string | null
  lastSeenAt: string | null
  /** Live weddings they belong to. */
  weddingCount: number
}

const userColumns = {
  id: users.id,
  email: users.email,
  displayName: users.displayName,
  isAdmin: users.isAdmin,
  disabledAt: users.disabledAt,
  createdAt: users.createdAt,
}

type UserRow = { id: string; email: string; displayName: string; isAdmin: boolean; disabledAt: Date | null; createdAt: Date }

function toUserDto(row: UserRow): UserDto {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    isAdmin: row.isAdmin,
    disabled: row.disabledAt !== null,
    createdAt: row.createdAt.toISOString(),
  }
}

/** The one read of password_hash. */
async function passwordRow(conn: Conn, where: SQL | undefined) {
  const [row] = await conn
    .select({ id: users.id, passwordHash: users.passwordHash, disabledAt: users.disabledAt })
    .from(users)
    .where(where)
  return row ?? null
}

export type NewUser = { email: string; displayName: string; password: string; isAdmin?: boolean }
export type CreateUserResult = { status: 'created'; user: UserDto } | { status: 'email-taken' }

/**
 * Inserts a user whose password is already hashed (registration hashes before
 * its transaction opens). Throws on an email or name the routes should have
 * refused already.
 */
export async function insertUser(
  conn: Conn,
  input: { email: string; displayName: string; passwordHash: string; isAdmin?: boolean },
): Promise<CreateUserResult> {
  const email = normalizeEmail(input.email)
  const displayName = cleanDisplayName(input.displayName)
  if (!isPlausibleEmail(email)) throw new Error('insertUser: not an email address')
  if (displayName === null) throw new Error('insertUser: display names are 1 to 60 characters')
  const [row] = await conn
    .insert(users)
    .values({ email, displayName, passwordHash: input.passwordHash, isAdmin: input.isAdmin ?? false })
    .onConflictDoNothing({ target: users.email })
    .returning(userColumns)
  return row ? { status: 'created', user: toUserDto(row) } : { status: 'email-taken' }
}

/** Hashes the password (argon2id) and adds the user. 'email-taken' when the email has an account already. */
export async function createUser(tx: Conn, input: NewUser): Promise<CreateUserResult> {
  const passwordHash = await hashUserPassword(input.password)
  return insertUser(tx, { ...input, passwordHash })
}

export type LoginCandidate = { id: string; passwordHash: string; disabled: boolean }

/**
 * What sign-in needs to check a password: the hash and whether the account is
 * disabled. Null when no account has this email. The caller checks the
 * password even then (verifyUserPassword with null), and refuses a disabled
 * account only after checking, so neither shows in the reply time.
 */
export async function findLoginCandidate(db: Conn, email: string): Promise<LoginCandidate | null> {
  const normalized = normalizeEmail(email)
  if (!isPlausibleEmail(normalized)) return null
  const row = await passwordRow(db, eq(users.email, normalized))
  return row ? { id: row.id, passwordHash: row.passwordHash, disabled: row.disabledAt !== null } : null
}

export async function getUserDto(db: Conn, id: string): Promise<UserDto | null> {
  const [row] = await db.select(userColumns).from(users).where(eq(users.id, id))
  return row ? toUserDto(row) : null
}

/** Live weddings the user belongs to, as a SQL count. Explicit table names, as in weddings.ts. */
const weddingCount = sql<number>`(
  select count(*)::int from "wedding_members" m
  join "weddings" w on w."id" = m."wedding_id"
  where m."user_id" = "users"."id" and w."deleted_at" is null
)`

/** Everyone, oldest account first, for the admin page. */
export async function listUsersForAdmin(db: Conn): Promise<AdminUserSummary[]> {
  const rows = await db
    .select({ ...userColumns, lastLoginAt: users.lastLoginAt, lastSeenAt: users.lastSeenAt, weddingCount })
    .from(users)
    .orderBy(asc(users.createdAt), asc(users.id))
  return rows.map((r) => ({
    ...toUserDto(r),
    disabledAt: r.disabledAt?.toISOString() ?? null,
    lastLoginAt: r.lastLoginAt?.toISOString() ?? null,
    lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
    weddingCount: Number(r.weddingCount),
  }))
}

/** Null when there is no such user. Throws on a name the route should have refused. */
export async function updateDisplayName(db: Conn, userId: string, displayName: string): Promise<UserDto | null> {
  const name = cleanDisplayName(displayName)
  if (name === null) throw new Error('updateDisplayName: display names are 1 to 60 characters')
  const [row] = await db.update(users).set({ displayName: name }).where(eq(users.id, userId)).returning(userColumns)
  return row ? toUserDto(row) : null
}

/**
 * Changes the password after checking the current one. In one transaction it
 * writes the new hash (only over the hash that was checked, so two changes at
 * once cannot both win), ends every session the user has, and cancels any
 * unused reset link. The caller then starts a new session for this browser,
 * so the user stays signed in here and nowhere else.
 */
export async function changePassword(db: Db, userId: string, current: string, next: string): Promise<'ok' | 'wrong-password'> {
  const row = await passwordRow(db, and(eq(users.id, userId), isNull(users.disabledAt)))
  if (!(await verifyUserPassword(row?.passwordHash ?? null, current)) || !row) return 'wrong-password'
  const passwordHash = await hashUserPassword(next)
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(users)
      .set({ passwordHash, passwordChangedAt: sql`now()` })
      .where(and(eq(users.id, userId), eq(users.passwordHash, row.passwordHash)))
      .returning({ id: users.id })
    if (updated.length === 0) return 'wrong-password'
    await endUserSessions(tx, userId)
    await expireResetLinks(tx, userId)
    return 'ok'
  })
}

export type SetDisabledResult = 'ok' | 'self' | 'last-admin' | 'not-found'

/**
 * Turns an account off or back on. Nobody can turn off their own account, and
 * the last admin who is still on cannot be turned off. Turning someone off
 * also ends their sessions, cancels the invites they sent that nobody has
 * used yet, and cancels their unused reset links. Turning them back on
 * brings none of those back.
 */
export async function setUserDisabled(db: Db, actorId: string, userId: string, disabled: boolean): Promise<SetDisabledResult> {
  if (actorId === userId) return 'self'
  return db.transaction(async (tx): Promise<SetDisabledResult> => {
    const [target] = await tx.select({ id: users.id, isAdmin: users.isAdmin }).from(users).where(eq(users.id, userId))
    if (!target) return 'not-found'
    if (disabled && target.isAdmin) {
      // Lock every admin who is on, in id order, so two admins turning each other off at once queue up
      // and the second sees the first one's change.
      const admins = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.isAdmin, true), isNull(users.disabledAt)))
        .orderBy(asc(users.id))
        .for('update')
      if (!admins.some((a) => a.id !== userId)) return 'last-admin'
    }
    await tx
      .update(users)
      .set({ disabledAt: disabled ? sql`coalesce(${users.disabledAt}, now())` : null })
      .where(eq(users.id, userId))
    if (disabled) {
      await endUserSessions(tx, userId)
      await tx
        .update(invites)
        .set({ revokedAt: sql`now()` })
        .where(and(eq(invites.invitedByUserId, userId), isNull(invites.acceptedAt), isNull(invites.revokedAt)))
      await expireResetLinks(tx, userId)
    }
    return 'ok'
  })
}

export async function countUsers(db: Conn): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(users)
  return Number(row?.n ?? 0)
}
