import { requireSiteSession } from '@/server/auth/require'
import { getDb } from '@/server/db/client'
import { listVenues } from '@/server/repo/venues'
import { plural } from '@/domain/wording'
import { EmptyState, TabPage } from '../../_components/TabPage'

export const metadata = { title: 'Venues · Seat Plan' }

/** Venue templates are shared by every wedding (PLAN change 5). Editing them comes in milestone 7. */
export default async function VenuesPage({ params }: PageProps<'/w/[weddingId]/venues'>) {
  const { weddingId } = await params
  await requireSiteSession(`/w/${weddingId}/venues`)
  const venues = await listVenues(getDb())

  return (
    <TabPage title="Venues">
      <p className="mb-4 text-sm text-stone-600">Every wedding shares these venues.</p>
      {venues.length === 0 ? (
        <EmptyState>No venues yet.</EmptyState>
      ) : (
        <ul className="divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white" data-testid="venue-list">
          {venues.map((v) => (
            <li key={v.id} className="flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
              <span className="min-w-0 font-medium break-words">{v.name}</span>
              <span className="text-sm text-stone-600">
                {v.usedBy === 0 ? 'Not used yet' : `Used by ${plural(v.usedBy, 'layout')}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </TabPage>
  )
}
