/**
 * Typed calls for the people and account routes (src/shared/accounts-api.ts),
 * through the same helper as every other screen (src/client/api.ts), so each
 * throws an ApiRequestError on a non-2xx reply.
 *
 * Invite and reset tokens go only in a JSON body, to a fixed path: never in a
 * path or a query string, which servers and proxies write to their logs.
 */
import type {
  AccountInfo,
  AccountSession,
  AdminUser,
  AdminWedding,
  ChangeMemberRoleBody,
  ChangePasswordBody,
  CreatedInvite,
  CreatedResetLink,
  CreateInviteBody,
  CreatePlannerInviteBody,
  InviteAccepted,
  InviteLookup,
  InviteSummary,
  RegisterWithInviteBody,
  ResetLookup,
  WeddingMember,
} from '@/shared/accounts-api'
import { request } from './api'

const enc = encodeURIComponent

// ---------- Members and invites ----------

export const listMembers = (weddingId: string) => request<WeddingMember[]>('GET', `/api/weddings/${enc(weddingId)}/members`)

export const changeMemberRole = (weddingId: string, userId: string, body: ChangeMemberRoleBody) =>
  request<WeddingMember>('PATCH', `/api/weddings/${enc(weddingId)}/members/${enc(userId)}`, body)

/** Removes a member, or (your own id) leaves the wedding. */
export const removeMember = (weddingId: string, userId: string) =>
  request<{ ok: true }>('DELETE', `/api/weddings/${enc(weddingId)}/members/${enc(userId)}`)

export const listWeddingInvites = (weddingId: string) => request<InviteSummary[]>('GET', `/api/weddings/${enc(weddingId)}/invites`)

export const createWeddingInvite = (weddingId: string, body: CreateInviteBody) =>
  request<CreatedInvite>('POST', `/api/weddings/${enc(weddingId)}/invites`, body)

export const revokeInvite = (inviteId: string) => request<{ ok: true }>('DELETE', `/api/invites/${enc(inviteId)}`)

// ---------- The invite and reset pages (public routes) ----------

export const lookupInvite = (token: string) => request<InviteLookup>('POST', '/api/invites/lookup', { token })

export const registerWithInvite = (body: RegisterWithInviteBody) => request<InviteAccepted>('POST', '/api/invites/register', body)

/** Signed in: accepts the invite for this account. */
export const acceptInvite = (token: string) => request<InviteAccepted>('POST', '/api/invites/accept', { token })

export const lookupReset = (token: string) => request<ResetLookup>('POST', '/api/auth/reset', { token })

export const completeReset = (token: string, password: string) => request<{ ok: true }>('POST', '/api/auth/reset', { token, password })

/**
 * Signs in from the invite page, which then shows the invite to the signed-in
 * account. The reply names the account, for the other tabs
 * (src/app/invite/invite-session.ts). Signing out has no call here: it always
 * goes through src/client/sign-out.ts, which sends and asks first.
 */
export const signIn = (email: string, password: string) =>
  request<{ ok: true; userId?: string; redirect?: string }>('POST', '/api/auth/login', { email, password })

// ---------- The account page ----------

export const updateAccount = (displayName: string) => request<AccountInfo>('PATCH', '/api/account', { displayName })

export const changePassword = (body: ChangePasswordBody) => request<{ ok: true }>('POST', '/api/account/password', body)

export const listAccountSessions = () => request<AccountSession[]>('GET', '/api/account/sessions')

export const endAccountSession = (sessionId: string) => request<{ ok: true }>('DELETE', `/api/account/sessions/${enc(sessionId)}`)

export const endOtherSessions = () => request<{ ended: number }>('POST', '/api/account/sessions/revoke-others')

// ---------- Admin ----------

export const listAdminUsers = () => request<AdminUser[]>('GET', '/api/admin/users')

export const setUserDisabled = (userId: string, disabled: boolean) =>
  request<AdminUser>('PATCH', `/api/admin/users/${enc(userId)}`, { disabled })

export const createResetLink = (userId: string) => request<CreatedResetLink>('POST', `/api/admin/users/${enc(userId)}/reset-link`)

export const signOutUser = (userId: string) => request<{ ended: number }>('POST', `/api/admin/users/${enc(userId)}/sign-out`)

export const listPlannerInvites = () => request<InviteSummary[]>('GET', '/api/admin/invites')

export const createPlannerInvite = (body: CreatePlannerInviteBody) => request<CreatedInvite>('POST', '/api/admin/invites', body)

export const revokePlannerInvite = (inviteId: string) => request<{ ok: true }>('DELETE', `/api/admin/invites/${enc(inviteId)}`)

export const listAdminWeddings = () => request<AdminWedding[]>('GET', '/api/admin/weddings')

export const claimWedding = (weddingId: string) => request<AdminWedding>('POST', `/api/admin/weddings/${enc(weddingId)}/claim`)
