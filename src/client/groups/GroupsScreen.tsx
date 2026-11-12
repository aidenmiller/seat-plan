'use client'

/**
 * The Groups page (spec section 7, "Groups"; basic for milestone 4): each
 * group with its color and member count; make one, rename it in place,
 * recolor it from the fixed palette, or delete it outright (DECISIONS 31)
 * after a confirm. Open a group to see its members, take one out, or find
 * guests by name and add them. Renames and colors save through the row
 * queue; the rest go straight to the server.
 */
import { useId, useMemo, useState } from 'react'
import { addGroupMembers, createGroup, deleteGroup, errorMessage, removeGroupMember } from '@/client/api'
import { EditableText } from '@/client/guests/cells'
import { useGuestData, type GuestData } from '@/client/guests/use-guest-data'
import { randomId } from '@/client/sync/random-id'
import { Dialog, DialogActions } from '@/client/ui/Dialog'
import { dangerButton, errorClass, inputClass, primaryButton, secondaryButton } from '@/client/ui/styles'
import { GROUP_COLOR_NAMES, GROUP_COLORS } from '@/domain/group-colors'
import { compareByName, compareText, filterGuests, fullName } from '@/domain/guest-list'
import { plural } from '@/domain/wording'
import { GROUP_NAME_SEMICOLON, type Group, type Guest } from '@/shared/api'

export function GroupsScreen({ weddingId, guests, groups }: { weddingId: string; guests: Guest[]; groups: Group[] }) {
  const data = useGuestData(weddingId, guests, groups)
  const [openId, setOpenId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Group | null>(null)
  const sorted = useMemo(() => [...data.groups].sort((a, b) => compareText(a.name, b.name)), [data.groups])

  return (
    <div className="space-y-4">
      <NewGroupForm weddingId={weddingId} onCreated={(group) => data.putGroup(group)} />
      {data.message && (
        <div role="alert" className="flex items-start justify-between gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <span>{data.message}</span>
          <button type="button" className="min-h-11 shrink-0 rounded-lg px-3 font-medium hover:bg-red-100" onClick={data.clearMessage}>
            Dismiss
          </button>
        </div>
      )}
      {sorted.length === 0 ? (
        <p className="rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center text-stone-600" data-testid="groups-empty">
          No groups yet. Make one above, or select guests on the Guests tab and use Add to group.
        </p>
      ) : (
        <ul className="space-y-2" data-testid="group-list">
          {sorted.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              data={data}
              open={openId === group.id}
              onToggle={() => setOpenId((id) => (id === group.id ? null : group.id))}
              onDelete={() => setDeleting(group)}
            />
          ))}
        </ul>
      )}
      <DeleteGroupDialog
        group={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={(group) => {
          data.removeGroup(group.id)
          setDeleting(null)
        }}
      />
    </div>
  )
}

function NewGroupForm({ weddingId, onCreated }: { weddingId: string; onCreated(group: Group): void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [id, setId] = useState(randomId)
  const inputId = useId()

  async function submit() {
    if (busy) return
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Name the group.')
      return
    }
    if (trimmed.includes(';')) {
      setError(GROUP_NAME_SEMICOLON)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const group = await createGroup(weddingId, { id, name: trimmed })
      onCreated(group)
      setName('')
      setId(randomId())
    } catch (err) {
      setError(`Could not make the group. ${errorMessage(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
      noValidate
      className="rounded-xl border border-stone-200 bg-white p-3"
      data-testid="new-group-form"
    >
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 basis-48">
          <label htmlFor={inputId} className="block text-sm font-medium text-stone-700">
            New group
          </label>
          <input
            id={inputId}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            placeholder="e.g. College friends"
            autoComplete="off"
            className={`${inputClass} mt-1`}
            data-testid="new-group-input"
          />
        </div>
        <button type="submit" className={`${primaryButton} w-full sm:w-auto`} disabled={busy}>
          {busy ? 'Adding…' : 'Add group'}
        </button>
      </div>
      {error && (
        <p role="alert" className={`${errorClass} mt-2`}>
          {error}
        </p>
      )}
    </form>
  )
}

function GroupCard({
  group,
  data,
  open,
  onToggle,
  onDelete,
}: {
  group: Group
  data: GuestData
  open: boolean
  onToggle(): void
  onDelete(): void
}) {
  const [palette, setPalette] = useState(false)
  const membersId = useId()
  const members = group.memberIds.map((id) => data.guestById.get(id)).filter((g): g is Guest => g !== undefined)
  return (
    <li className="rounded-xl border border-stone-200 bg-white p-2" data-testid="group-card" data-group-id={group.id}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setPalette((p) => !p)}
          aria-expanded={palette}
          aria-label={`Color of ${group.name}`}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-stone-100"
          data-testid="group-color"
        >
          <span aria-hidden="true" className="h-6 w-6 rounded-full border border-black/10" style={{ backgroundColor: group.color }} />
        </button>
        <div className="min-w-0 flex-1 basis-40">
          <EditableText
            value={group.name}
            label="Group name"
            required
            maxLength={100}
            onSave={(name) => name && data.editGroup(group.id, { name })}
            testId="group-name"
          />
        </div>
        <span className="text-sm text-stone-600" data-testid="group-count">
          {plural(members.length, 'guest')}
        </span>
        <div className="flex gap-1">
          <button type="button" className={secondaryButton} onClick={onToggle} aria-expanded={open} aria-controls={membersId}>
            {open ? 'Close' : 'Open'}
          </button>
          <button type="button" className={`${secondaryButton} text-red-700 hover:bg-red-50`} onClick={onDelete} aria-label={`Delete ${group.name}`}>
            Delete
          </button>
        </div>
      </div>
      {palette && (
        <fieldset className="mt-2 px-1">
          <legend className="sr-only">Color of {group.name}</legend>
          <div className="flex flex-wrap gap-1">
            {GROUP_COLORS.map((color, i) => (
              <label key={color} className="relative inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg hover:bg-stone-100">
                <input
                  type="radio"
                  name={`color-${group.id}`}
                  value={color}
                  checked={group.color.toUpperCase() === color}
                  onChange={() => {
                    data.editGroup(group.id, { color })
                    setPalette(false)
                  }}
                  className="peer sr-only"
                />
                <span className="sr-only">{GROUP_COLOR_NAMES[i]}</span>
                <span
                  aria-hidden="true"
                  className="h-7 w-7 rounded-full border border-black/10 peer-checked:ring-2 peer-checked:ring-stone-900 peer-checked:ring-offset-2 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-700"
                  style={{ backgroundColor: color }}
                />
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {open && (
        <div id={membersId} className="mt-2 border-t border-stone-100 px-1 pt-2">
          <Members group={group} members={members} data={data} />
        </div>
      )}
    </li>
  )
}

function Members({ group, members, data }: { group: Group; members: Guest[]; data: GuestData }) {
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const searchId = useId()
  const sorted = [...members].sort(compareByName)
  const memberSet = new Set(group.memberIds)
  const matches = query.trim() ? filterGuests(data.guests.filter((g) => !memberSet.has(g.id)), query).sort(compareByName).slice(0, 20) : []

  async function run(guestId: string, add: boolean) {
    setBusy(guestId)
    setError(null)
    try {
      const next = add ? (await addGroupMembers(group.id, { guestIds: [guestId] })).group : await removeGroupMember(group.id, guestId)
      data.putGroup(next)
    } catch (err) {
      setError(`Could not change the group. ${errorMessage(err)}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-3">
      {sorted.length === 0 ? (
        <p className="text-sm text-stone-600">No one in this group yet.</p>
      ) : (
        <ul className="divide-y divide-stone-100" data-testid="group-members">
          {sorted.map((g) => (
            <li key={g.id} className="flex items-center justify-between gap-2 py-1" data-guest-id={g.id}>
              <span className="min-w-0 truncate text-sm">
                {fullName(g)}
                {g.nickname && <span className="text-stone-500"> ({g.nickname})</span>}
              </span>
              <button
                type="button"
                className="min-h-11 shrink-0 rounded-lg px-3 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-50"
                onClick={() => void run(g.id, false)}
                disabled={busy !== null}
                aria-label={`Take ${fullName(g)} out of ${group.name}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div>
        <label htmlFor={searchId} className="block text-sm font-medium text-stone-700">
          Add members
        </label>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or nickname"
          autoComplete="off"
          className={`${inputClass} mt-1`}
          data-testid="group-member-search"
        />
        {query.trim() !== '' && (
          <ul className="mt-1 divide-y divide-stone-100" data-testid="group-member-matches">
            {matches.length === 0 && <li className="py-2 text-sm text-stone-600">No guest matches who is not in the group.</li>}
            {matches.map((g) => (
              <li key={g.id} className="flex items-center justify-between gap-2 py-1">
                <span className="min-w-0 truncate text-sm">{fullName(g)}</span>
                <button
                  type="button"
                  className="min-h-11 shrink-0 rounded-lg px-3 text-sm font-medium text-blue-900 hover:bg-blue-50 disabled:opacity-50"
                  onClick={() => void run(g.id, true)}
                  disabled={busy !== null}
                  aria-label={`Add ${fullName(g)} to ${group.name}`}
                >
                  Add
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}
    </div>
  )
}

function DeleteGroupDialog({ group, onClose, onDeleted }: { group: Group | null; onClose(): void; onDeleted(group: Group): void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    if (!group || busy) return
    setBusy(true)
    setError(null)
    try {
      await deleteGroup(group.id)
      setBusy(false)
      onDeleted(group)
    } catch (err) {
      setError(`Could not delete. ${errorMessage(err)}`)
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={group !== null}
      onClose={() => {
        setError(null)
        onClose()
      }}
      title={group ? `Delete ${group.name}` : 'Delete group'}
      size="sm"
      dismissable={!busy}
      testId="delete-group-dialog"
    >
      {group && (
        <div>
          <p className="text-sm text-stone-800">
            The group goes for good. Its {plural(group.memberIds.length, 'guest')} {group.memberIds.length === 1 ? 'stays' : 'stay'} on the guest list.
          </p>
          {error && (
            <p role="alert" className={`${errorClass} mt-3`}>
              {error}
            </p>
          )}
          <DialogActions>
            <button type="button" className={secondaryButton} onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className={dangerButton} onClick={() => void confirm()} disabled={busy} data-testid="delete-group-confirm">
              {busy ? 'Deleting…' : 'Delete group'}
            </button>
          </DialogActions>
        </div>
      )}
    </Dialog>
  )
}
