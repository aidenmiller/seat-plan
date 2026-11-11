import { notFound } from 'next/navigation'
import { ImportWizard } from '@/client/guests/import/ImportWizard'
import { requireSiteSession } from '@/server/auth/require'
import { getDb } from '@/server/db/client'
import { listGuests } from '@/server/repo/guests'
import { uuid } from '@/shared/api'
import { TabPage } from '../../../_components/TabPage'

export const metadata = { title: 'Import guests' }

/** The CSV import. The guest list feeds the partner pickers; the server builds the summary itself. */
export default async function ImportGuestsPage({ params }: PageProps<'/w/[weddingId]/guests/import'>) {
  const { weddingId } = await params
  await requireSiteSession(`/w/${weddingId}/guests/import`)
  if (!uuid.safeParse(weddingId).success) notFound()
  const id = weddingId.toLowerCase()
  const guests = await listGuests(getDb(), id)
  if (!guests) notFound()
  return (
    <TabPage title="Import guests">
      <ImportWizard weddingId={id} guests={guests} />
    </TabPage>
  )
}
