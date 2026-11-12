import 'server-only'
import type { NextRequest } from 'next/server'
import { LAST_OWNER_LEAVE_MESSAGE, LAST_OWNER_MESSAGE, inviteProblemMessage } from '@/domain/account-wording'
import type { InviteProblem } from '@/shared/accounts-api'
import { uuid } from '@/shared/api'
import { json } from './api-route'
import { runAfterResponse } from './after-response'
import type { WeddingAccess } from './auth/access'
import { addressKey, clientAddress } from './auth/throttle'
import { getDb } from './db/client'
import { recordEvent } from './repo/activity'

/**
 * Helpers shared by the people and account routes (members, invites, reset
 * links, the account page and the admin pages).
 */

/**
 * Throttle scopes (src/server/auth/throttle.ts), each counted per address
 * only, never across all addresses: the tokens are 32 random bytes, so the
 * limits are there to slow scanners and the password hashing, and a count
 * across every address would let anyone block every invite or reset link.
 */
/** Invite lookups and sign-ups through an invite. Cleared when a sign-up succeeds. */
export const INVITE_SCOPE = 'invite'
/** Reset link lookups and resets. Cleared when a reset succeeds. */
export const RESET_SCOPE = 'reset'

/**
 * Wrong current passwords on the account page, for one account. Counted per
 * address and across addresses too: only someone holding that account's
 * session can add to the count, so it can lock out nobody else.
 */
export function accountPasswordScope(userId: string): string {
  return `account-password:${userId}`
}

/** The hashed client address the throttle counts by. */
export function requestAddressKey(req: NextRequest): string {
  return addressKey(clientAddress(req.headers))
}

export function tooManyAttempts(retryAfterSeconds: number): Response {
  const res = json({ error: 'too_many_attempts', retryAfterSeconds }, 429)
  res.headers.set('Retry-After', String(retryAfterSeconds))
  return res
}

/** 409 for an invite that cannot be used, with the sentence the invite page shows. */
export function inviteRefused(reason: InviteProblem): Response {
  return json({ error: 'invite_unusable', reason, message: inviteProblemMessage(reason) }, 409)
}

/** 409 for a change that would leave a wedding with no owner. */
export function lastOwner(leaving = false): Response {
  return json({ error: 'last_owner', message: leaving ? LAST_OWNER_LEAVE_MESSAGE : LAST_OWNER_MESSAGE }, 409)
}

/** The context of a handler under weddings/[id]/members/[userId]. */
export type MemberContext = { params: Promise<{ id: string; userId: string }> }

/** The [userId] param when it is a uuid, lower-cased; null otherwise (answered with 404). */
export async function userIdParam(ctx: MemberContext): Promise<string | null> {
  const { userId } = await ctx.params
  return uuid.safeParse(userId).success ? userId.toLowerCase() : null
}

/**
 * Logs an admin using their admin power for an owner-only change in a route
 * whose guard only needed an editor (removing someone else from a wedding),
 * the way the guards log admin_access for routes that need an owner.
 */
export async function recordAdminOwnerPower(req: NextRequest, access: WeddingAccess, resolver: string): Promise<void> {
  await runAfterResponse(() =>
    recordEvent(getDb(), {
      kind: 'admin_access',
      userId: access.user.id,
      weddingId: access.weddingId,
      detail: { method: req.method, path: req.nextUrl.pathname.slice(0, 200), resolver, write: true },
    }),
  )
}
