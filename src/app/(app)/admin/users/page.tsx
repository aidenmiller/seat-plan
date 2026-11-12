import { AdminUsersScreen } from '@/client/admin/AdminUsersScreen'
import { requireAdminPage } from '@/server/auth/pages'
import { getDb } from '@/server/db/client'
import { listInvites } from '@/server/repo/invites'
import { listUsersForAdmin } from '@/server/repo/users'

export const metadata = { title: 'Users · Admin' }

/** Everyone with an account, and the invites for new planners nobody has used yet. */
export default async function AdminUsersPage() {
  const admin = await requireAdminPage('/admin/users')
  const db = getDb()
  const [users, invites] = await Promise.all([listUsersForAdmin(db), listInvites(db, null)])
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
      <AdminUsersScreen meId={admin.id} initialUsers={users} initialInvites={invites.filter((i) => i.state === 'pending')} />
    </main>
  )
}
