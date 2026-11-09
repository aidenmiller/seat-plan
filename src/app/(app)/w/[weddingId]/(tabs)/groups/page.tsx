import { notFound } from 'next/navigation'
import { GroupsScreen } from '@/client/groups/GroupsScreen'
import { RowSaveStatusText } from '@/client/guests/RowSaveStatusText'
import { requireSiteSession } from '@/server/auth/require'
import { getDb } from '@/server/db/client'
import { listGroups } from '@/server/repo/groups'
import { listGuests } from '@/server/repo/guests'
import { uuid } from '@/shared/api'
import { TabPage } from '../../_components/TabPage'

export const metadata = { title: 'Groups · Seat Plan' }

/** The wedding's groups with their members; the guest list feeds the member search. */
export default async function GroupsPage({ params }: PageProps<'/w/[weddingId]/groups'>) {
  const { weddingId } = await params
  await requireSiteSession(`/w/${weddingId}/groups`)
  if (!uuid.safeParse(weddingId).success) notFound()
  const id = weddingId.toLowerCase()
  const db = getDb()
  const [guests, groups] = await Promise.all([listGuests(db, id), listGroups(db, id)])
  if (!guests || !groups) notFound()
  return (
    <TabPage title="Groups" actions={<RowSaveStatusText />}>
      <GroupsScreen weddingId={id} guests={guests} groups={groups} />
    </TabPage>
  )
}
