import { notFound } from 'next/navigation'
import { GuestsScreen } from '@/client/guests/GuestsScreen'
import { RowSaveStatusText } from '@/client/guests/RowSaveStatusText'
import { requireWeddingPage } from '@/server/auth/pages'
import { getDb } from '@/server/db/client'
import { listGroups } from '@/server/repo/groups'
import { listGuests, seatPlaces } from '@/server/repo/guests'
import { uuid } from '@/shared/api'
import { TabPage } from '../../_components/TabPage'

export const metadata = { title: 'Guests' }

/** The guest list: the guests, their groups, and where each one sits in the wedding's layouts. */
export default async function GuestsPage({ params }: PageProps<'/w/[weddingId]/guests'>) {
  const { weddingId } = await params
  await requireWeddingPage(weddingId, `/w/${weddingId}/guests`)
  if (!uuid.safeParse(weddingId).success) notFound()
  const id = weddingId.toLowerCase()
  const db = getDb()
  const [guests, groups] = await Promise.all([listGuests(db, id), listGroups(db, id)])
  if (!guests || !groups) notFound()
  const seats = await seatPlaces(
    db,
    id,
    guests.map((g) => g.id),
  )

  return (
    <TabPage title="Guests" actions={<RowSaveStatusText />} wide>
      <GuestsScreen weddingId={id} guests={guests} groups={groups} seats={seats} />
    </TabPage>
  )
}
