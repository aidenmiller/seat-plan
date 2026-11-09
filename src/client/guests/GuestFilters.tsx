'use client'

/**
 * The search box and filters over the guest list: group, side, RSVP, child
 * and meal (PLAN section 7). Two columns on a phone, one row on a laptop.
 */
import { useId } from 'react'
import { inputClass } from '@/client/ui/styles'
import { compareText, hasFilters, NONE, NO_FILTERS, type GuestFilters, type ListRsvp, type ListSide } from '@/domain/guest-list'
import type { Group } from '@/shared/api'
import { SelectField } from './cells'
import { RSVP_OPTIONS, SIDE_OPTIONS } from './options'

const ANY = '__any__'

export function SearchBox({
  value,
  onChange,
  label = 'Search guests',
  testId = 'guest-search',
}: {
  value: string
  onChange(value: string): void
  label?: string
  testId?: string
}) {
  const id = useId()
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search by name or nickname"
        autoComplete="off"
        enterKeyHint="search"
        className={inputClass}
        data-testid={testId}
      />
    </div>
  )
}

export function GuestFilterBar({
  filters,
  onChange,
  groups,
  meals,
}: {
  filters: GuestFilters
  onChange(filters: GuestFilters): void
  groups: readonly Group[]
  meals: readonly string[]
}) {
  const groupOptions = [
    { value: ANY, label: 'Any group' },
    { value: NONE, label: 'No group' },
    ...[...groups].sort((a, b) => compareText(a.name, b.name)).map((g) => ({ value: g.id, label: g.name })),
  ]
  const mealOptions = [{ value: ANY, label: 'Any meal' }, { value: NONE, label: 'No meal' }, ...meals.map((m) => ({ value: m, label: m }))]
  const set = (patch: Partial<GuestFilters>) => onChange({ ...filters, ...patch })
  const orNull = <T extends string>(v: string): T | null => (v === ANY ? null : (v as T))

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" data-testid="guest-filters">
      <SelectField
        label="Group"
        value={filters.group ?? ANY}
        options={groupOptions}
        onChange={(v) => set({ group: orNull(v) })}
        testId="filter-group"
      />
      <SelectField
        label="Side"
        value={filters.side ?? ANY}
        options={[{ value: ANY, label: 'Any side' }, ...SIDE_OPTIONS]}
        onChange={(v) => set({ side: orNull<ListSide>(v) })}
        testId="filter-side"
      />
      <SelectField
        label="RSVP"
        value={filters.rsvp ?? ANY}
        options={[{ value: ANY, label: 'Any RSVP' }, ...RSVP_OPTIONS]}
        onChange={(v) => set({ rsvp: orNull<ListRsvp>(v) })}
        testId="filter-rsvp"
      />
      <SelectField
        label="Child"
        value={filters.child === null ? ANY : filters.child ? 'child' : 'adult'}
        options={[
          { value: ANY, label: 'Adults and children' },
          { value: 'child', label: 'Children' },
          { value: 'adult', label: 'Adults' },
        ]}
        onChange={(v) => set({ child: v === ANY ? null : v === 'child' })}
        testId="filter-child"
      />
      <SelectField label="Meal" value={filters.meal ?? ANY} options={mealOptions} onChange={(v) => set({ meal: orNull(v) })} testId="filter-meal" />
      <button
        type="button"
        onClick={() => onChange(NO_FILTERS)}
        disabled={!hasFilters(filters)}
        className="min-h-11 rounded-lg px-3 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Clear filters
      </button>
    </div>
  )
}
