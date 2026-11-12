import { notFound } from 'next/navigation'
import { requireWeddingPage } from '@/server/auth/pages'
import { getDb } from '@/server/db/client'
import { listVenues } from '@/server/repo/venues'
import { uuid } from '@/shared/api'
import { NewVenueButton, VenueList } from '@/client/venues/VenueList'
import { TabPage } from '../../_components/TabPage'

export const metadata = { title: 'Venues' }

/** The library, your own venues, and the ones this wedding uses (PLAN change 5; venue-access.ts). */
export default async function VenuesPage({ params }: PageProps<'/w/[weddingId]/venues'>) {
  const { weddingId } = await params
  const { user } = await requireWeddingPage(weddingId, `/w/${weddingId}/venues`)
  if (!uuid.safeParse(weddingId).success) notFound()
  const id = weddingId.toLowerCase()
  const venues = await listVenues(getDb(), { userId: user.id, isAdmin: user.isAdmin }, { weddingId: id })

  return (
    <TabPage title="Venues" actions={<NewVenueButton weddingId={id} />}>
      <p className="mb-4 text-sm text-stone-600">Library venues are shared by everyone. Your own venues are private to you, and anyone in a wedding that uses one can view it.</p>
      <VenueList weddingId={id} venues={venues} />
    </TabPage>
  )
}
