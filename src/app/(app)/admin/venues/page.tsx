import { AdminVenuesScreen } from '@/client/admin/AdminVenuesScreen'
import { requireAdminPage } from '@/server/auth/pages'
import { getDb } from '@/server/db/client'
import { adminPicks } from '@/server/repo/admin-stats'
import { listVenuesForAdmin } from '@/server/repo/admin-venues'

export const metadata = { title: 'Venues · Admin' }

/** Every venue template, whoever owns it, with how many layouts use it across every wedding. */
export default async function AdminVenuesPage() {
  await requireAdminPage('/admin/venues')
  const db = getDb()
  const [venues, people] = await Promise.all([listVenuesForAdmin(db), adminPicks(db)])
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
      <AdminVenuesScreen initialVenues={venues} people={people.filter((p) => !p.disabled)} />
    </main>
  )
}
