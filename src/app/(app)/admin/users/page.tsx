import { AdminUsersScreen } from '@/client/admin/AdminUsersScreen'
import { requireAdminPage } from '@/server/auth/pages'
import { getDb } from '@/server/db/client'
import { personStats } from '@/server/repo/admin-stats'
import { listInvites } from '@/server/repo/invites'
import { listUsersForAdmin } from '@/server/repo/users'

export const metadata = { title: 'People · Admin' }

/** Everyone with an account, what they have been doing, and the invites for new planners nobody has used yet. */
export default async function AdminUsersPage() {
  const admin = await requireAdminPage('/admin/users')
  const db = getDb()
  const [users, invites, stats] = await Promise.all([listUsersForAdmin(db), listInvites(db, null), personStats(db)])
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
      <AdminUsersScreen meId={admin.id} initialUsers={users} initialInvites={invites.filter((i) => i.state === 'pending')} stats={stats} />
    </main>
  )
}
