import type { NextRequest } from 'next/server'
import { idParam, json, notFound, type IdContext } from '@/server/api-route'
import { withWeddingRole } from '@/server/auth/guards'
import { byLayoutId } from '@/server/auth/resolvers'
import { getDb } from '@/server/db/client'
import { layoutVersion } from '@/server/repo/layouts'

/** LayoutVersionInfo: the cheap check a tab makes when it regains focus. Any member. */
export const GET = withWeddingRole(byLayoutId, 'editor', async (_req: NextRequest, ctx: IdContext, access) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const info = await layoutVersion(getDb(), access.weddingId, id)
  return info ? json(info) : notFound()
})
