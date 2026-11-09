import { requireSiteSession } from '@/server/auth/require'
import { EmptyState, TabPage } from '../../_components/TabPage'

export const metadata = { title: 'Groups · Seat Plan' }

export default async function GroupsPage({ params }: PageProps<'/w/[weddingId]/groups'>) {
  const { weddingId } = await params
  await requireSiteSession(`/w/${weddingId}/groups`)
  return (
    <TabPage title="Groups">
      <EmptyState>No groups yet.</EmptyState>
    </TabPage>
  )
}
