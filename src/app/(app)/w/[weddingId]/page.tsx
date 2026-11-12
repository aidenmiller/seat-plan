import { redirect } from 'next/navigation'
import { requireWeddingPage } from '@/server/auth/pages'

/** /w/[weddingId] opens the Layouts tab. */
export default async function WeddingPage({ params }: PageProps<'/w/[weddingId]'>) {
  const { weddingId } = await params
  await requireWeddingPage(weddingId, `/w/${weddingId}/layouts`)
  redirect(`/w/${encodeURIComponent(weddingId)}/layouts`)
}
