import type { NextRequest } from 'next/server'
import { idParam, json, notFound, type IdContext } from '@/server/api-route'
import { withSiteAuth } from '@/server/auth/require'
import { getDb } from '@/server/db/client'
import { layoutVersion } from '@/server/repo/layouts'

/** LayoutVersionInfo: the cheap check a tab makes when it regains focus. */
export const GET = withSiteAuth(async (_req: NextRequest, ctx: IdContext) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const info = await layoutVersion(getDb(), id)
  return info ? json(info) : notFound()
})
