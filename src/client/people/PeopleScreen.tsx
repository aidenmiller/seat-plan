'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { changeMemberRole, createWeddingInvite, removeMember, revokeInvite } from '@/client/accounts-api'
import { InviteDialog } from '@/client/accounts/InviteDialog'
import { PendingInvites } from '@/client/accounts/PendingInvites'
import { errorMessage } from '@/client/api'
import { useCurrentUser } from '@/client/current-user'
import { Dialog, DialogActions } from '@/client/ui/Dialog'
import { dangerButton, errorClass, inputClass, primaryButton, secondaryButton } from '@/client/ui/styles'
import { useWeddingAccess } from '@/client/wedding-access'
import { LAST_OWNER_LEAVE_MESSAGE, roleLabel } from '@/domain/account-wording'
import type { InviteSummary, Role, WeddingMember } from '@/shared/accounts-api'

/**
 * The People tab: who can open the wedding. Everyone sees the members and
 * can leave (unless they are its only owner). Owners, and admins, who act as
 * owners, also change roles, remove people, make invite links (each shown
 * once) and cancel the ones nobody has used.
 */
export function PeopleScreen({
  weddingId,
  initialMembers,
  initialInvites,
}: {
  weddingId: string
  initialMembers: WeddingMember[]
  /** Pending invites; empty for an editor, who cannot see them. */
  initialInvites: InviteSummary[]
}) {
  const router = useRouter()
  const me = useCurrentUser()
  const canManage = useWeddingAccess().role === 'owner'
  const [members, setMembers] = useState(initialMembers)
  const [invites, setInvites] = useState(initialInvites)
  const [inviting, setInviting] = useState(false)
  const [removing, setRemoving] = useState<WeddingMember | null>(null)
  const [leaving, setLeaving] = useState(false)

  const mine = members.find((m) => m.userId === me.id)
  const onlyOwner = mine?.role === 'owner' && members.filter((m) => m.role === 'owner').length === 1

  return (
    <div className="space-y-8">
      <section aria-labelledby="members-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 id="members-heading" className="text-base font-semibold">
            Members
          </h3>
          {canManage && (
            <button type="button" className={primaryButton} onClick={() => setInviting(true)}>
              Invite someone
            </button>
          )}
        </div>
        {!canManage && (
          <p className="mt-1 text-sm text-stone-600" data-testid="people-owners-only">
            Only owners can invite people or change who is here.
          </p>
        )}
        <ul className="mt-3 space-y-2" data-testid="member-list">
          {members.map((member) => (
            <li key={member.userId}>
              <MemberRow
                weddingId={weddingId}
                member={member}
                isMe={member.userId === me.id}
                canManage={canManage}
                onChanged={(next) => {
                  setMembers((list) => list.map((m) => (m.userId === next.userId ? next : m)))
                  // Your own role changed: the wedding's screens need to know.
                  if (next.userId === me.id) router.refresh()
                }}
                onRemove={() => setRemoving(member)}
              />
            </li>
          ))}
        </ul>
      </section>

      {canManage && (
        <section aria-labelledby="invites-heading">
          <h3 id="invites-heading" className="text-base font-semibold">
            Invites waiting
          </h3>
          <p className="mb-3 mt-1 text-sm text-stone-600">Links nobody has used yet. Each works once and stops after 7 days.</p>
          <PendingInvites
            invites={invites}
            revoke={revokeInvite}
            onRevoked={(id) => setInvites((list) => list.filter((i) => i.id !== id))}
            empty="No invites waiting."
          />
        </section>
      )}

      {mine && (
        <section aria-labelledby="leave-heading" className="border-t border-stone-200 pt-6">
          <h3 id="leave-heading" className="text-base font-semibold">
            Leave this wedding
          </h3>
          {onlyOwner ? (
            <p className="mt-1 text-sm text-stone-600" data-testid="leave-blocked">
              {LAST_OWNER_LEAVE_MESSAGE}
            </p>
          ) : (
            <p className="mt-1 text-sm text-stone-600">You will no longer be able to open it. An owner can invite you back.</p>
          )}
          <button type="button" className={`${secondaryButton} mt-3 text-red-700 hover:bg-red-50`} onClick={() => setLeaving(true)} disabled={onlyOwner}>
            Leave this wedding
          </button>
        </section>
      )}

      {canManage && (
        <InviteDialog
          open={inviting}
          onClose={() => setInviting(false)}
          title="Invite someone"
          withRole
          create={(fields) => createWeddingInvite(weddingId, { role: fields.role, email: fields.email, note: fields.note })}
          onCreated={(invite) => setInvites((list) => [invite, ...list])}
        />
      )}

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={removing ? `Remove ${removing.displayName}?` : 'Remove'}
        description="They will no longer be able to open this wedding. You can invite them again later."
        action="Remove"
        busyLabel="Removing…"
        onConfirm={async () => {
          if (!removing) return
          await removeMember(weddingId, removing.userId)
          setMembers((list) => list.filter((m) => m.userId !== removing.userId))
          setRemoving(null)
        }}
      />
      <ConfirmDialog
        open={leaving}
        onClose={() => setLeaving(false)}
        title="Leave this wedding?"
        description="You will no longer be able to open it. An owner can invite you back."
        action="Leave"
        busyLabel="Leaving…"
        onConfirm={async () => {
          await removeMember(weddingId, me.id)
          router.replace('/')
          router.refresh()
        }}
      />
    </div>
  )
}

function MemberRow({
  weddingId,
  member,
  isMe,
  canManage,
  onChanged,
  onRemove,
}: {
  weddingId: string
  member: WeddingMember
  isMe: boolean
  canManage: boolean
  onChanged: (member: WeddingMember) => void
  onRemove: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function setRole(role: Role) {
    if (role === member.role) return
    setBusy(true)
    setError(null)
    try {
      onChanged(await changeMemberRole(weddingId, member.userId, { role }))
    } catch (err) {
      setError(`Could not change the role. ${errorMessage(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <article
      className="flex flex-wrap items-center gap-3 rounded-xl border border-stone-200 bg-white p-4"
      data-testid="member"
      data-user-id={member.userId}
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {member.displayName}
          {isMe && <span className="font-normal text-stone-600"> (you)</span>}
        </p>
        <p className="break-words text-sm text-stone-600">{member.email}</p>
        {member.disabled && <p className="text-sm text-amber-800">This account is turned off.</p>}
      </div>
      {canManage ? (
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label={`Role of ${member.displayName}`}
            value={member.role}
            disabled={busy}
            onChange={(e) => void setRole(e.target.value as Role)}
            className={`${inputClass} w-auto`}
            data-testid="member-role"
          >
            <option value="owner">{roleLabel('owner')}</option>
            <option value="editor">{roleLabel('editor')}</option>
          </select>
          {!isMe && (
            <button
              type="button"
              className={`${secondaryButton} text-red-700 hover:bg-red-50`}
              onClick={onRemove}
              disabled={busy}
              aria-label={`Remove ${member.displayName}`}
            >
              Remove
            </button>
          )}
        </div>
      ) : (
        <span className="text-sm font-medium text-stone-700" data-testid="member-role">
          {roleLabel(member.role)}
        </span>
      )}
      {error && (
        <p role="alert" className={`${errorClass} w-full`}>
          {error}
        </p>
      )}
    </article>
  )
}

/** A yes-or-no dialog for removing someone or leaving. Shows what went wrong, and cannot be dismissed while it runs. */
function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  action,
  busyLabel,
  onConfirm,
}: {
  open: boolean
  onClose: () => void
  title: string
  description: string
  action: string
  busyLabel: string
  onConfirm: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const close = () => {
    setError(null)
    onClose()
  }
  async function confirm() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onClose={close} title={title} description={description} size="sm" dismissable={!busy}>
      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}
      <DialogActions>
        <button type="button" className={secondaryButton} onClick={close} disabled={busy}>
          Cancel
        </button>
        <button type="button" className={dangerButton} onClick={() => void confirm()} disabled={busy}>
          {busy ? busyLabel : action}
        </button>
      </DialogActions>
    </Dialog>
  )
}
