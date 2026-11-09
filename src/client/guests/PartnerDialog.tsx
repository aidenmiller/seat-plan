'use client'

/**
 * The partner picker: search the other guests and pick one to link as this
 * guest's partner, or Unlink. Linking someone who already has a partner
 * moves them (the server clears the old link, PLAN change 8); the list says
 * who is linked to whom so that is never a surprise.
 */
import { useMemo, useState } from 'react'
import { Dialog, DialogActions } from '@/client/ui/Dialog'
import { inputClass, secondaryButton } from '@/client/ui/styles'
import { compareByName, filterGuests, fullName } from '@/domain/guest-list'
import type { Guest } from '@/shared/api'

const MAX_SHOWN = 50

export function PartnerDialog({
  guest,
  guests,
  onPick,
  onClose,
}: {
  guest: Guest | null
  guests: readonly Guest[]
  /** A guest id to link, or null to unlink. */
  onPick(partnerId: string | null): void
  onClose(): void
}) {
  return (
    <Dialog open={guest !== null} onClose={onClose} title={guest ? `Partner of ${fullName(guest)}` : 'Partner'} testId="partner-dialog">
      {guest && <PartnerPicker guest={guest} guests={guests} onPick={onPick} onClose={onClose} />}
    </Dialog>
  )
}

function PartnerPicker({
  guest,
  guests,
  onPick,
  onClose,
}: {
  guest: Guest
  guests: readonly Guest[]
  onPick(partnerId: string | null): void
  onClose(): void
}) {
  const [query, setQuery] = useState('')
  const byId = useMemo(() => new Map(guests.map((g) => [g.id, g])), [guests])
  const partner = guest.partnerId ? byId.get(guest.partnerId) : undefined
  const matches = useMemo(
    () => filterGuests(guests.filter((g) => g.id !== guest.id && g.id !== guest.partnerId), query).sort(compareByName),
    [guests, guest.id, guest.partnerId, query],
  )

  return (
    <div>
      <p className="text-sm text-stone-700">
        {partner ? (
          <>
            Linked to <span className="font-medium">{fullName(partner)}</span>.
          </>
        ) : (
          'No partner yet.'
        )}
      </p>
      {partner && (
        <button
          type="button"
          className={`${secondaryButton} mt-2 w-full sm:w-auto`}
          onClick={() => onPick(null)}
          data-testid="partner-unlink"
        >
          Unlink {fullName(partner)}
        </button>
      )}
      <label className="mt-4 block text-sm font-medium text-stone-700">
        Find a guest
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name or nickname"
          autoComplete="off"
          className={`${inputClass} mt-1`}
          data-testid="partner-search"
        />
      </label>
      <ul className="mt-2 max-h-72 overflow-y-auto overscroll-contain rounded-lg border border-stone-200" data-testid="partner-options">
        {matches.slice(0, MAX_SHOWN).map((g) => {
          const theirs = g.partnerId ? byId.get(g.partnerId) : undefined
          return (
            <li key={g.id} className="border-b border-stone-100 last:border-b-0">
              <button
                type="button"
                onClick={() => onPick(g.id)}
                className="flex min-h-11 w-full flex-col items-start justify-center px-3 py-1.5 text-left text-sm hover:bg-stone-100 focus-visible:bg-stone-100 focus-visible:outline-none"
                data-guest-id={g.id}
              >
                <span className="font-medium text-stone-900">
                  {fullName(g)}
                  {g.nickname ? <span className="font-normal text-stone-600"> ({g.nickname})</span> : null}
                </span>
                {theirs && <span className="text-xs text-stone-600">Now linked to {fullName(theirs)}</span>}
              </button>
            </li>
          )
        })}
        {matches.length === 0 && <li className="px-3 py-3 text-sm text-stone-600">No guest matches.</li>}
        {matches.length > MAX_SHOWN && (
          <li className="px-3 py-2 text-xs text-stone-600">Showing {MAX_SHOWN} of {matches.length}. Type more of the name.</li>
        )}
      </ul>
      <DialogActions>
        <button type="button" className={secondaryButton} onClick={onClose}>
          Close
        </button>
      </DialogActions>
    </div>
  )
}

/**
 * The PATCH for linking `guest` to `partnerId` (or unlinking with null),
 * with the links this browser last saw, so the server can refuse when
 * someone changed one a moment earlier (PLAN section 5, "Partner links").
 */
export function partnerPatch(guest: Guest, partnerId: string | null, byId: ReadonlyMap<string, Guest>) {
  const expectedPartners: Record<string, string | null> = { [guest.id]: guest.partnerId }
  if (guest.partnerId) expectedPartners[guest.partnerId] = byId.get(guest.partnerId)?.partnerId ?? null
  if (partnerId) expectedPartners[partnerId] = byId.get(partnerId)?.partnerId ?? null
  return { partnerId, expectedPartners }
}
