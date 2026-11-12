'use client'

/**
 * Add the selected guests to a group at once (spec section 6): pick an
 * existing group, or name a new one, which is made with them in it.
 */
import { useId, useState } from 'react'
import { addGroupMembers, createGroup, errorMessage } from '@/client/api'
import { randomId } from '@/client/sync/random-id'
import { Dialog, DialogActions } from '@/client/ui/Dialog'
import { errorClass, inputClass, primaryButton, secondaryButton } from '@/client/ui/styles'
import { compareText } from '@/domain/guest-list'
import { plural } from '@/domain/wording'
import { GROUP_NAME_SEMICOLON, type Group } from '@/shared/api'

const NEW = '__new__'

export function AddToGroupDialog({
  open,
  weddingId,
  guestIds,
  hiddenCount = 0,
  groups,
  onDone,
  onClose,
}: {
  open: boolean
  weddingId: string
  guestIds: readonly string[]
  /** Of guestIds, how many the search and filters hide, so the dialog can say so. */
  hiddenCount?: number
  groups: readonly Group[]
  /** The group as the server has it now, and how many guests were added. */
  onDone(group: Group, added: number): void
  onClose(): void
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add to group"
      description={
        hiddenCount > 0
          ? `${plural(guestIds.length, 'guest')} selected, ${hiddenCount} of them not shown by the search or filters.`
          : `${plural(guestIds.length, 'guest')} selected.`
      }
      testId="add-to-group-dialog"
    >
      {open && <AddToGroupForm weddingId={weddingId} guestIds={guestIds} groups={groups} onDone={onDone} onClose={onClose} />}
    </Dialog>
  )
}

function AddToGroupForm({
  weddingId,
  guestIds,
  groups,
  onDone,
  onClose,
}: {
  weddingId: string
  guestIds: readonly string[]
  groups: readonly Group[]
  onDone(group: Group, added: number): void
  onClose(): void
}) {
  const sorted = [...groups].sort((a, b) => compareText(a.name, b.name))
  const [choice, setChoice] = useState<string>(sorted[0]?.id ?? NEW)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameId = useId()
  // One id per form, so a retried create gives the same group back.
  const [newId] = useState(randomId)

  async function submit() {
    if (busy) return
    setError(null)
    if (choice === NEW && name.trim() === '') {
      setError('Name the new group.')
      return
    }
    if (choice === NEW && name.includes(';')) {
      setError(GROUP_NAME_SEMICOLON)
      return
    }
    setBusy(true)
    try {
      if (choice === NEW) {
        const group = await createGroup(weddingId, { id: newId, name: name.trim(), guestIds: [...guestIds] })
        onDone(group, guestIds.length)
      } else {
        const reply = await addGroupMembers(choice, { guestIds: [...guestIds] })
        onDone(reply.group, reply.added.length)
      }
    } catch (err) {
      setError(`Could not add them. ${errorMessage(err)}`)
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
    >
      <fieldset>
        <legend className="sr-only">Group</legend>
        <ul className="max-h-72 overflow-y-auto overscroll-contain">
          {sorted.map((group) => (
            <li key={group.id}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 text-sm hover:bg-stone-100">
                <input
                  type="radio"
                  name="group"
                  value={group.id}
                  checked={choice === group.id}
                  onChange={() => setChoice(group.id)}
                  className="h-4 w-4 shrink-0 accent-blue-900"
                />
                <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: group.color }} />
                <span className="min-w-0 truncate">{group.name}</span>
                <span className="ml-auto shrink-0 text-xs text-stone-500">{plural(group.memberIds.length, 'guest')}</span>
              </label>
            </li>
          ))}
          <li>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 text-sm hover:bg-stone-100">
              <input
                type="radio"
                name="group"
                value={NEW}
                checked={choice === NEW}
                onChange={() => setChoice(NEW)}
                className="h-4 w-4 shrink-0 accent-blue-900"
              />
              <span className="font-medium">New group</span>
            </label>
          </li>
        </ul>
      </fieldset>
      {choice === NEW && (
        <div className="mt-2">
          <label htmlFor={nameId} className="block text-sm font-medium text-stone-700">
            New group name
          </label>
          <input
            id={nameId}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            autoComplete="off"
            placeholder="e.g. College friends"
            className={`${inputClass} mt-1`}
            data-testid="new-group-name"
          />
        </div>
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
        <button type="submit" className={primaryButton} disabled={busy}>
          {busy ? 'Adding…' : 'Add to group'}
        </button>
      </DialogActions>
    </form>
  )
}
