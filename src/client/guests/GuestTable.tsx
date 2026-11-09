'use client'

/**
 * The guest table for laptops (spec section 6, "Guests page"): every column
 * sorts, every cell edits in place, and the first column holds each row's
 * check box (for Add to group) and its delete button. The table scrolls
 * inside its own box, never the page sideways: the box is at most 75% of
 * the window tall, so its sideways scrollbar is always on screen, the header
 * row stays at the top, and the first column and first name stay at the
 * left while the rest scrolls.
 */
import { memo } from 'react'
import type { GuestSort, GuestSortKey } from '@/domain/guest-list'
import { fullName } from '@/domain/guest-list'
import type { Group, Guest, GuestRsvp, GuestSide } from '@/shared/api'
import { CheckField, EditableText, GroupChip, SelectField } from './cells'
import { GUEST_COLUMNS, RSVP_OPTIONS, SIDE_OPTIONS } from './options'
import type { GuestRowActions } from './row-actions'

export function GuestTable({
  guests,
  sort,
  onSort,
  selected,
  allSelected,
  onSelectAll,
  guestById,
  groupById,
  seatText,
  actions,
}: {
  guests: readonly Guest[]
  sort: GuestSort
  onSort(key: GuestSortKey): void
  selected: ReadonlySet<string>
  allSelected: boolean
  onSelectAll(on: boolean): void
  guestById: ReadonlyMap<string, Guest>
  groupById: ReadonlyMap<string, Group>
  seatText: ReadonlyMap<string, string>
  actions: GuestRowActions
}) {
  return (
    // relative: the screen-reader-only labels inside are absolutely placed; the box must hold
    // them, or the rows scrolled out of it would still stretch the page below.
    <div className="relative max-h-[75vh] overflow-auto overscroll-contain rounded-xl border border-stone-200 bg-white" data-testid="guest-table-box">
      <table className="w-full min-w-[1200px] border-separate border-spacing-0 text-sm" data-testid="guest-table">
        <thead className="text-left text-xs font-semibold uppercase tracking-wide text-stone-600">
          <tr>
            <th scope="col" className={`${HEAD} left-0 z-30 w-24 min-w-24 px-1`}>
              <CheckField checked={allSelected} onChange={onSelectAll} label="Select every guest shown" testId="select-all-guests" />
            </th>
            {GUEST_COLUMNS.map((col) => {
              const on = sort.key === col.key
              const sticky = col.key === 'firstName'
              return (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={on ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                  className={`${HEAD} ${sticky ? `${NAME_LEFT} z-30 border-r border-r-stone-200` : 'z-20'} px-2 py-0 font-semibold`}
                >
                  <button
                    type="button"
                    onClick={() => onSort(col.key)}
                    className="-mx-1 inline-flex min-h-11 items-center gap-1 rounded px-1 uppercase hover:text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700/50"
                    data-testid={`sort-${col.key}`}
                  >
                    {col.label}
                    <SortArrow state={on ? sort.direction : null} />
                  </button>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {guests.map((guest) => (
            <GuestRow
              key={guest.id}
              guest={guest}
              partner={guest.partnerId ? guestById.get(guest.partnerId) : undefined}
              groupById={groupById}
              seats={seatText.get(guest.id) ?? ''}
              selected={selected.has(guest.id)}
              actions={actions}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Header cells stay at the top of the scroll box. */
const HEAD = 'sticky top-0 border-b border-stone-200 bg-stone-50'
/** The first name column sits right of the first column (w-24, 6 rem). */
const NAME_LEFT = 'sticky left-24'

function SortArrow({ state }: { state: 'asc' | 'desc' | null }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12" className={`h-3 w-3 ${state ? 'text-blue-900' : 'text-stone-300'}`} fill="currentColor">
      {state === 'desc' ? <path d="M6 9L2 4h8z" /> : <path d="M6 3l4 5H2z" />}
    </svg>
  )
}

const GuestRow = memo(function GuestRow({
  guest,
  partner,
  groupById,
  seats,
  selected,
  actions,
}: {
  guest: Guest
  partner: Guest | undefined
  groupById: ReadonlyMap<string, Group>
  seats: string
  selected: boolean
  actions: GuestRowActions
}) {
  const name = fullName(guest)
  const groups = guest.groupIds.map((id) => groupById.get(id)).filter((g): g is Group => g !== undefined)
  const cell = 'border-b border-stone-100 px-2 py-0 align-middle'
  // Sticky cells need their own background, or the scrolled cells show through.
  const pinned = `${selected ? 'bg-blue-50' : 'bg-white'} sticky z-10`
  return (
    <tr data-testid="guest-row" data-guest-id={guest.id} className={selected ? 'bg-blue-50' : undefined}>
      <td className={`border-b border-stone-100 px-1 py-0 align-middle ${pinned} left-0 w-24 min-w-24`}>
        <div className="flex items-center">
          <CheckField checked={selected} onChange={(on) => actions.select(guest.id, on)} label={`Select ${name}`} />
          <DeleteButton name={name} onClick={() => actions.openDelete(guest)} />
        </div>
      </td>
      <td className={`${cell} ${pinned} left-24 w-36 border-r border-r-stone-200`}>
        <EditableText value={guest.firstName} label={`First name of ${name}`} required onSave={(v) => v && actions.edit(guest, { firstName: v })} testId="cell-firstName" />
      </td>
      <td className={`${cell} w-36`}>
        <EditableText value={guest.lastName} label={`Last name of ${name}`} required onSave={(v) => v && actions.edit(guest, { lastName: v })} testId="cell-lastName" />
      </td>
      <td className={`${cell} w-28`}>
        <EditableText value={guest.nickname} label={`Nickname of ${name}`} maxLength={100} onSave={(v) => actions.edit(guest, { nickname: v })} testId="cell-nickname" />
      </td>
      <td className={`${cell} w-36`}>
        <button
          type="button"
          onClick={() => actions.openPartner(guest)}
          className="-mx-1 flex min-h-11 w-full min-w-0 items-center rounded-lg px-1 text-left hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700/50"
          data-testid="cell-partner"
        >
          <span className="sr-only">Partner of {name}: </span>
          {partner ? <span className="truncate">{fullName(partner)}</span> : <span className="text-stone-400">None</span>}
        </button>
      </td>
      <td className={`${cell} w-32`}>
        <EditableText value={guest.household} label={`Household of ${name}`} onSave={(v) => actions.edit(guest, { household: v })} testId="cell-household" />
      </td>
      <td className={`${cell} w-24`}>
        <SelectField<GuestSide> value={guest.side} label={`Side of ${name}`} options={SIDE_OPTIONS} onChange={(v) => actions.edit(guest, { side: v })} testId="cell-side" />
      </td>
      <td className={`${cell} w-28`}>
        <SelectField<GuestRsvp> value={guest.rsvp} label={`RSVP of ${name}`} options={RSVP_OPTIONS} onChange={(v) => actions.edit(guest, { rsvp: v })} testId="cell-rsvp" />
      </td>
      <td className={`${cell} w-28`}>
        <EditableText value={guest.meal} label={`Meal of ${name}`} onSave={(v) => actions.edit(guest, { meal: v })} testId="cell-meal" />
      </td>
      <td className={`${cell} w-16`}>
        <CheckField checked={guest.isChild} label={`${name} is a child`} onChange={(v) => actions.edit(guest, { isChild: v })} testId="cell-child" />
      </td>
      <td className={`${cell} w-44`}>
        <button
          type="button"
          onClick={() => actions.openGroups(guest)}
          className="-mx-1 flex min-h-11 w-full min-w-0 flex-wrap items-center gap-1 rounded-lg px-1 py-1 text-left hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700/50"
          data-testid="cell-groups"
        >
          <span className="sr-only">Groups of {name}: </span>
          {groups.length === 0 ? <span className="text-stone-400">None</span> : groups.map((g) => <GroupChip key={g.id} name={g.name} color={g.color} />)}
        </button>
      </td>
      <td className={`${cell} w-48`}>
        <EditableText value={guest.notes} label={`Notes on ${name}`} multiline onSave={(v) => actions.edit(guest, { notes: v })} testId="cell-notes" />
      </td>
      <td className={`${cell} w-40 text-stone-700`} data-testid="cell-seats">
        {seats || <span className="text-stone-400">Not seated</span>}
      </td>
    </tr>
  )
})

export function DeleteButton({ name, onClick }: { name: string; onClick(): void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Delete ${name}`}
      title={`Delete ${name}`}
      className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-stone-500 hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700/50"
      data-testid="delete-guest"
    >
      <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}
