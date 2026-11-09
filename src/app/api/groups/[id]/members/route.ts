import type { NextRequest } from 'next/server'
import { addGroupMembersBody, type AddGroupMembersReply } from '@/shared/api'
import { idParam, json, notFound, readBody, type IdContext } from '@/server/api-route'
import { withSiteAuth } from '@/server/auth/require'
import { getDb } from '@/server/db/client'
import { addGroupMembers } from '@/server/repo/groups'

/**
 * AddGroupMembersReply: adds guests to the group at once. Guests already in
 * it are skipped; a guest who is not on this wedding's list refuses the lot (422).
 */
export const POST = withSiteAuth(async (req: NextRequest, ctx: IdContext) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const body = await readBody(req, addGroupMembersBody)
  if (!body.ok) return body.response
  const result = await addGroupMembers(getDb(), id, body.data.guestIds)
  switch (result.status) {
    case 'done': {
      const reply: AddGroupMembersReply = { group: result.group, added: result.added }
      return json(reply)
    }
    case 'invalid':
      return json({ error: 'invalid', issues: result.issues }, 422)
    case 'not-found':
      return notFound()
  }
})
