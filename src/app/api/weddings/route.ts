import type { NextRequest } from 'next/server'
import { createWeddingBody } from '@/shared/api'
import { json, readBody } from '@/server/api-route'
import { withUser } from '@/server/auth/guards'
import { getDb } from '@/server/db/client'
import { createWedding, listWeddingsForUser } from '@/server/repo/weddings'

/**
 * WeddingSummary[]: the live weddings the caller belongs to, with guest and
 * layout counts. An admin gets only their own here too.
 */
export const GET = withUser(async (_req: NextRequest, _ctx: unknown, user) => json(await listWeddingsForUser(getDb(), user.id)))

/**
 * 201 WeddingSummary: a new wedding with the caller as its owner. A retry
 * with the same id gives the same wedding back to someone who belongs to it;
 * an id anyone else's wedding holds is 409 { error: 'id_taken' }, with nothing
 * about that wedding.
 */
export const POST = withUser(async (req: NextRequest, _ctx: unknown, user) => {
  const body = await readBody(req, createWeddingBody)
  if (!body.ok) return body.response
  const result = await createWedding(getDb(), body.data, user.id)
  if (result.status === 'id-taken') return json({ error: 'id_taken' }, 409)
  return json(result.wedding, 201)
})
