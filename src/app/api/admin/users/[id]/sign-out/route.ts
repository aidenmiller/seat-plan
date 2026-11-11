import { idParam, json, notFound, type IdContext } from '@/server/api-route'
import { withAdmin } from '@/server/auth/guards'
import { getDb } from '@/server/db/client'
import { endUserSessions } from '@/server/repo/sessions'
import { getUserDto } from '@/server/repo/users'

/**
 * Admins: signs an account out on every device. 200 { ended }. Your own
 * account is refused (409): the account page signs out your other devices
 * and keeps this one.
 */
export const POST = withAdmin(async (_req, ctx: IdContext, admin) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  if (id === admin.id) {
    return json({ error: 'self', message: 'Use your account page to sign out your other devices.' }, 409)
  }
  const db = getDb()
  if (!(await getUserDto(db, id))) return notFound()
  const ended = await endUserSessions(db, id)
  return json({ ended })
})
