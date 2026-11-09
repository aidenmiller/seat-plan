import { notFound } from 'next/navigation'
import { requireSiteSession } from '@/server/auth/require'
import { getDb } from '@/server/db/client'
import { getLayoutDetail } from '@/server/repo/layouts'
import { getWedding } from '@/server/repo/weddings'
import { uuid } from '@/shared/api'
import { EditorShell } from '@/client/editor/EditorShell'

export const metadata = { title: 'Layout · Seat Plan' }

/**
 * The layout editor. A missing or deleted layout, one from another wedding,
 * or one whose wedding was deleted is a 404. The wedding gives the editor its
 * unit (the grid and every length) and the narrowest gap between tables.
 */
export default async function LayoutEditorPage({ params }: PageProps<'/w/[weddingId]/layouts/[layoutId]'>) {
  const { weddingId, layoutId } = await params
  await requireSiteSession(`/w/${weddingId}/layouts/${layoutId}`)
  if (!uuid.safeParse(weddingId).success || !uuid.safeParse(layoutId).success) notFound()
  const db = getDb()
  const [layout, wedding] = await Promise.all([getLayoutDetail(db, layoutId.toLowerCase()), getWedding(db, weddingId.toLowerCase())])
  if (!layout || !wedding || layout.weddingId !== wedding.id) notFound()
  return <EditorShell key={layout.id} layout={layout} wedding={{ unit: wedding.unit, minGapCm: wedding.minGapCm }} />
}
