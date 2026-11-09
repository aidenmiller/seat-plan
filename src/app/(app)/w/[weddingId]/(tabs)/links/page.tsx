import { requireSiteSession } from '@/server/auth/require'
import { EmptyState, TabPage } from '../../_components/TabPage'

export const metadata = { title: 'Links · Seat Plan' }

export default async function LinksPage({ params }: PageProps<'/w/[weddingId]/links'>) {
  const { weddingId } = await params
  await requireSiteSession(`/w/${weddingId}/links`)
  return (
    <TabPage title="Links">
      <EmptyState>No share links yet.</EmptyState>
    </TabPage>
  )
}
