import { notFound } from 'next/navigation'
import { requireSiteSession } from '@/server/auth/require'
import { getDb } from '@/server/db/client'
import { listGroups } from '@/server/repo/groups'
import { listGuests } from '@/server/repo/guests'
import { getLayoutDetail } from '@/server/repo/layouts'
import { getWedding } from '@/server/repo/weddings'
import { uuid } from '@/shared/api'
import { EditorShell } from '@/client/editor/EditorShell'

export const metadata = { title: 'Layout · Seat Plan' }

/**
 * The layout editor. A missing or deleted layout, one from another wedding,
 * or one whose wedding was deleted is a 404. The wedding gives the editor its
 * unit (the grid and every length) and the narrowest gap between tables; its
 * guests and groups fill the Guests tab.
 */
export default async function LayoutEditorPage({ params }: PageProps<'/w/[weddingId]/layouts/[layoutId]'>) {
  const { weddingId, layoutId } = await params
  await requireSiteSession(`/w/${weddingId}/layouts/${layoutId}`)
  if (!uuid.safeParse(weddingId).success || !uuid.safeParse(layoutId).success) notFound()
  const db = getDb()
  const id = weddingId.toLowerCase()
  const [layout, wedding, guests, groups] = await Promise.all([
    getLayoutDetail(db, layoutId.toLowerCase()),
    getWedding(db, id),
    listGuests(db, id),
    listGroups(db, id),
  ])
  if (!layout || !wedding || layout.weddingId !== wedding.id || !guests || !groups) notFound()
  return (
    <EditorShell
      key={layout.id}
      layout={layout}
      wedding={{ unit: wedding.unit, minGapCm: wedding.minGapCm }}
      guests={guests}
      groups={groups}
    />
  )
}
