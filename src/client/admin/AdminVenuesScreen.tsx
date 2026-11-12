'use client'

import Link from 'next/link'
import { useId, useState } from 'react'
import { changeVenueAsAdmin } from '@/client/admin-api'
import { errorMessage } from '@/client/api'
import { Dialog, DialogActions } from '@/client/ui/Dialog'
import { RelativeTime } from '@/client/ui/RelativeTime'
import { errorClass, inputClass, labelClass, primaryButton, secondaryButton } from '@/client/ui/styles'
import type { AdminPick, AdminVenue, AdminVenuePatchBody, AdminVenueStatus } from '@/shared/admin-api'

const cell = 'border-b border-stone-200 px-3 py-2 align-middle'
const head = 'border-b border-stone-200 px-3 py-2 font-semibold'
const smallButton = `${secondaryButton} px-3`

const STATUS: Record<AdminVenueStatus, string> = { library: 'Library', private: 'Private', 'no-owner': 'No owner' }

/** What the open dialog is for: adding to the library, picking an owner, or taking a venue out of the library. */
type Action = { kind: 'add' | 'owner' | 'remove'; venue: AdminVenue }

function usedBy(venue: AdminVenue): string {
  if (venue.layouts === 0) return 'Not used'
  const layouts = venue.layouts === 1 ? '1 layout' : `${venue.layouts} layouts`
  const weddings = venue.weddings === 1 ? '1 wedding' : `${venue.weddings} weddings`
  return `${layouts} in ${weddings}`
}

/**
 * Admin: every venue template, whoever owns it: the shared library, each
 * planner's private ones, and old ones nobody owns, with how many layouts use
 * each across every wedding. Add one to the library (every planner can then
 * see and copy it, and only admins can change it), take one out (it needs an
 * owner first, so the dialog asks for one when it has none), or give it
 * another owner. The name opens the venue's editor.
 */
export function AdminVenuesScreen({ initialVenues, people }: { initialVenues: AdminVenue[]; people: AdminPick[] }) {
  const [venues, setVenues] = useState(initialVenues)
  const [action, setAction] = useState<Action | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null)

  const replace = (next: AdminVenue) => setVenues((list) => list.map((v) => (v.id === next.id ? next : v)))

  async function removeFromLibrary(venue: AdminVenue) {
    if (!venue.owner) {
      setAction({ kind: 'remove', venue })
      return
    }
    setBusyId(venue.id)
    setRowError(null)
    try {
      replace(await changeVenueAsAdmin(venue.id, { library: false }))
    } catch (err) {
      setRowError({ id: venue.id, message: `Could not take it out of the library. ${errorMessage(err)}` })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section aria-labelledby="venues-heading">
      <h2 id="venues-heading" className="text-xl font-semibold tracking-tight">
        Venues
      </h2>
      <p className="mt-1 text-sm text-stone-600">Every venue, whoever owns it. Planners see only the library, their own, and venues their weddings use.</p>
      {venues.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center text-stone-600">No venues yet.</p>
      ) : (
        // Positioned, so the table's sr-only text stays inside its own sideways scroll instead of widening the page.
        <div className="relative mt-4 overflow-x-auto overscroll-x-contain rounded-xl border border-stone-200 bg-white" data-testid="admin-venues-box">
          <table className="w-full min-w-[880px] border-separate border-spacing-0 text-sm" data-testid="admin-venues">
            <thead className="text-left text-xs uppercase tracking-wide text-stone-600">
              <tr>
                <th scope="col" className={head}>Venue</th>
                <th scope="col" className={head}>Where</th>
                <th scope="col" className={head}>Owner</th>
                <th scope="col" className={head}>Used by</th>
                <th scope="col" className={head}>Last changed</th>
                <th scope="col" className={head}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {venues.map((venue) => {
                const busy = busyId === venue.id
                return (
                  <tr key={venue.id} data-testid="admin-venue" data-venue-id={venue.id}>
                    <td className={`${cell} font-medium`}>
                      <Link href={`/venues/${venue.id}`} className="text-blue-900 underline decoration-blue-900/30 underline-offset-2 hover:decoration-blue-900">
                        {venue.name}
                      </Link>
                    </td>
                    <td className={cell} data-testid="admin-venue-status">
                      {venue.status === 'no-owner' ? <span className="font-medium text-amber-800">{STATUS[venue.status]}</span> : STATUS[venue.status]}
                    </td>
                    <td className={cell}>{venue.owner ? venue.owner.displayName : <span className="text-stone-500">Nobody</span>}</td>
                    <td className={cell}>{usedBy(venue)}</td>
                    <td className={cell}>
                      <RelativeTime iso={venue.updatedAt} />
                    </td>
                    <td className={cell}>
                      <div className="flex flex-wrap justify-end gap-2">
                        {venue.isLibrary ? (
                          <button type="button" className={smallButton} disabled={busy} onClick={() => void removeFromLibrary(venue)}>
                            Remove from library
                          </button>
                        ) : (
                          <button type="button" className={smallButton} disabled={busy} onClick={() => setAction({ kind: 'add', venue })}>
                            Add to library
                          </button>
                        )}
                        <button type="button" className={smallButton} disabled={busy} onClick={() => setAction({ kind: 'owner', venue })}>
                          Change owner
                        </button>
                      </div>
                      {rowError?.id === venue.id && (
                        <p role="alert" className={`${errorClass} mt-1 text-right`}>
                          {rowError.message}
                        </p>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {action?.kind === 'add' && (
        <VenueDialog
          title={`Add ${action.venue.name} to the library?`}
          description={`Every planner will see it and can copy it. While it is in the library only admins can change it${
            action.venue.owner ? `, ${action.venue.owner.displayName} included` : ''
          }.`}
          confirm="Add to library"
          onClose={() => setAction(null)}
          run={async () => replace(await changeVenueAsAdmin(action.venue.id, { library: true }))}
        />
      )}
      {(action?.kind === 'owner' || action?.kind === 'remove') && (
        <VenueDialog
          title={action.kind === 'remove' ? `Take ${action.venue.name} out of the library` : `Change the owner of ${action.venue.name}`}
          description={
            action.kind === 'remove'
              ? 'A venue outside the library needs an owner. Pick one; it becomes their private venue.'
              : action.venue.isLibrary
                ? 'It stays in the library. Its owner can change it again once it leaves the library.'
                : 'The new owner can change it and attach it to their weddings. Weddings that use it now keep it.'
          }
          confirm={action.kind === 'remove' ? 'Take out of library' : 'Change owner'}
          pick={{ people, current: action.venue.owner?.id ?? null, allowNobody: action.kind === 'owner' && action.venue.isLibrary }}
          onClose={() => setAction(null)}
          run={async (ownerUserId) => {
            const body: AdminVenuePatchBody = action.kind === 'remove' ? { library: false, ownerUserId } : { ownerUserId }
            replace(await changeVenueAsAdmin(action.venue.id, body))
          }}
        />
      )}
    </section>
  )
}

const NOBODY = 'nobody'

/** Asks before a change, with an owner picker when `pick` is given; shows what went wrong. */
function VenueDialog({
  title,
  description,
  confirm,
  pick,
  onClose,
  run,
}: {
  title: string
  description: string
  confirm: string
  pick?: { people: AdminPick[]; current: string | null; allowNobody: boolean }
  onClose: () => void
  run: (ownerUserId: string | null) => Promise<void>
}) {
  // An owner whose account is off is not in the list: start from "Pick a person".
  const [owner, setOwner] = useState(pick?.current && pick.people.some((p) => p.id === pick.current) ? pick.current : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pickId = useId()
  const chosen = owner === NOBODY ? null : owner

  async function submit() {
    if (busy || (pick && owner === '')) return
    setBusy(true)
    setError(null)
    try {
      await run(chosen)
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onClose} title={title} description={description} dismissable={!busy} testId="admin-venue-dialog">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        {pick && (
          <>
            <label htmlFor={pickId} className={labelClass}>
              Owner
            </label>
            <select id={pickId} className={`${inputClass} mt-1`} value={owner} onChange={(e) => setOwner(e.target.value)} required>
              <option value="">Pick a person</option>
              {pick.allowNobody && <option value={NOBODY}>Nobody</option>}
              {pick.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName} ({p.email})
                </option>
              ))}
            </select>
          </>
        )}
        {error && (
          <p role="alert" className={`${errorClass} mt-3`}>
            {error}
          </p>
        )}
        <DialogActions>
          <button type="button" className={secondaryButton} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={primaryButton} disabled={busy || (pick !== undefined && owner === '')}>
            {busy ? 'Working…' : confirm}
          </button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
