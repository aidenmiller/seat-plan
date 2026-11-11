import { json, notFound, readBody } from '@/server/api-route'
import { lastOwner, recordAdminOwnerPower, userIdParam, type MemberContext } from '@/server/accounts-route'
import { effectiveRole, needsAdminPower, roleAtLeast } from '@/server/auth/access'
import { forbidden, withWeddingRole } from '@/server/auth/guards'
import { byWeddingId } from '@/server/auth/resolvers'
import { getDb } from '@/server/db/client'
import { recordEvent } from '@/server/repo/activity'
import { changeRole, listMembers, removeMember } from '@/server/repo/members'
import { changeMemberRoleBody, type WeddingMember } from '@/shared/accounts-api'

/**
 * Owners: makes a member an owner or an editor. Replies with the
 * WeddingMember. 409 when it would leave the wedding with no owner; 404 for
 * someone who is not a member.
 */
export const PATCH = withWeddingRole<MemberContext>(byWeddingId, 'owner', async (req, ctx, access) => {
  const userId = await userIdParam(ctx)
  if (!userId) return notFound()
  const body = await readBody(req, changeMemberRoleBody)
  if (!body.ok) return body.response
  const db = getDb()
  const result = await changeRole(db, access.weddingId, userId, body.data.role)
  if (result === 'not-found') return notFound()
  if (result === 'last-owner') return lastOwner()
  await recordEvent(db, {
    kind: 'member_role_changed',
    userId: access.user.id,
    weddingId: access.weddingId,
    subjectId: userId,
    detail: { role: body.data.role },
  })
  const member: WeddingMember | undefined = (await listMembers(db, access.weddingId)).find((m) => m.userId === userId)
  return member ? json(member) : notFound()
})

/**
 * Takes someone out of the wedding. An owner may remove anyone; any member may
 * remove themselves (leave). An editor removing someone else gets 403. Never
 * the last owner (409), so a wedding is never left with nobody to run it.
 */
export const DELETE = withWeddingRole<MemberContext>(byWeddingId, 'editor', async (req, ctx, access) => {
  const userId = await userIdParam(ctx)
  if (!userId) return notFound()
  const leaving = userId === access.user.id
  if (!leaving) {
    if (!roleAtLeast(effectiveRole(access.role, access.user.isAdmin), 'owner')) return forbidden()
    // The guard checked for an editor; removing someone else needs an owner, which this admin is only by their power.
    if (!access.viaAdmin && needsAdminPower(access.role, access.user.isAdmin, 'owner')) {
      await recordAdminOwnerPower(req, access, byWeddingId.name)
    }
  }
  const db = getDb()
  const result = await removeMember(db, access.weddingId, userId)
  if (result === 'not-found') return notFound()
  if (result === 'last-owner') return lastOwner(leaving)
  await recordEvent(db, {
    kind: 'member_removed',
    userId: access.user.id,
    weddingId: access.weddingId,
    subjectId: userId,
    detail: { left: leaving },
  })
  return json({ ok: true })
})
