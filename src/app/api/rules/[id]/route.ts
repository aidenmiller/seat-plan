import type { NextRequest } from 'next/server'
import { updateRuleBody } from '@/shared/api'
import { idParam, json, notFound, readBody, refuseUnstorableText, type IdContext } from '@/server/api-route'
import { withWeddingRole } from '@/server/auth/guards'
import { byRuleId } from '@/server/auth/resolvers'
import { getDb } from '@/server/db/client'
import { deleteRule, updateRule } from '@/server/repo/rules'

/** StoredRule: saves only the fields sent. guestIds replaces the rule's guests. Any member. */
export const PATCH = withWeddingRole(byRuleId, 'editor', async (req: NextRequest, ctx: IdContext, access) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const body = await readBody(req, updateRuleBody)
  if (!body.ok) return body.response
  const write = await refuseUnstorableText(() => updateRule(getDb(), access.weddingId, id, body.data))
  if (!write.ok) return write.response
  const result = write.value
  switch (result.status) {
    case 'updated':
      return json(result.rule)
    case 'invalid':
      return json({ error: 'invalid', issues: result.issues }, 422)
    case 'not-found':
      return notFound()
  }
})

/** { ok: true }: deletes the rule outright (DECISIONS 31). Any member. */
export const DELETE = withWeddingRole(byRuleId, 'editor', async (_req: NextRequest, ctx: IdContext, access) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  return (await deleteRule(getDb(), access.weddingId, id)) ? json({ ok: true }) : notFound()
})
