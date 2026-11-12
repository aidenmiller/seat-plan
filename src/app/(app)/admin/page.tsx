import { redirect } from 'next/navigation'
import { requireAdminPage } from '@/server/auth/pages'

/** /admin opens the Users page. */
export default async function AdminPage() {
  await requireAdminPage('/admin')
  redirect('/admin/users')
}
