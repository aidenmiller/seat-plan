import { json, readBody } from '@/server/api-route'
import { withWeddingRole } from '@/server/auth/guards'
import { byWeddingId } from '@/server/auth/resolvers'
import { getDb } from '@/server/db/client'
import { recordEvent } from '@/server/repo/activity'
import { createInvite, listInvites } from '@/server/repo/invites'
import { createInviteBody, type CreatedInvite, type InviteSummary } from '@/shared/accounts-api'

/** Owners: InviteSummary[], the wedding's invites newest first, in every state. Never their tokens. */
export const GET = withWeddingRole(byWeddingId, 'owner', async (_req, _ctx, access) => {
  const invites: InviteSummary[] = await listInvites(getDb(), access.weddingId)
  return json(invites)
})

/**
 * Owners: a new invite link for the wedding, as an owner or an editor, maybe
 * locked to one email. 201 CreatedInvite: its token is in this reply only, for
 * the browser to build the link and show it once.
 */
export const POST = withWeddingRole(byWeddingId, 'owner', async (req, _ctx, access) => {
  const body = await readBody(req, createInviteBody)
  if (!body.ok) return body.response
  const db = getDb()
  const { invite, token } = await createInvite(db, {
    weddingId: access.weddingId,
    role: body.data.role,
    email: body.data.email ?? null,
    note: body.data.note ?? null,
    invitedBy: access.user.id,
  })
  await recordEvent(db, {
    kind: 'invite_created',
    userId: access.user.id,
    weddingId: access.weddingId,
    subjectId: invite.id,
    detail: { role: invite.role, emailLocked: invite.email !== null },
  })
  const reply: CreatedInvite = { invite, token }
  return json(reply, 201)
})
