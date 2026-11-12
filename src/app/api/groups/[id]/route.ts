import type { NextRequest } from 'next/server'
import { updateGroupBody } from '@/shared/api'
import { idParam, json, notFound, readBody, refuseUnstorableText, type IdContext } from '@/server/api-route'
import { withWeddingRole } from '@/server/auth/guards'
import { byGroupId } from '@/server/auth/resolvers'
import { getDb } from '@/server/db/client'
import { NAME_TAKEN_MESSAGE, deleteGroup, updateGroup } from '@/server/repo/groups'

/** Group: rename or recolor. 409 { error: 'name_taken' } when another group has that name, ignoring case. Any member. */
export const PATCH = withWeddingRole(byGroupId, 'editor', async (req: NextRequest, ctx: IdContext, access) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const body = await readBody(req, updateGroupBody)
  if (!body.ok) return body.response
  const write = await refuseUnstorableText(() => updateGroup(getDb(), access.weddingId, id, body.data))
  if (!write.ok) return write.response
  const result = write.value
  switch (result.status) {
    case 'updated':
      return json(result.group)
    case 'name-taken':
      return json({ error: 'name_taken', message: NAME_TAKEN_MESSAGE }, 409)
    case 'not-found':
      return notFound()
  }
})

/** { ok: true }: deletes the group outright, with its member links (DECISIONS 31). Guests stay. Any member. */
export const DELETE = withWeddingRole(byGroupId, 'editor', async (_req: NextRequest, ctx: IdContext, access) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  return (await deleteGroup(getDb(), access.weddingId, id)) ? json({ ok: true }) : notFound()
})
