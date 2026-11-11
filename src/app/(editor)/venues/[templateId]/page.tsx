import { notFound } from 'next/navigation'
import { requireVenuePage } from '@/server/auth/pages'
import { getDb } from '@/server/db/client'
import { getTemplate } from '@/server/repo/venues'
import { uuid } from '@/shared/api'
import { TemplateEditorScreen } from '@/client/venues/editor/TemplateEditorScreen'

export const metadata = { title: 'Venue · Seat Plan' }

/**
 * The venue template editor and floor plan import (PLAN section 5, "Pages").
 * Templates belong to no wedding; `?from=<weddingId>` is the wedding whose
 * Venues tab opened it, so Back returns there. A missing or deleted template
 * is a 404.
 */
export default async function TemplateEditorPage({ params, searchParams }: PageProps<'/venues/[templateId]'>) {
  const { templateId } = await params
  const query = await searchParams
  const from = typeof query.from === 'string' && uuid.safeParse(query.from).success ? query.from.toLowerCase() : null
  await requireVenuePage(templateId, `/venues/${templateId}${from ? `?from=${from}` : ''}`)
  if (!uuid.safeParse(templateId).success) notFound()
  const venue = await getTemplate(getDb(), templateId.toLowerCase())
  if (!venue) notFound()
  return <TemplateEditorScreen key={venue.id} venue={venue} backHref={from ? `/w/${from}/venues` : '/'} />
}
