import { json, readBody } from '@/server/api-route'
import { withAdmin } from '@/server/auth/guards'
import { getDb } from '@/server/db/client'
import { recordEvent } from '@/server/repo/activity'
import { createInvite, listInvites } from '@/server/repo/invites'
import { createPlannerInviteBody, type CreatedInvite, type InviteSummary } from '@/shared/accounts-api'

/** Admins: InviteSummary[], the planner invites (no wedding) newest first, in every state. Never their tokens. */
export const GET = withAdmin(async () => {
  const invites: InviteSummary[] = await listInvites(getDb(), null)
  return json(invites)
})

/**
 * Admins: a link for a new planner, maybe locked to one email. Accepting it
 * makes an account that belongs to no wedding yet. 201 CreatedInvite: the
 * token is in this reply only.
 */
export const POST = withAdmin(async (req, _ctx, admin) => {
  const body = await readBody(req, createPlannerInviteBody)
  if (!body.ok) return body.response
  const db = getDb()
  const { invite, token } = await createInvite(db, { email: body.data.email ?? null, note: body.data.note ?? null, invitedBy: admin.id })
  await recordEvent(db, {
    kind: 'invite_created',
    userId: admin.id,
    subjectId: invite.id,
    detail: { planner: true, emailLocked: invite.email !== null },
  })
  const reply: CreatedInvite = { invite, token }
  return json(reply, 201)
})
