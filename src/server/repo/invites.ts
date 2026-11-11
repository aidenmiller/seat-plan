import 'server-only'
import { and, desc, eq, gt, isNull, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { isPlausibleEmail, normalizeEmail } from '@/domain/accounts'
import { wellFormedText } from '@/domain/canvas-schema'
import { roleAtLeast, type Role, type SessionUser } from '../auth/access'
import { hashUserPassword } from '../auth/passwords'
import { OPAQUE_TOKEN_PATTERN, hashOpaqueToken, newOpaqueToken } from '../auth/tokens'
import { invites, users, weddingMembers, weddings } from '../db/schema'
import type { Db, Tx } from '../locks'
import { addOrUpgradeMember } from './members'
import { insertUser, type UserDto } from './users'

/**
 * Invite links. An invite to a wedding adds the person who accepts it as an
 * editor or owner (never lowering a role they already have). An invite with
 * no wedding is an admin's "new planner" invite: accepting it only makes the
 * account. An invite may be locked to one email.
 *
 * A link works once, for 7 days, and only while the person who sent it is
 * still on and may still give that role. Only the token's hash is stored; the
 * token is returned once, when the invite is made.
 *
 * Accepting is one transaction: a single UPDATE that only succeeds while the
 * invite is unused, not revoked and not expired (so two people accepting at
 * once cannot both get in), the checks, any new account, and the membership.
 * Any refusal rolls all of it back.
 */

/** A connection or a transaction: both run the same queries. */
type Conn = Db | Tx

export const INVITE_DAYS = 7
export const INVITE_NOTE_MAX = 200

/** Why an invite cannot be used right now. */
export type InviteProblem =
  | 'not-found'
  | 'used'
  | 'expired'
  | 'revoked'
  | 'email-mismatch'
  | 'wedding-gone'
  | 'inviter-disabled'
  /** The sender has since left the wedding, been lowered below the role they offered, or (for a planner invite) stopped being an admin. */
  | 'inviter-lost-access'

export type InviteListState = 'pending' | 'accepted' | 'expired' | 'revoked'

export type InviteDto = {
  id: string
  weddingId: string | null
  role: Role | null
  email: string | null
  note: string | null
  invitedBy: { id: string; name: string }
  acceptedBy: { id: string; name: string } | null
  state: InviteListState
  createdAt: string
  expiresAt: string
  acceptedAt: string | null
}

const inviter = alias(users, 'inviter')
const accepter = alias(users, 'accepter')
const inviterMembership = alias(weddingMembers, 'inviter_membership')

const dtoColumns = {
  id: invites.id,
  weddingId: invites.weddingId,
  role: invites.role,
  email: invites.email,
  note: invites.note,
  invitedById: invites.invitedByUserId,
  invitedByName: inviter.displayName,
  acceptedById: invites.acceptedByUserId,
  acceptedByName: accepter.displayName,
  createdAt: invites.createdAt,
  expiresAt: invites.expiresAt,
  acceptedAt: invites.acceptedAt,
  revokedAt: invites.revokedAt,
  expired: sql<boolean>`${invites.expiresAt} <= now()`,
}

type DtoRow = {
  id: string
  weddingId: string | null
  role: Role | null
  email: string | null
  note: string | null
  invitedById: string
  invitedByName: string
  acceptedById: string | null
  acceptedByName: string | null
  createdAt: Date
  expiresAt: Date
  acceptedAt: Date | null
  revokedAt: Date | null
  expired: boolean
}

function toInviteDto(row: DtoRow): InviteDto {
  const state: InviteListState =
    row.acceptedAt !== null ? 'accepted' : row.revokedAt !== null ? 'revoked' : row.expired ? 'expired' : 'pending'
  return {
    id: row.id,
    weddingId: row.weddingId,
    role: row.role,
    email: row.email,
    note: row.note,
    invitedBy: { id: row.invitedById, name: row.invitedByName },
    acceptedBy: row.acceptedById && row.acceptedByName !== null ? { id: row.acceptedById, name: row.acceptedByName } : null,
    state,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
  }
}

function selectInvites(db: Conn, where: SQL | undefined) {
  return db
    .select(dtoColumns)
    .from(invites)
    .innerJoin(inviter, eq(inviter.id, invites.invitedByUserId))
    .leftJoin(accepter, eq(accepter.id, invites.acceptedByUserId))
    .where(where)
}

export type NewInvite = {
  weddingId?: string | null
  role?: Role | null
  email?: string | null
  note?: string | null
  invitedBy: string
}

/**
 * Makes an invite that lasts 7 days. Give a wedding and a role together, or
 * neither (a new planner invite). The token is returned here and never again.
 * Throws on input the routes should have refused already.
 */
export async function createInvite(db: Conn, input: NewInvite): Promise<{ invite: InviteDto; token: string }> {
  const weddingId = input.weddingId ?? null
  const role = input.role ?? null
  if ((weddingId === null) !== (role === null)) throw new Error('createInvite: give a wedding and a role together, or neither')
  const email = input.email ? normalizeEmail(input.email) : null
  if (email !== null && !isPlausibleEmail(email)) throw new Error('createInvite: not an email address')
  const note = input.note ? wellFormedText(input.note).trim() || null : null
  if (note !== null && note.length > INVITE_NOTE_MAX) throw new Error('createInvite: notes are at most 200 characters')

  const token = newOpaqueToken()
  const [row] = await db
    .insert(invites)
    .values({
      tokenHash: hashOpaqueToken(token),
      weddingId,
      role,
      email,
      note,
      invitedByUserId: input.invitedBy,
      expiresAt: sql`now() + make_interval(days => ${INVITE_DAYS})`,
    })
    .returning({ id: invites.id })
  const [invite] = await selectInvites(db, eq(invites.id, row!.id))
  return { invite: toInviteDto(invite!), token }
}

/** Everything the checks need about one invite, found by its token's hash. */
async function inviteContext(conn: Conn, tokenHash: string) {
  const [row] = await conn
    .select({
      id: invites.id,
      weddingId: invites.weddingId,
      role: invites.role,
      email: invites.email,
      invitedById: invites.invitedByUserId,
      expiresAt: invites.expiresAt,
      acceptedAt: invites.acceptedAt,
      revokedAt: invites.revokedAt,
      expired: sql<boolean>`${invites.expiresAt} <= now()`,
      weddingName: weddings.name,
      weddingDeletedAt: weddings.deletedAt,
      inviterName: inviter.displayName,
      inviterDisabledAt: inviter.disabledAt,
      inviterIsAdmin: inviter.isAdmin,
      inviterRole: inviterMembership.role,
    })
    .from(invites)
    .innerJoin(inviter, eq(inviter.id, invites.invitedByUserId))
    .leftJoin(weddings, eq(weddings.id, invites.weddingId))
    .leftJoin(
      inviterMembership,
      and(eq(inviterMembership.weddingId, invites.weddingId), eq(inviterMembership.userId, invites.invitedByUserId)),
    )
    .where(eq(invites.tokenHash, tokenHash))
  return row ?? null
}

type InviteContext = NonNullable<Awaited<ReturnType<typeof inviteContext>>>

/** Used, revoked or expired: what the accepting UPDATE itself refuses. */
function stateProblem(row: InviteContext): InviteProblem | null {
  if (row.revokedAt !== null) return 'revoked'
  if (row.acceptedAt !== null) return 'used'
  if (row.expired) return 'expired'
  return null
}

/** Problems outside the invite row: its wedding and the person who sent it. */
function contextProblem(row: InviteContext): InviteProblem | null {
  if (row.weddingId !== null && (row.weddingName === null || row.weddingDeletedAt !== null)) return 'wedding-gone'
  if (row.inviterDisabledAt !== null) return 'inviter-disabled'
  // The sender must still be able to give what they offered: an admin always can; otherwise a
  // member of the wedding with at least that role. Only an admin can offer a planner account.
  if (!row.inviterIsAdmin && (row.weddingId === null || !roleAtLeast(row.inviterRole, row.role ?? 'owner'))) {
    return 'inviter-lost-access'
  }
  return null
}

export type InviteInfo = {
  id: string
  weddingId: string | null
  weddingName: string | null
  role: Role | null
  /** The email the invite is locked to, if any, so the sign-up form can show it. */
  email: string | null
  inviterName: string
  /** 'ok' when it can be accepted now. */
  status: 'ok' | Exclude<InviteProblem, 'not-found' | 'email-mismatch'>
  expiresAt: string
}

/** What the invite page shows. Null for an unknown or malformed token. */
export async function lookupInvite(db: Conn, token: string): Promise<InviteInfo | null> {
  if (!OPAQUE_TOKEN_PATTERN.test(token)) return null
  const row = await inviteContext(db, hashOpaqueToken(token))
  if (!row) return null
  const problem = stateProblem(row) ?? contextProblem(row)
  return {
    id: row.id,
    weddingId: row.weddingId,
    weddingName: row.weddingDeletedAt === null ? row.weddingName : null,
    role: row.role,
    email: row.email,
    inviterName: row.inviterName,
    status: (problem ?? 'ok') as InviteInfo['status'],
    expiresAt: row.expiresAt.toISOString(),
  }
}

type Refusal = InviteProblem | 'email-taken'

/** Thrown inside a transaction to roll it back with a reason. */
class Refused extends Error {
  constructor(readonly problem: Refusal) {
    super(problem)
  }
}

/**
 * Inside the caller's transaction: marks the invite accepted (one statement,
 * which only succeeds once), then checks the rest. Throws Refused on any
 * problem so the transaction rolls back.
 */
async function claimInvite(tx: Tx, tokenHash: string, email: string, acceptedBy: string | null): Promise<InviteContext> {
  const claimed = await tx
    .update(invites)
    .set({ acceptedAt: sql`now()`, acceptedByUserId: acceptedBy })
    .where(
      and(
        eq(invites.tokenHash, tokenHash),
        isNull(invites.acceptedAt),
        isNull(invites.revokedAt),
        gt(invites.expiresAt, sql`now()`),
      ),
    )
    .returning({ id: invites.id })
  const row = await inviteContext(tx, tokenHash)
  if (!row) throw new Refused('not-found')
  if (claimed.length === 0) throw new Refused(stateProblem(row) ?? 'used')
  if (row.email !== null && row.email !== email) throw new Refused('email-mismatch')
  const problem = contextProblem(row)
  if (problem) throw new Refused(problem)
  return row
}

/** The work's result, or the reason it was refused (its transaction rolled back). */
async function refusedAs<T>(work: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; problem: Refusal }> {
  try {
    return { ok: true, value: await work() }
  } catch (err) {
    if (err instanceof Refused) return { ok: false, problem: err.problem }
    throw err
  }
}

export type AcceptResult = 'ok' | InviteProblem

/** A signed-in user accepts an invite. For a planner invite there is nothing to add: it is just used up. */
export async function acceptInvite(db: Db, token: string, user: Pick<SessionUser, 'id' | 'email'>): Promise<AcceptResult> {
  if (!OPAQUE_TOKEN_PATTERN.test(token)) return 'not-found'
  const tokenHash = hashOpaqueToken(token)
  const result = await refusedAs(() =>
    db.transaction(async (tx) => {
      const invite = await claimInvite(tx, tokenHash, normalizeEmail(user.email), user.id)
      if (invite.weddingId !== null && invite.role !== null) {
        await addOrUpgradeMember(tx, invite.weddingId, user.id, invite.role, invite.invitedById)
      }
    }),
  )
  if (result.ok) return 'ok'
  // Only registration can find the email taken; an existing account never hits it.
  return result.problem === 'email-taken' ? 'used' : result.problem
}

export type RegisterResult = { status: 'ok'; user: UserDto } | { status: InviteProblem | 'email-taken' }

/**
 * Makes an account through an invite, in one transaction with accepting it:
 * if anything is refused (the invite was used a moment ago, the email has an
 * account, ...) neither the account nor the acceptance is kept. The invite is
 * checked before the (slow) password hash is made.
 */
export async function registerWithInvite(
  db: Db,
  token: string,
  input: { email: string; displayName: string; password: string },
): Promise<RegisterResult> {
  if (!OPAQUE_TOKEN_PATTERN.test(token)) return { status: 'not-found' }
  const tokenHash = hashOpaqueToken(token)
  const email = normalizeEmail(input.email)
  const before = await inviteContext(db, tokenHash)
  if (!before) return { status: 'not-found' }
  const early = stateProblem(before) ?? (before.email !== null && before.email !== email ? 'email-mismatch' : null)
  if (early) return { status: early }
  const passwordHash = await hashUserPassword(input.password)

  const result = await refusedAs(() =>
    db.transaction(async (tx): Promise<UserDto> => {
      const invite = await claimInvite(tx, tokenHash, email, null)
      const created = await insertUser(tx, { email, displayName: input.displayName, passwordHash, isAdmin: false })
      if (created.status === 'email-taken') throw new Refused('email-taken')
      await tx.update(invites).set({ acceptedByUserId: created.user.id }).where(eq(invites.id, invite.id))
      if (invite.weddingId !== null && invite.role !== null) {
        await addOrUpgradeMember(tx, invite.weddingId, created.user.id, invite.role, invite.invitedById)
      }
      return created.user
    }),
  )
  return result.ok ? { status: 'ok', user: result.value } : { status: result.problem }
}

/** Cancels an invite nobody has used yet. False when it was used, already cancelled, or not there. */
export async function revokeInvite(db: Conn, id: string): Promise<boolean> {
  const revoked = await db
    .update(invites)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(invites.id, id), isNull(invites.acceptedAt), isNull(invites.revokedAt)))
    .returning({ id: invites.id })
  return revoked.length > 0
}

/** A wedding's invites, or (null) the planner invites, newest first. */
export async function listInvites(db: Conn, weddingId: string | null): Promise<InviteDto[]> {
  const rows = await selectInvites(db, weddingId === null ? isNull(invites.weddingId) : eq(invites.weddingId, weddingId)).orderBy(
    desc(invites.createdAt),
    desc(invites.id),
  )
  return rows.map(toInviteDto)
}
