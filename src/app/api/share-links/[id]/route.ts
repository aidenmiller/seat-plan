import type { NextRequest } from 'next/server'
import { updateShareLinkBody } from '@/shared/api'
import { idParam, json, notFound, readBody, type IdContext } from '@/server/api-route'
import { withSiteAuth } from '@/server/auth/require'
import { getDb } from '@/server/db/client'
import { deleteShareLink, updateShareLink } from '@/server/repo/share-links'

/**
 * Label, password, on or off, names and notes. A new password or turning the
 * link off signs out everyone using it. Replies with the ShareLink.
 */
export const PATCH = withSiteAuth(async (req: NextRequest, ctx: IdContext) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const body = await readBody(req, updateShareLinkBody)
  if (!body.ok) return body.response
  const link = await updateShareLink(getDb(), id, body.data)
  return link ? json(link) : notFound()
})

/** Removes the link for good. */
export const DELETE = withSiteAuth(async (_req: NextRequest, ctx: IdContext) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  return (await deleteShareLink(getDb(), id)) ? json({ ok: true }) : notFound()
})
