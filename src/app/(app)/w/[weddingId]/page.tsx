import { redirect } from 'next/navigation'
import { requireSiteSession } from '@/server/auth/require'

/** /w/[weddingId] opens the Layouts tab. */
export default async function WeddingPage({ params }: PageProps<'/w/[weddingId]'>) {
  const { weddingId } = await params
  await requireSiteSession(`/w/${weddingId}/layouts`)
  redirect(`/w/${encodeURIComponent(weddingId)}/layouts`)
}
