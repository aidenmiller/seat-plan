import type { NextRequest } from 'next/server'
import { createVenueBody } from '@/shared/api'
import { json, readBody, refuseUnstorableText } from '@/server/api-route'
import { withSiteAuth } from '@/server/auth/require'
import { getDb } from '@/server/db/client'
import { createTemplate, listVenues } from '@/server/repo/venues'

/** VenueSummary[]: every live template, shared by all weddings. */
export const GET = withSiteAuth(async () => json(await listVenues(getDb())))

/** 201 VenueDetail: a new, empty template. A retry with the same id gives the same template back. */
export const POST = withSiteAuth(async (req: NextRequest) => {
  const body = await readBody(req, createVenueBody)
  if (!body.ok) return body.response
  const write = await refuseUnstorableText(() => createTemplate(getDb(), body.data))
  if (!write.ok) return write.response
  const result = write.value
  if (result.status === 'id-taken') return json({ error: 'id_taken' }, 409)
  return json(result.venue, 201)
})
