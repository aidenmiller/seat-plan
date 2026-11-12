import { AdminNav } from '@/client/admin/AdminNav'
import { requireAdminPage } from '@/server/auth/pages'

/**
 * The admin area's heading and tabs. Each admin page checks for itself too
 * (a layout's check does not stop its pages from rendering); this one keeps
 * the tabs from showing to anyone else, who get the 404 page.
 */
export default async function AdminLayout({ children }: LayoutProps<'/admin'>) {
  await requireAdminPage('/admin')
  return (
    <div className="flex flex-1 flex-col">
      <div className="border-b border-stone-200 bg-white">
        <div className="mx-auto w-full max-w-6xl px-4 pt-4">
          <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
          <AdminNav />
        </div>
      </div>
      {children}
    </div>
  )
}
