import { AdminOverviewScreen } from '@/client/admin/AdminOverviewScreen'
import { runAfterResponse } from '@/server/after-response'
import { requireAdminPage } from '@/server/auth/pages'
import { getDb } from '@/server/db/client'
import { pruneActivityDaily } from '@/server/repo/activity'
import { adminOverview } from '@/server/repo/admin-stats'

export const metadata = { title: 'Overview · Admin' }

/**
 * The admin area's first page: the totals, and edits and sign-ins by day.
 * There is no scheduled job, so this is also where old usage counters are
 * cleared, at most once a day, after the page has gone out.
 */
export default async function AdminOverviewPage() {
  await requireAdminPage('/admin')
  const overview = await adminOverview(getDb())
  await runAfterResponse(() => pruneActivityDaily(getDb()))
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
      <AdminOverviewScreen overview={overview} />
    </main>
  )
}
