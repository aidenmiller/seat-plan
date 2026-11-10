'use client'

/**
 * Picks the guests of a rule: the picked ones as chips you can take off, a
 * search that lists matching guests to add, and a list of groups that adds
 * a whole group's members at once (spec section 7, "Rules"). A group's
 * members are copied as they are now (PLAN section 4).
 */
import { useId, useMemo, useState } from 'react'
import { inputClass, labelClass } from '@/client/ui/styles'
import { compareByName, compareText, fullName, matchesSearch, searchTerms } from '@/domain/guest-list'
import { addPicked } from '@/domain/rules-list'
import type { Group, Guest } from '@/shared/api'

const RESULT_LIMIT = 8

export function GuestPicker({
  guests,
  groups,
  picked,
  onChange,
}: {
  guests: readonly Guest[]
  groups: readonly Group[]
  picked: readonly string[]
  onChange(next: string[]): void
}) {
  const [query, setQuery] = useState('')
  const searchId = useId()
  const groupId = useId()
  const byId = useMemo(() => new Map(guests.map((g) => [g.id, g])), [guests])
  const results = useMemo(() => {
    const terms = searchTerms(query)
    if (terms.length === 0) return []
    return guests
      .filter((g) => !picked.includes(g.id) && matchesSearch(g, terms))
      .sort(compareByName)
      .slice(0, RESULT_LIMIT)
  }, [guests, picked, query])
  const sortedGroups = useMemo(() => [...groups].filter((g) => g.memberIds.length > 0).sort((a, b) => compareText(a.name, b.name)), [groups])

  return (
    <div className="space-y-3" data-testid="guest-picker">
      <div>
        <p className={labelClass}>Guests</p>
        {picked.length === 0 ? (
          <p className="mt-1 text-sm text-stone-600">Pick two or more.</p>
        ) : (
          <ul className="mt-1 flex flex-wrap gap-1" data-testid="picked-guests">
            {picked.map((id) => {
              const g = byId.get(id)
              const name = g ? fullName(g) : 'Removed guest'
              return (
                <li key={id} className="inline-flex items-center rounded-full bg-stone-100 pl-3 text-sm text-stone-800">
                  {name}
                  <button
                    type="button"
                    className="inline-flex h-11 w-11 items-center justify-center rounded-full text-stone-500 hover:bg-stone-200 hover:text-stone-900"
                    aria-label={`Take ${name} off`}
                    onClick={() => onChange(picked.filter((p) => p !== id))}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <div>
        <label htmlFor={searchId} className={labelClass}>
          Add a guest
        </label>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type a name"
          autoComplete="off"
          className={`${inputClass} mt-1`}
          data-testid="guest-picker-search"
        />
        {results.length > 0 && (
          <ul className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-stone-200" data-testid="guest-picker-results">
            {results.map((g) => (
              <li key={g.id}>
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center px-3 text-left text-sm text-stone-900 hover:bg-stone-100"
                  onClick={() => {
                    onChange(addPicked(picked, [g.id]))
                    setQuery('')
                  }}
                >
                  {fullName(g)}
                  {g.nickname && <span className="ml-1 text-stone-500">({g.nickname})</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {query.trim() !== '' && results.length === 0 && <p className="mt-1 text-sm text-stone-600">No guests match.</p>}
      </div>
      {sortedGroups.length > 0 && (
        <div>
          <label htmlFor={groupId} className={labelClass}>
            Add a whole group
          </label>
          <select
            id={groupId}
            value=""
            onChange={(e) => {
              const group = groups.find((g) => g.id === e.target.value)
              if (group) onChange(addPicked(picked, group.memberIds))
            }}
            className={`${inputClass} mt-1`}
            data-testid="guest-picker-group"
          >
            <option value="">Pick a group</option>
            {sortedGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.memberIds.length})
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  )
}
