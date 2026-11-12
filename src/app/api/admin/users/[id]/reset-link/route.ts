import { idParam, json, notFound, type IdContext } from '@/server/api-route'
import { withAdmin } from '@/server/auth/guards'
import { getDb } from '@/server/db/client'
import { recordEvent } from '@/server/repo/activity'
import { createResetLink } from '@/server/repo/password-resets'
import type { CreatedResetLink } from '@/shared/accounts-api'

/**
 * Admins only: a new reset link for an account, cancelling its earlier ones.
 * Only admins may make these: a reset takes over the whole account, which
 * may belong to weddings the caller has nothing to do with. 201
 * CreatedResetLink: the token is in this reply only, for the browser to build
 * the link (/reset#<token>) and show it once.
 */
export const POST = withAdmin(async (_req, ctx: IdContext, admin) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const db = getDb()
  const link = await createResetLink(db, id, admin.id)
  if (!link) return notFound()
  await recordEvent(db, { kind: 'reset_link_created', userId: admin.id, subjectId: id })
  const reply: CreatedResetLink = { token: link.token, expiresAt: link.expiresAt.toISOString() }
  return json(reply, 201)
})
