import type { NextRequest } from 'next/server'
import { createGroupBody } from '@/shared/api'
import { idParam, json, notFound, readBody, refuseUnstorableText, type IdContext } from '@/server/api-route'
import { withSiteAuth } from '@/server/auth/require'
import { getDb } from '@/server/db/client'
import { NAME_TAKEN_MESSAGE, createGroup, listGroups } from '@/server/repo/groups'

/** Group[]: the wedding's groups by name, each with its live members. */
export const GET = withSiteAuth(async (_req: NextRequest, ctx: IdContext) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const list = await listGroups(getDb(), id)
  return list ? json(list) : notFound()
})

/**
 * 201 Group. Without a color it takes the next palette color. 409
 * { error: 'name_taken' } when a group has that name, ignoring case.
 */
export const POST = withSiteAuth(async (req: NextRequest, ctx: IdContext) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const body = await readBody(req, createGroupBody)
  if (!body.ok) return body.response
  const write = await refuseUnstorableText(() => createGroup(getDb(), id, body.data))
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
