import type { NextRequest } from 'next/server'
import { uuid } from '@/shared/api'
import { json, notFound } from '@/server/api-route'
import { withWeddingRole } from '@/server/auth/guards'
import { byGroupId } from '@/server/auth/resolvers'
import { getDb } from '@/server/db/client'
import { removeGroupMember } from '@/server/repo/groups'

type MemberContext = { params: Promise<{ id: string; guestId: string }> }

/** Group: takes one guest out of the group. A guest who was not in it changes nothing. Any member. */
export const DELETE = withWeddingRole<MemberContext>(byGroupId, 'editor', async (_req: NextRequest, ctx: MemberContext, access) => {
  const { id, guestId } = await ctx.params
  if (!uuid.safeParse(id).success || !uuid.safeParse(guestId).success) return notFound()
  const group = await removeGroupMember(getDb(), access.weddingId, id.toLowerCase(), guestId.toLowerCase())
  return group ? json(group) : notFound()
})
