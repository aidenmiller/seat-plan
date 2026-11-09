import { json } from '@/server/api-route'
import { withSiteAuth } from '@/server/auth/require'
import { getDb } from '@/server/db/client'
import { listVenues } from '@/server/repo/venues'

/** VenueSummary[]: every live template, shared by all weddings. */
export const GET = withSiteAuth(async () => json(await listVenues(getDb())))
