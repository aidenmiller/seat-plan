'use client'

/**
 * The Venues tab (spec section 5; PLAN section 7 "Venue templates"): the
 * venues this wedding may use, in groups (Library, Your venues, Used in this
 * wedding). A card has a badge saying whose it is, the name (rename in place
 * when you may change it), how many layouts use it and when it was last
 * edited. A venue you may change has Open, Duplicate and Delete; one you may
 * not has Open (view only) and "Make my own copy", which makes a private copy
 * and opens it. New venue makes an empty template and opens the template editor.
 *
 * Test hooks: data-testid="venue-list", each card "venue-card" with
 * data-venue-id and data-access, "venue-name", "venue-badge", "venue-used-by",
 * "venue-edited", "venue-copy".
 */
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createVenue, duplicateVenue, errorMessage, renameVenue } from '@/client/api'
import { useCurrentUser } from '@/client/current-user'
import { randomId } from '@/client/sync/random-id'
import { InlineName } from '@/client/ui/InlineName'
import { EditedLine } from '@/client/ui/RelativeTime'
import { errorClass, primaryButton, secondaryButton } from '@/client/ui/styles'
import { venueBadge, venueGroups, venueItemCount, venueUsedBy } from '@/domain/venue-wording'
import type { VenueSummary } from '@/shared/api'
import { useMakeCopy, venueHref } from './make-copy'
import { VenueDeleteDialog } from './VenueDeleteDialog'

export { venueHref }

export function VenueList({ weddingId, venues }: { weddingId: string; venues: VenueSummary[] }) {
  if (venues.length === 0) {
    return <p className="rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center text-stone-600">No venues yet. Make one with New venue.</p>
  }
  return (
    <div className="space-y-6" data-testid="venue-list">
      {venueGroups(venues).map((group) => (
        <section key={group.key} aria-labelledby={`venues-${group.key}`} data-testid={`venue-group-${group.key}`}>
          <h2 id={`venues-${group.key}`} className="mb-2 text-sm font-semibold text-stone-800">
            {group.title}
          </h2>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {group.venues.map((v) => (
              <li key={v.id}>
                <VenueCard weddingId={weddingId} venue={v} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function VenueCard({ weddingId, venue }: { weddingId: string; venue: VenueSummary }) {
  const router = useRouter()
  const user = useCurrentUser()
  const badge = venueBadge(venue, user.isAdmin)
  const makeCopy = useMakeCopy(venue.id, (copyId) => venueHref(copyId, weddingId))
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
    <article className="flex h-full flex-col rounded-xl border border-stone-200 bg-white p-3 shadow-sm" data-testid="venue-card" data-venue-id={venue.id} data-access={venue.access}>
      <div className="px-1">
        {badge && (
          <p className="mb-1">
            <span className="inline-block max-w-full truncate rounded-full border border-stone-300 bg-stone-100 px-2 py-0.5 align-top text-xs font-medium text-stone-700" data-testid="venue-badge">
              {badge}
            </span>
          </p>
        )}
        {venue.canEdit ? (
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
        ) : (
          <p className="flex min-h-11 items-center text-base font-semibold" data-testid="venue-name">
            <span className="min-w-0 truncate">{venue.name}</span>
          </p>
        )}
        <p className="text-sm text-stone-700" data-testid="venue-used-by">
          {venueUsedBy(venue.usedBy)} · {venueItemCount(venue.fixedItemCount)}
        </p>
        <p className="mt-0.5 text-sm text-stone-600" data-testid="venue-edited">
          <EditedLine updatedAt={venue.updatedAt} editedBy={venue.editedBy} />
        </p>
      </div>
      {(error ?? makeCopy.error) && (
        <p role="alert" className={`${errorClass} mt-2 px-1`}>
          {error ?? makeCopy.error}
        </p>
      )}
      <div className="mt-auto flex flex-wrap gap-2 pt-3">
        <Link href={venueHref(venue.id, weddingId)} aria-label={venue.canEdit ? `Open ${venue.name}` : `Open ${venue.name} (view only)`} className={`${secondaryButton} flex-1`}>
          Open
        </Link>
        {venue.canEdit ? (
          <>
            <button type="button" onClick={duplicate} disabled={duplicating} aria-label={`Duplicate ${venue.name}`} className={`${secondaryButton} flex-1`}>
              {duplicating ? 'Duplicating…' : 'Duplicate'}
            </button>
            <button type="button" onClick={() => setDeleting(true)} aria-label={`Delete ${venue.name}`} className={`${secondaryButton} flex-1 text-red-700 hover:bg-red-50`}>
              Delete
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => void makeCopy.copy()}
            disabled={makeCopy.busy}
            aria-label={`Make my own copy of ${venue.name}`}
            className={`${secondaryButton} flex-[2] whitespace-nowrap`}
            data-testid="venue-copy"
          >
            {makeCopy.busy ? 'Copying…' : 'Make my own copy'}
          </button>
        )}
      </div>
      {venue.canEdit && (
        <VenueDeleteDialog
          open={deleting}
          venueId={venue.id}
          onClose={() => setDeleting(false)}
          onDeleted={() => {
            setDeleting(false)
            router.refresh()
          }}
        />
      )}
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
