import type { NextRequest } from 'next/server'
import { updateShareLinkBody } from '@/shared/api'
import { idParam, json, notFound, readBody, type IdContext } from '@/server/api-route'
import { withWeddingRole } from '@/server/auth/guards'
import { byShareLinkId } from '@/server/auth/resolvers'
import { getDb } from '@/server/db/client'
import { deleteShareLink, updateShareLink } from '@/server/repo/share-links'

/**
 * Label, password, on or off, names and notes. A new password or turning the
 * link off signs out everyone using it. Owners only. Replies with the ShareLink.
 */
export const PATCH = withWeddingRole(byShareLinkId, 'owner', async (req: NextRequest, ctx: IdContext, access) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const body = await readBody(req, updateShareLinkBody)
  if (!body.ok) return body.response
  const link = await updateShareLink(getDb(), access.weddingId, id, body.data)
  return link ? json(link) : notFound()
})

/** Removes the link for good. Owners only. */
export const DELETE = withWeddingRole(byShareLinkId, 'owner', async (_req: NextRequest, ctx: IdContext, access) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  return (await deleteShareLink(getDb(), access.weddingId, id)) ? json({ ok: true }) : notFound()
})
