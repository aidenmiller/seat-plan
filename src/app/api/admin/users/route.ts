import { json } from '@/server/api-route'
import { withAdmin } from '@/server/auth/guards'
import { getDb } from '@/server/db/client'
import { listUsersForAdmin } from '@/server/repo/users'
import type { AdminUser } from '@/shared/accounts-api'

/** Admins: AdminUser[], everyone, oldest account first. Anyone else gets 404. */
export const GET = withAdmin(async () => {
  const users: AdminUser[] = await listUsersForAdmin(getDb())
  return json(users)
})
