import type { NextRequest } from 'next/server'
import { createWeddingBody } from '@/shared/api'
import { json, readBody } from '@/server/api-route'
import { withSiteAuth } from '@/server/auth/require'
import { getDb } from '@/server/db/client'
import { createWedding, listWeddings } from '@/server/repo/weddings'

/** WeddingSummary[]: live weddings with guest and layout counts. */
export const GET = withSiteAuth(async () => json(await listWeddings(getDb())))

/** 201 WeddingSummary. A retry with the same id gives the same wedding back. */
export const POST = withSiteAuth(async (req: NextRequest) => {
  const body = await readBody(req, createWeddingBody)
  if (!body.ok) return body.response
  const result = await createWedding(getDb(), body.data)
  if (result.status === 'id-taken') return json({ error: 'id_taken' }, 409)
  return json(result.wedding, 201)
})
