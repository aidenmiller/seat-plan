import type { NextRequest } from 'next/server'
import { updateRuleBody } from '@/shared/api'
import { idParam, json, notFound, readBody, refuseUnstorableText, type IdContext } from '@/server/api-route'
import { withSiteAuth } from '@/server/auth/require'
import { getDb } from '@/server/db/client'
import { deleteRule, updateRule } from '@/server/repo/rules'

/** StoredRule: saves only the fields sent. guestIds replaces the rule's guests. */
export const PATCH = withSiteAuth(async (req: NextRequest, ctx: IdContext) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const body = await readBody(req, updateRuleBody)
  if (!body.ok) return body.response
  const write = await refuseUnstorableText(() => updateRule(getDb(), id, body.data))
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

/** { ok: true }: deletes the rule outright (DECISIONS 31). */
export const DELETE = withSiteAuth(async (_req: NextRequest, ctx: IdContext) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  return (await deleteRule(getDb(), id)) ? json({ ok: true }) : notFound()
})
