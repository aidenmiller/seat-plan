import { notFound } from 'next/navigation'
import { requireSiteSession } from '@/server/auth/require'
import { getDb } from '@/server/db/client'
import { getLayoutDetail } from '@/server/repo/layouts'
import { uuid } from '@/shared/api'
import { EditorShell } from '@/client/editor/EditorShell'

export const metadata = { title: 'Layout · Seat Plan' }

/** The layout editor. A missing or deleted layout, or one from another wedding, is a 404. */
export default async function LayoutEditorPage({ params }: PageProps<'/w/[weddingId]/layouts/[layoutId]'>) {
  const { weddingId, layoutId } = await params
  await requireSiteSession(`/w/${weddingId}/layouts/${layoutId}`)
  if (!uuid.safeParse(weddingId).success || !uuid.safeParse(layoutId).success) notFound()
  const layout = await getLayoutDetail(getDb(), layoutId.toLowerCase())
  if (!layout || layout.weddingId !== weddingId.toLowerCase()) notFound()
  return <EditorShell key={layout.id} layout={layout} />
}
