import type { NextRequest } from 'next/server'
import { updateGroupBody } from '@/shared/api'
import { idParam, json, notFound, readBody, refuseUnstorableText, type IdContext } from '@/server/api-route'
import { withSiteAuth } from '@/server/auth/require'
import { getDb } from '@/server/db/client'
import { NAME_TAKEN_MESSAGE, deleteGroup, updateGroup } from '@/server/repo/groups'

/** Group: rename or recolor. 409 { error: 'name_taken' } when another group has that name, ignoring case. */
export const PATCH = withSiteAuth(async (req: NextRequest, ctx: IdContext) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const body = await readBody(req, updateGroupBody)
  if (!body.ok) return body.response
  const write = await refuseUnstorableText(() => updateGroup(getDb(), id, body.data))
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

/** { ok: true }: deletes the group outright, with its member links (DECISIONS 31). Guests stay. */
export const DELETE = withSiteAuth(async (_req: NextRequest, ctx: IdContext) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  return (await deleteGroup(getDb(), id)) ? json({ ok: true }) : notFound()
})
