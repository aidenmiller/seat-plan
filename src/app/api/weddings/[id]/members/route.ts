import { json } from '@/server/api-route'
import { withWeddingRole } from '@/server/auth/guards'
import { byWeddingId } from '@/server/auth/resolvers'
import { getDb } from '@/server/db/client'
import { listMembers } from '@/server/repo/members'
import type { WeddingMember } from '@/shared/accounts-api'

/** WeddingMember[]: who belongs to the wedding, owners first. Any member may see the list. */
export const GET = withWeddingRole(byWeddingId, 'editor', async (_req, _ctx, access) => {
  const members: WeddingMember[] = await listMembers(getDb(), access.weddingId)
  return json(members)
})
