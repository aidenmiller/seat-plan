'use client'

/**
 * One guest's groups: a check box per group. Each change goes to the server
 * at once (group members have their own route), and the list shows the
 * server's answer.
 */
import { useState } from 'react'
import { addGroupMembers, errorMessage, removeGroupMember } from '@/client/api'
import { Dialog, DialogActions } from '@/client/ui/Dialog'
import { secondaryButton } from '@/client/ui/styles'
import { compareText, fullName } from '@/domain/guest-list'
import type { Group, Guest } from '@/shared/api'

export function GuestGroupsDialog({
  guest,
  groups,
  onGroup,
  onClose,
}: {
  guest: Guest | null
  groups: readonly Group[]
  /** The server's copy of a group after a change. */
  onGroup(group: Group): void
  onClose(): void
}) {
  return (
    <Dialog open={guest !== null} onClose={onClose} title={guest ? `Groups of ${fullName(guest)}` : 'Groups'} testId="guest-groups-dialog">
      {guest && <GroupChecks guest={guest} groups={groups} onGroup={onGroup} onClose={onClose} />}
    </Dialog>
  )
}

function GroupChecks({
  guest,
  groups,
  onGroup,
  onClose,
}: {
  guest: Guest
  groups: readonly Group[]
  onGroup(group: Group): void
  onClose(): void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const sorted = [...groups].sort((a, b) => compareText(a.name, b.name))

  async function toggle(group: Group, on: boolean) {
    setBusy(group.id)
    setError(null)
    try {
      const next = on ? (await addGroupMembers(group.id, { guestIds: [guest.id] })).group : await removeGroupMember(group.id, guest.id)
      onGroup(next)
    } catch (err) {
      setError(`Could not change ${group.name}. ${errorMessage(err)}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      {sorted.length === 0 ? (
        <p className="text-sm text-stone-600">No groups yet. Make one on the Groups tab, or select guests and use Add to group.</p>
      ) : (
        <ul className="max-h-80 overflow-y-auto overscroll-contain">
          {sorted.map((group) => (
            <li key={group.id}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 text-sm hover:bg-stone-100">
                <input
                  type="checkbox"
                  checked={guest.groupIds.includes(group.id)}
                  disabled={busy !== null}
                  onChange={(e) => void toggle(group, e.target.checked)}
                  className="h-5 w-5 shrink-0 accent-blue-900"
                />
                <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: group.color }} />
                <span className="min-w-0 truncate">{group.name}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <DialogActions>
        <button type="button" className={secondaryButton} onClick={onClose}>
          Done
        </button>
      </DialogActions>
    </div>
  )
}
