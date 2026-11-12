import { AdminBackupsScreen } from '@/client/backups/AdminBackupsScreen'
import { requireAdminPage } from '@/server/auth/pages'

export const metadata = { title: 'Backups · Admin' }

/** The stored backups, the nightly run's health, and the recent runs. The screen loads them from /api/admin/backups. */
export default async function AdminBackupsPage() {
  await requireAdminPage('/admin/backups')
  return <AdminBackupsScreen />
}
