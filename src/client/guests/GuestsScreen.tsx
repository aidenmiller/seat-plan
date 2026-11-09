'use client'

/**
 * The wedding's Guests page (spec section 6, PLAN section 7): a table on
 * laptops and cards on phones, sorted by any column, filtered by group,
 * side, RSVP, child and meal, searched by first name, last name and
 * nickname. Every field edits in place and saves through the row queue;
 * adding, deleting, pasting names and group changes go straight to the
 * server. Select guests to add them to a group at once; the bar says how
 * many of them the search and filters hide.
 *
 * Export CSV sends any edit still waiting in the row queue first, so the
 * file holds it, and says so when one could not be sent.
 */
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { guestsExportUrl, listGuestSeats } from '@/client/api'
import { defaultRowSaver } from '@/client/sync/row-save'
import { primaryButton, secondaryButton } from '@/client/ui/styles'
import { SAMPLE_CSV_FILE_NAME, SAMPLE_CSV_URL } from '@/domain/csv/sample'
import {
  DEFAULT_SORT,
  filterGuests,
  fullName,
  GUEST_SORT_KEYS,
  hasFilters,
  mealChoices,
  nextSort,
  NO_FILTERS,
  seatTextByGuest,
  sortGuests,
  type GuestFilters,
  type GuestSort,
  type GuestSortKey,
  type SortContext,
} from '@/domain/guest-list'
import { plural } from '@/domain/wording'
import type { Group, Guest, GuestSeatPlace } from '@/shared/api'
import { AddGuestForm } from './AddGuestForm'
import { AddToGroupDialog } from './AddToGroupDialog'
import { CheckField, SelectField } from './cells'
import { DeleteGuestDialog } from './DeleteGuestDialog'
import { GuestCards, GuestEditDialog } from './GuestCards'
import { GuestFilterBar, SearchBox } from './GuestFilters'
import { GuestGroupsDialog } from './GuestGroupsDialog'
import { GuestTable } from './GuestTable'
import { SORT_LABEL } from './options'
import { PartnerDialog, partnerPatch } from './PartnerDialog'
import { PasteNamesDialog } from './PasteNamesDialog'
import type { GuestRowActions } from './row-actions'
import { useGuestData } from './use-guest-data'
import { useNarrowScreen } from './use-narrow'

/** The dialog on top. The phone edit dialog (editId) stays open under the partner, groups and delete dialogs. */
type OpenDialog = { kind: 'partner' | 'groups' | 'delete'; guestId: string } | { kind: 'add-to-group' } | { kind: 'paste' }

export type GuestsScreenProps = {
  weddingId: string
  guests: Guest[]
  groups: Group[]
  /** Where each guest sits in the wedding's live layouts. */
  seats: GuestSeatPlace[]
}

export function GuestsScreen({ weddingId, guests: serverGuests, groups: serverGroups, seats: serverSeats }: GuestsScreenProps) {
  const data = useGuestData(weddingId, serverGuests, serverGroups)
  const narrow = useNarrowScreen()
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<GuestFilters>(NO_FILTERS)
  const [sort, setSort] = useState<GuestSort>(DEFAULT_SORT)
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [dialog, setDialog] = useState<OpenDialog | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [seats, setSeats] = useState({ list: serverSeats, from: serverSeats })
  if (seats.from !== serverSeats) setSeats({ list: serverSeats, from: serverSeats })
  const [exporting, setExporting] = useState<'idle' | 'saving' | 'unsaved'>('idle')

  // Browser Back shows this page from Next's client cache, as it was on the
  // first visit; where guests sit may have changed since (useGuestData
  // fetches the lists again the same way).
  useEffect(() => {
    let live = true
    listGuestSeats(weddingId).then(
      (list) => {
        if (live) setSeats((s) => ({ ...s, list }))
      },
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [weddingId])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 5000)
    return () => clearTimeout(timer)
  }, [notice])

  const seatText = useMemo(() => seatTextByGuest(seats.list), [seats.list])
  const meals = useMemo(() => mealChoices(data.guests), [data.guests])
  const ctx = useMemo<SortContext>(
    () => ({
      partnerName: (id) => {
        const p = data.guestById.get(id)
        return p ? fullName(p) : ''
      },
      groupName: (id) => data.groupById.get(id)?.name ?? '',
      seatText: (id) => seatText.get(id) ?? '',
    }),
    [data.guestById, data.groupById, seatText],
  )
  const shown = useMemo(() => sortGuests(filterGuests(data.guests, query, filters), sort, ctx), [data.guests, query, filters, sort, ctx])
  const selectedIds = useMemo(() => [...selected].filter((id) => data.guestById.has(id)), [selected, data.guestById])
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const allSelected = shown.length > 0 && shown.every((g) => selectedSet.has(g.id))
  /** Selected guests the search and filters hide; Add to group still takes them. */
  const hiddenSelected = useMemo(() => {
    const shownIds = new Set(shown.map((g) => g.id))
    return selectedIds.filter((id) => !shownIds.has(id)).length
  }, [shown, selectedIds])

  // One stable actions object for every row; it reads the newest guest data through a ref.
  const dataRef = useRef(data)
  useEffect(() => {
    dataRef.current = data
  })
  const actions = useMemo<GuestRowActions>(
    () => ({
      select(guestId, on) {
        setSelected((prev) => {
          const next = new Set(prev)
          if (on) next.add(guestId)
          else next.delete(guestId)
          return next
        })
      },
      edit(guest, patch) {
        dataRef.current.editGuest(guest.id, patch)
      },
      openPartner: (guest) => setDialog({ kind: 'partner', guestId: guest.id }),
      openGroups: (guest) => setDialog({ kind: 'groups', guestId: guest.id }),
      openDelete: (guest) => setDialog({ kind: 'delete', guestId: guest.id }),
      openEdit: (guest) => setEditId(guest.id),
    }),
    [],
  )

  const selectAll = useCallback(
    (on: boolean) => {
      setSelected((prev) => {
        const next = new Set(prev)
        for (const g of shown) {
          if (on) next.add(g.id)
          else next.delete(g.id)
        }
        return next
      })
    },
    [shown],
  )

  async function exportCsv(anyway: boolean) {
    if (exporting === 'saving') return
    if (!anyway) {
      // An open cell saves on blur; then send what waits instead of after its pause.
      const active = document.activeElement
      if (active instanceof HTMLElement) active.blur()
      const saver = defaultRowSaver()
      if (saver.hasUnsavedChanges()) {
        setExporting('saving')
        await saver.flush()
        if (saver.hasUnsavedChanges()) {
          setExporting('unsaved')
          return
        }
      }
    }
    setExporting('idle')
    const link = document.createElement('a')
    link.href = guestsExportUrl(weddingId)
    link.download = ''
    document.body.append(link)
    link.click()
    link.remove()
  }

  const dialogGuest = dialog && 'guestId' in dialog ? (data.guestById.get(dialog.guestId) ?? null) : null
  const editing = editId ? (data.guestById.get(editId) ?? null) : null
  const closeDialog = () => setDialog(null)

  const total = data.guests.length
  const filtered = query.trim() !== '' || hasFilters(filters)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" data-testid="guest-actions">
        <button type="button" className={secondaryButton} onClick={() => setDialog({ kind: 'paste' })} data-testid="open-paste-names">
          Paste names
        </button>
        <Link href={`/w/${weddingId}/guests/import`} className={secondaryButton} data-testid="open-import">
          Import CSV
        </Link>
        <button type="button" className={secondaryButton} onClick={() => void exportCsv(false)} disabled={exporting === 'saving'} data-testid="export-csv">
          {exporting === 'saving' ? 'Saving changes…' : 'Export CSV'}
        </button>
        <a href={SAMPLE_CSV_URL} download={SAMPLE_CSV_FILE_NAME} className={secondaryButton} data-testid="sample-csv">
          Download sample CSV
        </a>
      </div>

      <AddGuestForm
        weddingId={weddingId}
        onAdded={(guest) => {
          data.addGuests([guest])
          setNotice(`Added ${fullName(guest)}.`)
        }}
      />

      {exporting === 'unsaved' && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" data-testid="export-unsaved">
          <span>Some changes are not saved yet, so the file would leave them out.</span>
          <span className="flex flex-wrap gap-2">
            <button type="button" className={secondaryButton} onClick={() => void exportCsv(false)}>
              Try again
            </button>
            <button type="button" className={secondaryButton} onClick={() => void exportCsv(true)} data-testid="export-anyway">
              Export anyway
            </button>
            <button type="button" className={secondaryButton} onClick={() => setExporting('idle')}>
              Cancel
            </button>
          </span>
        </div>
      )}
      {data.message && (
        <div role="alert" className="flex items-start justify-between gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <span>{data.message}</span>
          <button type="button" className="min-h-11 shrink-0 rounded-lg px-3 font-medium hover:bg-red-100" onClick={data.clearMessage}>
            Dismiss
          </button>
        </div>
      )}
      {notice && (
        <p role="status" className="rounded-lg bg-stone-900 px-3 py-2 text-sm text-white" data-testid="guests-notice">
          {notice}
        </p>
      )}

      <div className="space-y-2">
        <SearchBox value={query} onChange={setQuery} />
        <GuestFilterBar filters={filters} onChange={setFilters} groups={data.groups} meals={meals} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-stone-700" data-testid="guest-count">
          {filtered ? `Showing ${shown.length} of ${plural(total, 'guest')}` : plural(total, 'guest')}
        </p>
        {narrow && (
          <div className="flex items-end gap-2">
            <SelectField<GuestSortKey>
              label="Sort by"
              value={sort.key}
              options={GUEST_SORT_KEYS.map((key) => ({ value: key, label: SORT_LABEL[key] }))}
              onChange={(key) => setSort({ key, direction: 'asc' })}
              testId="sort-by"
            />
            <button
              type="button"
              className={secondaryButton}
              onClick={() => setSort(nextSort(sort, sort.key))}
              aria-label={sort.direction === 'asc' ? 'Sorted A to Z. Sort Z to A' : 'Sorted Z to A. Sort A to Z'}
            >
              {sort.direction === 'asc' ? 'A to Z' : 'Z to A'}
            </button>
          </div>
        )}
      </div>

      {(selectedIds.length > 0 || narrow) && shown.length > 0 && (
        <div
          className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 p-2"
          data-testid="selection-bar"
        >
          {narrow && (
            <CheckField checked={allSelected} onChange={selectAll} label="Select every guest shown">
              All
            </CheckField>
          )}
          <span className="text-sm text-blue-950" aria-live="polite" data-testid="selection-count">
            {selectedIds.length === 0
              ? 'Select guests to add them to a group'
              : hiddenSelected > 0
                ? `${selectedIds.length} selected (${hiddenSelected} not shown)`
                : `${selectedIds.length} selected`}
          </span>
          {hiddenSelected > 0 && (
            <button
              type="button"
              className={secondaryButton}
              onClick={() => setSelected(new Set(selectedIds.filter((id) => shown.some((g) => g.id === id))))}
              data-testid="keep-shown"
            >
              Keep only shown
            </button>
          )}
          {selectedIds.length > 0 && (
            <>
              <button type="button" className={primaryButton} onClick={() => setDialog({ kind: 'add-to-group' })} data-testid="add-to-group">
                Add to group
              </button>
              <button type="button" className={secondaryButton} onClick={() => setSelected(new Set())}>
                Clear
              </button>
            </>
          )}
        </div>
      )}

      {total === 0 ? (
        <p className="rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center text-stone-600" data-testid="guests-empty">
          No guests yet. Add one above, paste a list of names, or import a CSV.
        </p>
      ) : shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-stone-300 bg-white p-6 text-center text-stone-600">No guest matches.</p>
      ) : narrow ? (
        <GuestCards guests={shown} selected={selectedSet} guestById={data.guestById} groupById={data.groupById} seatText={seatText} actions={actions} />
      ) : (
        <GuestTable
          guests={shown}
          sort={sort}
          onSort={(key) => setSort((s) => nextSort(s, key))}
          selected={selectedSet}
          allSelected={allSelected}
          onSelectAll={selectAll}
          guestById={data.guestById}
          groupById={data.groupById}
          seatText={seatText}
          actions={actions}
        />
      )}

      <GuestEditDialog
        guest={editing}
        partner={editing?.partnerId ? data.guestById.get(editing.partnerId) : undefined}
        groupById={data.groupById}
        seats={editing ? (seatText.get(editing.id) ?? '') : ''}
        actions={actions}
        onClose={() => setEditId(null)}
      />
      <PartnerDialog
        guest={dialog?.kind === 'partner' ? dialogGuest : null}
        guests={data.guests}
        onClose={closeDialog}
        onPick={(partnerId) => {
          if (dialogGuest) data.editGuest(dialogGuest.id, partnerPatch(dialogGuest, partnerId, data.guestById))
          closeDialog()
        }}
      />
      <GuestGroupsDialog guest={dialog?.kind === 'groups' ? dialogGuest : null} groups={data.groups} onGroup={data.putGroup} onClose={closeDialog} />
      <DeleteGuestDialog
        guest={dialog?.kind === 'delete' ? dialogGuest : null}
        onClose={closeDialog}
        onDeleted={(guest) => {
          data.removeGuest(guest.id)
          setSeats((s) => ({ ...s, list: s.list.filter((p) => p.guestId !== guest.id) }))
          setSelected((prev) => {
            const next = new Set(prev)
            next.delete(guest.id)
            return next
          })
          setEditId(null)
          setDialog(null)
          setNotice(`Deleted ${fullName(guest)}.`)
        }}
      />
      <AddToGroupDialog
        open={dialog?.kind === 'add-to-group'}
        weddingId={weddingId}
        guestIds={selectedIds}
        hiddenCount={hiddenSelected}
        groups={data.groups}
        onClose={() => setDialog(null)}
        onDone={(group, added) => {
          data.putGroup(group)
          setSelected(new Set())
          setDialog(null)
          setNotice(added === 0 ? `They were all in ${group.name} already.` : `Added ${plural(added, 'guest')} to ${group.name}.`)
        }}
      />
      <PasteNamesDialog
        open={dialog?.kind === 'paste'}
        weddingId={weddingId}
        guests={data.guests}
        onClose={() => setDialog(null)}
        onAdded={(added) => {
          data.addGuests(added)
          setDialog(null)
          setNotice(`Added ${plural(added.length, 'guest')}.`)
        }}
      />
    </div>
  )
}
