import { notFound } from 'next/navigation'
import { requireWeddingPage } from '@/server/auth/pages'
import { getDb } from '@/server/db/client'
import { listLayouts } from '@/server/repo/layouts'
import { listVenues } from '@/server/repo/venues'
import { uuid } from '@/shared/api'
import { TabPage } from '../../_components/TabPage'
import { LayoutList } from './LayoutList'
import { NewLayoutButton } from './NewLayoutButton'

export const metadata = { title: 'Layouts' }

export default async function LayoutsPage({ params }: PageProps<'/w/[weddingId]/layouts'>) {
  const { weddingId } = await params
  await requireWeddingPage(weddingId, `/w/${weddingId}/layouts`)
  if (!uuid.safeParse(weddingId).success) notFound()
  const id = weddingId.toLowerCase()
  const db = getDb()
  const [layouts, venues] = await Promise.all([listLayouts(db, id), listVenues(db)])
  if (!layouts) notFound()

  return (
    <TabPage title="Layouts" actions={<NewLayoutButton weddingId={id} venues={venues} />}>
      <LayoutList weddingId={id} layouts={layouts} />
    </TabPage>
  )
}
