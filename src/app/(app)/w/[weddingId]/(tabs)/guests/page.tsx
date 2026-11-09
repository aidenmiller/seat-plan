import { requireSiteSession } from '@/server/auth/require'
import { EmptyState, TabPage } from '../../_components/TabPage'

export const metadata = { title: 'Guests · Seat Plan' }

export default async function GuestsPage({ params }: PageProps<'/w/[weddingId]/guests'>) {
  const { weddingId } = await params
  await requireSiteSession(`/w/${weddingId}/guests`)
  return (
    <TabPage title="Guests">
      <EmptyState>No guests yet.</EmptyState>
    </TabPage>
  )
}
