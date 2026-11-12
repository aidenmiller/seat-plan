/**
 * The contract for people and accounts: wedding members, invite links, reset
 * links, the account page and the admin pages. Request bodies (Zod, checked
 * on the server) and reply shapes (types), as in src/shared/api.ts.
 *
 * Invite and reset tokens travel only in JSON bodies, never in a path or a
 * query string, so they stay out of server logs. A reply carries a token only
 * once: when the invite or reset link is made.
 */
import { z } from 'zod'
import { EMAIL_MAX, PASSWORD_MAX, PASSWORD_MIN, cleanDisplayName, isPlausibleEmail, normalizeEmail } from '@/domain/accounts'
import { wellFormedText } from '@/domain/canvas-schema'

export type Role = 'owner' | 'editor'
const role = z.enum(['owner', 'editor'])

/** The invites table refuses longer notes (invites_note_length). */
export const INVITE_NOTE_MAX = 200

/**
 * An invite or reset token. Its exact shape (43 base64url characters) is
 * checked by the lookups, which treat anything else as unknown; here only
 * its size is limited.
 */
const token = z.string().min(1, 'The link is missing its code').max(200)

const email = z
  .string()
  .max(EMAIL_MAX + 50)
  .transform(normalizeEmail)
  .refine(isPlausibleEmail, 'Enter an email address')

/** An email to lock an invite to. Empty or missing means anyone with the link. */
const optionalEmail = z
  .string()
  .max(EMAIL_MAX + 50)
  .transform(normalizeEmail)
  .refine((v) => v === '' || isPlausibleEmail(v), 'Enter an email address, or leave it empty')
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional()

const note = z
  .string()
  .max(1000)
  .overwrite(wellFormedText)
  .trim()
  .max(INVITE_NOTE_MAX, `Notes are at most ${INVITE_NOTE_MAX} characters`)
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional()

const displayName = z
  .string()
  .max(500)
  .transform((name, ctx) => {
    const cleaned = cleanDisplayName(name)
    if (cleaned === null) {
      ctx.addIssue({ code: 'custom', message: 'Names are 1 to 60 characters' })
      return z.NEVER
    }
    return cleaned
  })

const newPassword = z
  .string()
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`)
  .max(PASSWORD_MAX, `Use at most ${PASSWORD_MAX} characters`)

// ---------- Members ----------

/** GET /api/weddings/:id/members: owners first, then by name. */
export type WeddingMember = {
  userId: string
  email: string
  displayName: string
  role: Role
  /** The account is turned off: they cannot sign in until an admin turns it back on. */
  disabled: boolean
  addedAt: string
}

/** PATCH /api/weddings/:id/members/:userId. Owners only. 409 when it would leave no owner. */
export const changeMemberRoleBody = z.object({ role })
export type ChangeMemberRoleBody = z.input<typeof changeMemberRoleBody>

// DELETE /api/weddings/:id/members/:userId: an owner removes anyone, any member
// removes themselves (leaves). 409 for the last owner.

// ---------- Invites ----------

export type InviteState = 'pending' | 'accepted' | 'expired' | 'revoked'

/** An invite as its wedding's owners (or, for planner invites, the admins) see it. Never holds the token. */
export type InviteSummary = {
  id: string
  /** Null for a planner invite (an admin's "new planner" link). */
  weddingId: string | null
  role: Role | null
  /** Only this email can use it; null for anyone with the link. */
  email: string | null
  note: string | null
  invitedBy: { id: string; name: string }
  acceptedBy: { id: string; name: string } | null
  state: InviteState
  createdAt: string
  expiresAt: string
  acceptedAt: string | null
}

/** POST /api/weddings/:id/invites. Owners only. 201 CreatedInvite. */
export const createInviteBody = z.object({ role, email: optionalEmail, note })
export type CreateInviteBody = z.input<typeof createInviteBody>

/** POST /api/admin/invites: a link for a new planner (an account with no wedding). 201 CreatedInvite. */
export const createPlannerInviteBody = z.object({ email: optionalEmail, note })
export type CreatePlannerInviteBody = z.input<typeof createPlannerInviteBody>

/**
 * A new invite and its token. The token is in this reply and nowhere else,
 * ever: the browser builds the link (/invite#<token>) from it and shows it once.
 */
export type CreatedInvite = { invite: InviteSummary; token: string }

/** POST /api/invites/lookup and POST /api/invites/accept. */
export const inviteTokenBody = z.object({ token })
export type InviteTokenBody = z.input<typeof inviteTokenBody>

/** Why an invite cannot be used. */
export type InviteProblem =
  | 'used'
  | 'expired'
  | 'revoked'
  | 'email-mismatch'
  | 'wedding-gone'
  | 'inviter-disabled'
  | 'inviter-lost-access'

/**
 * POST /api/invites/lookup: what the invite page shows (404 for an unknown
 * link). The names and the email it is locked to come back only while the
 * invite can still be used; a used, expired or cancelled link says only that.
 */
export type InviteLookup =
  | {
      status: 'ok'
      /** 'wedding': join a wedding as `role`. 'planner': make an account with no wedding. */
      kind: 'wedding' | 'planner'
      weddingName: string | null
      role: Role | null
      inviterName: string
      /** The only email that can use it, or null for anyone with the link. */
      email: string | null
      expiresAt: string
    }
  | { status: Exclude<InviteProblem, 'email-mismatch'> }

/** POST /api/invites/register: makes the account, accepts the invite and signs in. */
export const registerWithInviteBody = z.object({ token, email, displayName, password: newPassword })
export type RegisterWithInviteBody = z.input<typeof registerWithInviteBody>

/**
 * A 200 from register or accept: where to go next (the wedding, or home for a
 * planner invite). Refusals are 404 { error: 'not_found' } for an unknown
 * link, or 409 InviteRefusal.
 */
export type InviteAccepted = { ok: true; redirect: string }

/** 409 from register or accept. 'email_taken' only from register, and only to someone holding a working link. */
export type InviteRefusal = { error: 'invite_unusable'; reason: InviteProblem; message: string } | { error: 'email_taken'; message: string }

// ---------- Reset links ----------

/**
 * POST /api/auth/reset. With only the token it looks the link up
 * (ResetLookup); with a password too it sets that password (200 { ok: true }),
 * ends every session the account had, and the person then signs in as usual.
 * One path for both, because only that exact path is open without a session.
 * 404 { error: 'not_found' } for an unknown link; 409 { error: 'reset_unusable', reason } for a used or expired one.
 */
export const resetBody = z.object({ token, password: newPassword.optional() })
export type ResetBody = z.input<typeof resetBody>

/** Whose link it is, only while it still works. */
export type ResetLookup = { status: 'ok'; displayName: string; email: string; expiresAt: string } | { status: 'used' | 'expired' }

/** POST /api/admin/users/:id/reset-link. 201. The token is in this reply and nowhere else, ever. */
export type CreatedResetLink = { token: string; expiresAt: string }

// ---------- The account page ----------

/** PATCH /api/account. Replies with the AccountInfo. */
export const updateAccountBody = z.object({ displayName })
export type UpdateAccountBody = z.input<typeof updateAccountBody>

export type AccountInfo = { id: string; email: string; displayName: string }

/**
 * POST /api/account/password. 200 { ok: true } with a new session cookie for
 * this browser; every other session ends. 403 { error: 'wrong_password' } when
 * `current` is wrong, 429 after too many wrong tries.
 */
export const changePasswordBody = z.object({
  current: z.string().min(1, 'Enter your current password').max(PASSWORD_MAX),
  next: newPassword,
})
export type ChangePasswordBody = z.input<typeof changePasswordBody>

/** GET /api/account/sessions: the caller's own sign-ins, most recently used first. */
export type AccountSession = {
  id: string
  userAgent: string | null
  createdAt: string
  lastSeenAt: string
  /** The session this request came from. */
  current: boolean
}

// DELETE /api/account/sessions/:id signs one of your own sessions out.
// POST /api/account/sessions/revoke-others signs out all but this one: 200 { ended: number }.

// ---------- Admin ----------

/** GET /api/admin/users: everyone, oldest account first. */
export type AdminUser = {
  id: string
  email: string
  displayName: string
  isAdmin: boolean
  disabled: boolean
  createdAt: string
  disabledAt: string | null
  lastLoginAt: string | null
  lastSeenAt: string | null
  /** Live weddings they belong to. */
  weddingCount: number
}

/**
 * PATCH /api/admin/users/:id. Send `disabled` (turn the account off or on) or
 * `admin` (make or remove an admin), one at a time. Replies with the
 * AdminUser. 409 for yourself (off, or removing your own admin), for the last
 * admin who is on, and for making a turned-off account an admin.
 */
export const updateUserBody = z
  .object({ disabled: z.boolean().optional(), admin: z.boolean().optional() })
  .refine((b) => (b.disabled === undefined) !== (b.admin === undefined), 'Send either disabled or admin')
export type UpdateUserBody = z.input<typeof updateUserBody>

// POST /api/admin/users/:id/sign-out ends every session the user has: 200 { ended: number }.

/** GET /api/admin/weddings: every wedding, deleted ones too, oldest first. */
export type AdminWedding = {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  guestCount: number
  layoutCount: number
  members: { userId: string; displayName: string; email: string; role: Role }[]
}

// POST /api/admin/weddings/:id/claim makes the admin its owner, only while it has none. Replies with the AdminWedding.
