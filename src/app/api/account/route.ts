import { json, notFound, readBody } from '@/server/api-route'
import { withUser } from '@/server/auth/guards'
import { getDb } from '@/server/db/client'
import { updateDisplayName } from '@/server/repo/users'
import { updateAccountBody, type AccountInfo } from '@/shared/accounts-api'

/** Changes the signed-in user's own display name. Replies with the AccountInfo. */
export const PATCH = withUser(async (req, _ctx, user) => {
  const body = await readBody(req, updateAccountBody)
  if (!body.ok) return body.response
  const updated = await updateDisplayName(getDb(), user.id, body.data.displayName)
  if (!updated) return notFound()
  const reply: AccountInfo = { id: updated.id, email: updated.email, displayName: updated.displayName }
  return json(reply)
})
