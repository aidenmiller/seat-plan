import 'server-only'
import { json, notFound } from '@/server/api-route'
import type { AdminMemberRefusal } from '@/server/repo/admin-weddings'

/** The reply for an admin's change to a wedding's people that was refused. */
export function adminMemberRefused(reason: AdminMemberRefusal): Response {
  switch (reason) {
    case 'not-found':
      return notFound()
    case 'deleted':
      return json({ error: 'deleted', message: 'This wedding is deleted. Undelete it first.' }, 409)
    case 'user-disabled':
      return json({ error: 'user_disabled', message: 'That account is turned off. Turn it on first.' }, 409)
    case 'no-user':
      return json({ error: 'invalid', issues: ['userId: There is no account with that id'] }, 422)
  }
}
