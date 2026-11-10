'use client'

/**
 * The editor's Guests tab (spec section 6, "Seated and unassigned"; PLAN
 * section 7): counts at the top ("142 guests · 118 seated · 24 unassigned ·
 * 6 declined", DECISIONS 22), a search box that filters as you type on first
 * name, last name and nickname, filters for group, side and RSVP, then two
 * parts: Unassigned, and Seated with each guest's table. Guests who said no
 * stay out of Unassigned until Show declined is ticked, or the RSVP filter
 * is No. A declined guest who still holds a seat is named apart in the
 * Seated heading, so it agrees with the counts at the top.
 *
 * Each name is a row carrying data-guest-id, and the seating tools
 * (milestone 5): drag it onto a seat or a table (a mouse after 4 px, a
 * finger after a 450 ms hold); click or tap a seated name to pan to the
 * seat; on a phone, tap an unassigned name and then a seat. Enter or Space
 * does the same as a tap. The whole right panel, or the phone's sheet, is
 * where a seated guest is dragged to unseat them (EditorShell marks it).
 */
import Link from 'next/link'
import { memo, useId, useMemo, useState } from 'react'
import { CheckField, SelectField } from '@/client/guests/cells'
import { SearchBox } from '@/client/guests/GuestFilters'
import { RSVP_OPTIONS, SIDE_OPTIONS } from '@/client/guests/options'
import {
  compareText,
  declinedShown,
  fullName,
  seatedHeadingText,
  seatLabelsByGuest,
  sideList,
  sideListCountsText,
  type ListRsvp,
  type ListSide,
} from '@/domain/guest-list'
import type { Guest } from '@/shared/api'
import { useCanvas, useGuestRowProps } from '../state'
import { useEditorUi } from './editor-ui'
import { useEditorGuests } from './guests-context'

const ANY = '__any__'

export function GuestsPanel() {
  const { weddingId, guests, groups } = useEditorGuests()
  const { phone } = useEditorUi()
  const items = useCanvas((c) => c.items)
  const seatLabels = useMemo(() => seatLabelsByGuest(items), [items])
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState<string | null>(null)
  const [side, setSide] = useState<ListSide | null>(null)
  const [rsvp, setRsvp] = useState<ListRsvp | null>(null)
  const [showDeclined, setShowDeclined] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const filtersId = useId()
  const unassignedId = useId()
  const seatedId = useId()

  const list = useMemo(
    () => sideList(guests, seatLabels, { query, group, side, rsvp, showDeclined }),
    [guests, seatLabels, query, group, side, rsvp, showDeclined],
  )
  const groupOptions = useMemo(
    () => [{ value: ANY, label: 'Any group' }, ...[...groups].sort((a, b) => compareText(a.name, b.name)).map((g) => ({ value: g.id, label: g.name }))],
    [groups],
  )
  const filtering = group !== null || side !== null || rsvp !== null
  const showFilters = !phone || filtersOpen

  if (guests.length === 0) {
    return (
      <div className="px-4 py-6 text-sm text-stone-600" data-testid="guests-panel">
        <p data-testid="guests-empty">No guests yet.</p>
        {weddingId && (
          <Link href={`/w/${weddingId}/guests`} className="mt-2 inline-flex min-h-11 items-center font-medium text-blue-900 underline">
            Add guests on the Guests tab
          </Link>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3 px-3 py-3" data-testid="guests-panel">
      <p className="text-sm font-medium text-stone-800" data-testid="side-list-counts">
        {sideListCountsText(list.counts)}
      </p>
      <SearchBox value={query} onChange={setQuery} testId="side-list-search" />
      {phone && (
        <button
          type="button"
          onClick={() => setFiltersOpen((o) => !o)}
          aria-expanded={filtersOpen}
          aria-controls={filtersId}
          className="inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-medium text-stone-700 hover:bg-stone-100"
        >
          Filters{filtering ? ' (on)' : ''}
        </button>
      )}
      {showFilters && (
        <div id={filtersId} className="grid grid-cols-2 gap-2" data-testid="side-list-filters">
          <SelectField label="Group" value={group ?? ANY} options={groupOptions} onChange={(v) => setGroup(v === ANY ? null : v)} className="col-span-2" testId="side-list-group" />
          <SelectField<string>
            label="Side"
            value={side ?? ANY}
            options={[{ value: ANY, label: 'Any side' }, ...SIDE_OPTIONS]}
            onChange={(v) => setSide(v === ANY ? null : (v as ListSide))}
            testId="side-list-side"
          />
          <SelectField<string>
            label="RSVP"
            value={rsvp ?? ANY}
            options={[{ value: ANY, label: 'Any RSVP' }, ...RSVP_OPTIONS]}
            onChange={(v) => setRsvp(v === ANY ? null : (v as ListRsvp))}
            testId="side-list-rsvp"
          />
        </div>
      )}
      <CheckField
        checked={declinedShown({ rsvp, showDeclined })}
        disabled={rsvp === 'no'}
        onChange={setShowDeclined}
        label="Show declined"
        testId="side-list-show-declined"
      >
        Show declined
      </CheckField>

      <section aria-labelledby={unassignedId} data-testid="side-list-unassigned">
        <h3 id={unassignedId} className="text-xs font-semibold uppercase tracking-wide text-stone-500">
          Unassigned ({list.unassigned.length})
        </h3>
        {list.unassigned.length === 0 ? (
          <p className="mt-1 text-sm text-stone-600">{query || filtering ? 'No one matches.' : 'Everyone is seated.'}</p>
        ) : (
          <ul role="presentation" className="mt-1">
            {list.unassigned.map((g) => (
              <GuestRow key={g.id} guest={g} label={null} />
            ))}
          </ul>
        )}
        {list.hiddenDeclined > 0 && (
          <p className="mt-1 text-xs text-stone-500">
            {list.hiddenDeclined} declined {list.hiddenDeclined === 1 ? 'guest is' : 'guests are'} hidden.
          </p>
        )}
      </section>

      <section aria-labelledby={seatedId} data-testid="side-list-seated">
        <h3 id={seatedId} className="text-xs font-semibold uppercase tracking-wide text-stone-500">
          {seatedHeadingText(list.seated)}
        </h3>
        {list.seated.length === 0 ? (
          <p className="mt-1 text-sm text-stone-600">{query || filtering ? 'No one matches.' : 'No one is seated in this layout yet.'}</p>
        ) : (
          <ul role="presentation" className="mt-1">
            {list.seated.map(({ guest, label }) => (
              <GuestRow key={guest.id} guest={guest} label={label} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

/** One name in the side list: drag it to a seat; click or tap a seated name to pan to the seat. */
const GuestRow = memo(function GuestRow({ guest, label }: { guest: Guest; label: string | null }) {
  const rowProps = useGuestRowProps(guest.id)
  const name = fullName(guest)
  return (
    <li
      role="button"
      tabIndex={0}
      className="flex min-h-11 items-center justify-between gap-2 border-b border-stone-100 px-1 text-sm outline-none last:border-b-0 hover:bg-stone-50 focus-visible:bg-stone-100"
      data-testid="side-list-guest"
      {...rowProps}
      data-seated={label !== null ? 'true' : 'false'}
    >
      <span className="min-w-0 truncate">
        <span className="text-stone-900">{name}</span>
        {guest.nickname && <span className="text-stone-500"> ({guest.nickname})</span>}
        {guest.rsvp === 'no' && <span className="text-stone-500"> · declined</span>}
      </span>
      {label !== null && <span className="max-w-[45%] shrink-0 truncate text-xs text-stone-600">{label}</span>}
    </li>
  )
})
