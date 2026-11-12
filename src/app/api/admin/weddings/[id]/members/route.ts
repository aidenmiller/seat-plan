import { idParam, json, notFound, readBody, type IdContext } from '@/server/api-route'
import { withAdmin } from '@/server/auth/guards'
import { getDb } from '@/server/db/client'
import { recordEvent } from '@/server/repo/activity'
import { adminAddMember } from '@/server/repo/admin-weddings'
import { listMembers } from '@/server/repo/members'
import type { WeddingMember } from '@/shared/accounts-api'
import { adminAddMemberBody } from '@/shared/admin-api'
import { adminMemberRefused } from '../../../_admin-route'

/**
 * Admins: adds someone who already has an account to a live wedding, with
 * no invite. 201 with the WeddingMember. 409 already_member when they belong
 * already (change their role with PATCH /api/weddings/:id/members/:userId,
 * which an admin may use on any wedding), 409 deleted for a deleted wedding,
 * 409 user_disabled for an account that is off, 422 for an id with no account.
 */
export const POST = withAdmin(async (req, ctx: IdContext, admin) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const body = await readBody(req, adminAddMemberBody)
  if (!body.ok) return body.response
  const { userId, role } = body.data
  const db = getDb()
  const result = await adminAddMember(db, id, userId.toLowerCase(), role, admin.id)
  if (result === 'exists') return json({ error: 'already_member', message: 'They belong to this wedding already.' }, 409)
  if (result !== 'added') return adminMemberRefused(result)
  await recordEvent(db, { kind: 'member_added', userId: admin.id, weddingId: id, subjectId: userId, detail: { role, byAdmin: true } })
  const member: WeddingMember | undefined = (await listMembers(db, id)).find((m) => m.userId === userId.toLowerCase())
  return member ? json(member, 201) : notFound()
})
