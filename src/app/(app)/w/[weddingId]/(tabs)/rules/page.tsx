import { requireSiteSession } from '@/server/auth/require'
import { EmptyState, TabPage } from '../../_components/TabPage'

export const metadata = { title: 'Rules · Seat Plan' }

export default async function RulesPage({ params }: PageProps<'/w/[weddingId]/rules'>) {
  const { weddingId } = await params
  await requireSiteSession(`/w/${weddingId}/rules`)
  return (
    <TabPage title="Rules">
      <EmptyState>No rules yet.</EmptyState>
    </TabPage>
  )
}
