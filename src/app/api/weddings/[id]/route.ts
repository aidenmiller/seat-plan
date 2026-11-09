import type { NextRequest } from 'next/server'
import { deleteBody, updateWeddingBody } from '@/shared/api'
import { idParam, json, notFound, readBody, type IdContext } from '@/server/api-route'
import { withSiteAuth } from '@/server/auth/require'
import { getDb } from '@/server/db/client'
import { getWedding, softDeleteWedding, updateWedding } from '@/server/repo/weddings'

/** WeddingSummary. */
export const GET = withSiteAuth(async (_req: NextRequest, ctx: IdContext) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const wedding = await getWedding(getDb(), id)
  return wedding ? json(wedding) : notFound()
})

/** Wedding settings: name, date, unit, minimum gap. Replies with the WeddingSummary. */
export const PATCH = withSiteAuth(async (req: NextRequest, ctx: IdContext) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const body = await readBody(req, updateWeddingBody)
  if (!body.ok) return body.response
  const wedding = await updateWedding(getDb(), id, body.data)
  return wedding ? json(wedding) : notFound()
})

/** Needs { confirm: "delete" }. Marks only the wedding row (DECISIONS 32). */
export const DELETE = withSiteAuth(async (req: NextRequest, ctx: IdContext) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const body = await readBody(req, deleteBody)
  if (!body.ok) return body.response
  return (await softDeleteWedding(getDb(), id)) ? json({ ok: true }) : notFound()
})
