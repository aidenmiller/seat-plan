import { notFound } from 'next/navigation'
import { RulesScreen } from '@/client/rules/RulesScreen'
import { requireSiteSession } from '@/server/auth/require'
import { getDb } from '@/server/db/client'
import { listGroups } from '@/server/repo/groups'
import { listGuests } from '@/server/repo/guests'
import { listRules } from '@/server/repo/rules'
import { uuid } from '@/shared/api'
import { TabPage } from '../../_components/TabPage'

export const metadata = { title: 'Rules · Seat Plan' }

/** Couple rules and the wedding's other rules; guests and groups feed the guest picker. */
export default async function RulesPage({ params }: PageProps<'/w/[weddingId]/rules'>) {
  const { weddingId } = await params
  await requireSiteSession(`/w/${weddingId}/rules`)
  if (!uuid.safeParse(weddingId).success) notFound()
  const id = weddingId.toLowerCase()
  const db = getDb()
  const [guests, groups, rules] = await Promise.all([listGuests(db, id), listGroups(db, id), listRules(db, id)])
  if (!guests || !groups || !rules) notFound()
  return (
    <TabPage title="Rules">
      <RulesScreen weddingId={id} guests={guests} groups={groups} rules={rules} />
    </TabPage>
  )
}
