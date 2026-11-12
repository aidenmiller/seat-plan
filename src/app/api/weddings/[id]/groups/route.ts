import type { NextRequest } from 'next/server'
import { createGroupBody } from '@/shared/api'
import { json, notFound, readBody, refuseUnstorableText, type IdContext } from '@/server/api-route'
import { withWeddingRole } from '@/server/auth/guards'
import { byWeddingId } from '@/server/auth/resolvers'
import { getDb } from '@/server/db/client'
import { NAME_TAKEN_MESSAGE, createGroup, listGroups } from '@/server/repo/groups'

/** Group[]: the wedding's groups by name, each with its live members. Any member. */
export const GET = withWeddingRole(byWeddingId, 'editor', async (_req: NextRequest, _ctx: IdContext, access) => {
  const list = await listGroups(getDb(), access.weddingId)
  return list ? json(list) : notFound()
})

/**
 * 201 Group. Without a color it takes the next palette color. 409
 * { error: 'name_taken' } when a group has that name, ignoring case. Any member.
 */
export const POST = withWeddingRole(byWeddingId, 'editor', async (req: NextRequest, _ctx: IdContext, access) => {
  const body = await readBody(req, createGroupBody)
  if (!body.ok) return body.response
  const write = await refuseUnstorableText(() => createGroup(getDb(), access.weddingId, body.data))
  if (!write.ok) return write.response
  const result = write.value
  switch (result.status) {
    case 'created':
      return json(result.group, 201)
    case 'name-taken':
      return json({ error: 'name_taken', message: NAME_TAKEN_MESSAGE }, 409)
    case 'id-taken':
      return json({ error: 'id_taken' }, 409)
    case 'invalid':
      return json({ error: 'invalid', issues: result.issues }, 422)
    case 'not-found':
      return notFound()
  }
})
