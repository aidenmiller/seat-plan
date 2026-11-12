'use client'

/**
 * The Venues tab (spec section 5; PLAN section 7 "Venue templates"): every
 * template, shared by all weddings, with its name (rename in place), how many
 * layouts use it and when it was last edited, and Open, Duplicate and Delete.
 * New venue makes an empty template and opens the template editor.
 *
 * Test hooks: data-testid="venue-list", each card "venue-card" with
 * data-venue-id, "venue-name", "venue-used-by", "venue-edited".
 */
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createVenue, duplicateVenue, errorMessage, renameVenue } from '@/client/api'
import { randomId } from '@/client/sync/random-id'
import { InlineName } from '@/client/ui/InlineName'
import { EditedLine } from '@/client/ui/RelativeTime'
import { errorClass, primaryButton, secondaryButton } from '@/client/ui/styles'
import { venueItemCount, venueUsedBy } from '@/domain/venue-wording'
import type { VenueSummary } from '@/shared/api'
import { VenueDeleteDialog } from './VenueDeleteDialog'

/** Where a venue opens from a wedding's tab: Back in the editor returns to that tab. */
export function venueHref(venueId: string, weddingId: string): string {
  return `/venues/${venueId}?from=${weddingId}`
}

export function VenueList({ weddingId, venues }: { weddingId: string; venues: VenueSummary[] }) {
  if (venues.length === 0) {
    return <p className="rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center text-stone-600">No venues yet. Make one with New venue.</p>
  }
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="venue-list">
      {venues.map((v) => (
        <li key={v.id}>
          <VenueCard weddingId={weddingId} venue={v} />
        </li>
      ))}
    </ul>
  )
}

function VenueCard({ weddingId, venue }: { weddingId: string; venue: VenueSummary }) {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function duplicate() {
    if (duplicating) return
    setDuplicating(true)
    setError(null)
    try {
      await duplicateVenue(venue.id, { id: randomId() })
      router.refresh()
    } catch (err) {
      setError(`Could not duplicate. ${errorMessage(err)}`)
    } finally {
      setDuplicating(false)
    }
  }

  return (
    <article className="flex h-full flex-col rounded-xl border border-stone-200 bg-white p-3 shadow-sm" data-testid="venue-card" data-venue-id={venue.id}>
      <div className="px-1">
        <InlineName
          value={venue.name}
          label="Venue name"
          textClassName="text-base font-semibold"
          testId="venue-name"
          onSave={async (name) => {
            await renameVenue(venue.id, { name })
            router.refresh()
          }}
        />
        <p className="text-sm text-stone-700" data-testid="venue-used-by">
          {venueUsedBy(venue.usedBy)} · {venueItemCount(venue.fixedItemCount)}
        </p>
        <p className="mt-0.5 text-sm text-stone-600" data-testid="venue-edited">
          <EditedLine updatedAt={venue.updatedAt} editedBy={venue.editedBy} />
        </p>
      </div>
      {error && (
        <p role="alert" className={`${errorClass} mt-2 px-1`}>
          {error}
        </p>
      )}
      <div className="mt-auto flex flex-wrap gap-2 pt-3">
        <Link href={venueHref(venue.id, weddingId)} aria-label={`Open ${venue.name}`} className={`${secondaryButton} flex-1`}>
          Open
        </Link>
        <button type="button" onClick={duplicate} disabled={duplicating} aria-label={`Duplicate ${venue.name}`} className={`${secondaryButton} flex-1`}>
          {duplicating ? 'Duplicating…' : 'Duplicate'}
        </button>
        <button type="button" onClick={() => setDeleting(true)} aria-label={`Delete ${venue.name}`} className={`${secondaryButton} flex-1 text-red-700 hover:bg-red-50`}>
          Delete
        </button>
      </div>
      <VenueDeleteDialog
        open={deleting}
        venueId={venue.id}
        onClose={() => setDeleting(false)}
        onDeleted={() => {
          setDeleting(false)
          router.refresh()
        }}
      />
    </article>
  )
}

/** "New venue": an empty template named New venue, opened in the template editor. */
export function NewVenueButton({ weddingId }: { weddingId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [id] = useState(randomId)

  async function create() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const venue = await createVenue({ id, name: 'New venue' })
      router.push(venueHref(venue.id, weddingId))
    } catch (err) {
      setError(`Could not make the venue. ${errorMessage(err)}`)
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" className={primaryButton} onClick={create} disabled={busy} data-testid="new-venue">
        {busy ? 'Making…' : 'New venue'}
      </button>
      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}
    </div>
  )
}
