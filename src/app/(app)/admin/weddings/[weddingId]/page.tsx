import { notFound } from 'next/navigation'
import { AdminWeddingDetailScreen } from '@/client/admin/AdminWeddingDetailScreen'
import { requireAdminPage } from '@/server/auth/pages'
import { getDb } from '@/server/db/client'
import { adminPicks, weddingActivity, weddingStats } from '@/server/repo/admin-stats'
import { getWeddingForAdmin } from '@/server/repo/admin-weddings'
import { listMembers } from '@/server/repo/members'
import { uuid } from '@/shared/api'

export const metadata = { title: 'Wedding · Admin' }

/** One wedding for the admin, deleted or not: who belongs to it, its owner, and what happened in it lately. */
export default async function AdminWeddingPage({ params }: PageProps<'/admin/weddings/[weddingId]'>) {
  const { weddingId } = await params
  await requireAdminPage(`/admin/weddings/${weddingId}`)
  if (!uuid.safeParse(weddingId).success) notFound()
  const id = weddingId.toLowerCase()
  const db = getDb()
  const wedding = await getWeddingForAdmin(db, id)
  if (!wedding) notFound()
  const [members, stats, activity, people] = await Promise.all([listMembers(db, id), weddingStats(db, new Date(), id), weddingActivity(db, id), adminPicks(db)])
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
      <AdminWeddingDetailScreen wedding={wedding} members={members} stats={stats[id]} activity={activity} people={people} />
    </main>
  )
}
