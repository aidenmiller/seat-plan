import { AdminWeddingsScreen } from '@/client/admin/AdminWeddingsScreen'
import { requireAdminPage } from '@/server/auth/pages'
import { getDb } from '@/server/db/client'
import { listWeddingsForAdmin } from '@/server/repo/admin-weddings'

export const metadata = { title: 'Weddings · Admin' }

/** Every wedding, deleted ones too, with who belongs to it. */
export default async function AdminWeddingsPage() {
  await requireAdminPage('/admin/weddings')
  const weddings = await listWeddingsForAdmin(getDb())
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
      <AdminWeddingsScreen initialWeddings={weddings} />
    </main>
  )
}
