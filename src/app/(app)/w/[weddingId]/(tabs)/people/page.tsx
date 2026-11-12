import { notFound } from 'next/navigation'
import { PeopleScreen } from '@/client/people/PeopleScreen'
import { effectiveRole, roleAtLeast } from '@/server/auth/access'
import { requireWeddingPage } from '@/server/auth/pages'
import { getDb } from '@/server/db/client'
import { listInvites } from '@/server/repo/invites'
import { listMembers } from '@/server/repo/members'
import { uuid } from '@/shared/api'
import { TabPage } from '../../_components/TabPage'

export const metadata = { title: 'People · Seat Plan' }

/** Who can open the wedding, and (for owners) the invites nobody has used yet. */
export default async function PeoplePage({ params }: PageProps<'/w/[weddingId]/people'>) {
  const { weddingId } = await params
  const access = await requireWeddingPage(weddingId, `/w/${weddingId}/people`)
  if (!uuid.safeParse(weddingId).success) notFound()
  const id = weddingId.toLowerCase()
  const db = getDb()
  const canManage = roleAtLeast(effectiveRole(access.role, access.user.isAdmin), 'owner')
  const [members, invites] = await Promise.all([listMembers(db, id), canManage ? listInvites(db, id) : Promise.resolve([])])
  return (
    <TabPage title="People">
      <PeopleScreen weddingId={id} initialMembers={members} initialInvites={invites.filter((i) => i.state === 'pending')} />
    </TabPage>
  )
}
