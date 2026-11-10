import type { NextRequest } from 'next/server'
import { createRuleBody } from '@/shared/api'
import { idParam, json, notFound, readBody, refuseUnstorableText, type IdContext } from '@/server/api-route'
import { withSiteAuth } from '@/server/auth/require'
import { getDb } from '@/server/db/client'
import { createRule, listRules } from '@/server/repo/rules'

/** StoredRule[]: the wedding's stored rules, oldest first. Couple rules have no rows (PLAN change 8). */
export const GET = withSiteAuth(async (_req: NextRequest, ctx: IdContext) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const list = await listRules(getDb(), id)
  return list ? json(list) : notFound()
})

/** 201 StoredRule. 422 when a guest is not a live guest of this wedding. */
export const POST = withSiteAuth(async (req: NextRequest, ctx: IdContext) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const body = await readBody(req, createRuleBody)
  if (!body.ok) return body.response
  const write = await refuseUnstorableText(() => createRule(getDb(), id, body.data))
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
