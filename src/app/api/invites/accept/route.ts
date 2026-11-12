import { json, notFound, readBody } from '@/server/api-route'
import { inviteRefused } from '@/server/accounts-route'
import { withUser } from '@/server/auth/guards'
import { getDb } from '@/server/db/client'
import { recordEvent } from '@/server/repo/activity'
import { acceptInvite, lookupInvite } from '@/server/repo/invites'
import { inviteTokenBody, type InviteAccepted } from '@/shared/accounts-api'

/**
 * The signed-in user accepts an invite: they join its wedding with its role
 * (never lowering a role they already have). 200 InviteAccepted with where to
 * go; 404 for an unknown link; 409 InviteRefusal for a used, expired or
 * cancelled link, or one locked to another email.
 */
export const POST = withUser(async (req, _ctx, user) => {
  const body = await readBody(req, inviteTokenBody)
  if (!body.ok) return body.response
  const db = getDb()
  const info = await lookupInvite(db, body.data.token)
  if (!info) return notFound()
  const result = await acceptInvite(db, body.data.token, user)
  if (result === 'not-found') return notFound()
  if (result !== 'ok') return inviteRefused(result)
  await recordEvent(db, {
    kind: 'invite_accepted',
    userId: user.id,
    weddingId: info.weddingId,
    subjectId: info.id,
    detail: { role: info.role, newAccount: false },
  })
  const reply: InviteAccepted = { ok: true, redirect: info.weddingId ? `/w/${info.weddingId}/layouts` : '/' }
  return json(reply)
})
