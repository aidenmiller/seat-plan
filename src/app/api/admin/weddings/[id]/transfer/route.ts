import { lastOwner } from '@/server/accounts-route'
import { idParam, json, notFound, readBody, type IdContext } from '@/server/api-route'
import { withAdmin } from '@/server/auth/guards'
import { getDb } from '@/server/db/client'
import { recordEvent } from '@/server/repo/activity'
import { transferOwnership } from '@/server/repo/admin-weddings'
import { listMembers } from '@/server/repo/members'
import type { WeddingMember } from '@/shared/accounts-api'
import { transferOwnershipBody } from '@/shared/admin-api'
import { adminMemberRefused } from '../../../_admin-route'

/**
 * Admins: makes someone an owner of a live wedding (adding them if they do
 * not belong), and with keepPreviousAsEditors makes its other owners editors,
 * in one transaction (transferOwnership). Replies with the members
 * (WeddingMember[]). 409 deleted, 409 user_disabled, 422 for an id with no
 * account, 409 last_owner should the wedding somehow be left with no owner.
 */
export const POST = withAdmin(async (req, ctx: IdContext, admin) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const body = await readBody(req, transferOwnershipBody)
  if (!body.ok) return body.response
  const toUserId = body.data.toUserId.toLowerCase()
  const demote = body.data.keepPreviousAsEditors
  const db = getDb()
  const result = await transferOwnership(db, id, toUserId, demote, admin.id)
  if (result.status === 'last-owner') return lastOwner()
  if (result.status !== 'ok') return adminMemberRefused(result.status)
  await recordEvent(db, {
    kind: 'ownership_transferred',
    userId: admin.id,
    weddingId: id,
    subjectId: toUserId,
    detail: { previousOwners: result.previousOwners, previousNowEditors: demote },
  })
  const members: WeddingMember[] = await listMembers(db, id)
  return json(members)
})
