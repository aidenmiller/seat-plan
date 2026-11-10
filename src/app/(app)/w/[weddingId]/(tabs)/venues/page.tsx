import { notFound } from 'next/navigation'
import { requireSiteSession } from '@/server/auth/require'
import { getDb } from '@/server/db/client'
import { listVenues } from '@/server/repo/venues'
import { uuid } from '@/shared/api'
import { NewVenueButton, VenueList } from '@/client/venues/VenueList'
import { TabPage } from '../../_components/TabPage'

export const metadata = { title: 'Venues · Seat Plan' }

/** Venue templates are shared by every wedding (PLAN change 5); each wedding's tab lists them all. */
export default async function VenuesPage({ params }: PageProps<'/w/[weddingId]/venues'>) {
  const { weddingId } = await params
  await requireSiteSession(`/w/${weddingId}/venues`)
  if (!uuid.safeParse(weddingId).success) notFound()
  const id = weddingId.toLowerCase()
  const venues = await listVenues(getDb())

  return (
    <TabPage title="Venues" actions={<NewVenueButton weddingId={id} />}>
      <p className="mb-4 text-sm text-stone-600">Every wedding shares these venues. A change to a venue shows in every layout that uses it.</p>
      <VenueList weddingId={id} venues={venues} />
    </TabPage>
  )
}
