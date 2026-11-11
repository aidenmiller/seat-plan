import { notFound } from 'next/navigation'
import { LinksScreen } from '@/client/share/LinksScreen'
import { requireWeddingPage } from '@/server/auth/pages'
import { getDb } from '@/server/db/client'
import { listWeddingShareLinks } from '@/server/repo/share-links'
import { uuid } from '@/shared/api'
import { TabPage } from '../../_components/TabPage'

export const metadata = { title: 'Links · Seat Plan' }

/** The wedding's venue share links that are on (PLAN change 25). */
export default async function LinksPage({ params }: PageProps<'/w/[weddingId]/links'>) {
  const { weddingId } = await params
  await requireWeddingPage(weddingId, `/w/${weddingId}/links`)
  if (!uuid.safeParse(weddingId).success) notFound()
  const id = weddingId.toLowerCase()
  const links = await listWeddingShareLinks(getDb(), id)
  if (!links) notFound()
  return (
    <TabPage title="Links">
      <p className="mb-4 text-sm text-stone-600">View-only links for the venue. Each opens one layout and has its own password.</p>
      <LinksScreen weddingId={id} initial={links} />
    </TabPage>
  )
}
