import type { NextRequest } from 'next/server'
import { createRuleBody } from '@/shared/api'
import { json, notFound, readBody, refuseUnstorableText, type IdContext } from '@/server/api-route'
import { withWeddingRole } from '@/server/auth/guards'
import { byWeddingId } from '@/server/auth/resolvers'
import { getDb } from '@/server/db/client'
import { createRule, listRules } from '@/server/repo/rules'

/** StoredRule[]: the wedding's stored rules, oldest first. Couple rules have no rows (PLAN change 8). Any member. */
export const GET = withWeddingRole(byWeddingId, 'editor', async (_req: NextRequest, _ctx: IdContext, access) => {
  const list = await listRules(getDb(), access.weddingId)
  return list ? json(list) : notFound()
})

/** 201 StoredRule. 422 when a guest is not a live guest of this wedding. Any member. */
export const POST = withWeddingRole(byWeddingId, 'editor', async (req: NextRequest, _ctx: IdContext, access) => {
  const body = await readBody(req, createRuleBody)
  if (!body.ok) return body.response
  const write = await refuseUnstorableText(() => createRule(getDb(), access.weddingId, body.data))
  if (!write.ok) return write.response
  const result = write.value
  switch (result.status) {
    case 'created':
      return json(result.rule, 201)
    case 'id-taken':
      return json({ error: 'id_taken' }, 409)
    case 'invalid':
      return json({ error: 'invalid', issues: result.issues }, 422)
    case 'not-found':
      return notFound()
  }
})
