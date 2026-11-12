'use client'

import { useState } from 'react'
import { errorMessage } from '@/client/api'
import { Dialog, DialogActions } from '@/client/ui/Dialog'
import { dangerButton, errorClass, secondaryButton } from '@/client/ui/styles'
import { roleLabel } from '@/domain/account-wording'
import type { InviteSummary } from '@/shared/accounts-api'
import { ExpiresIn } from './ExpiresIn'

/**
 * Invites nobody has used yet, each with a Cancel invite button that asks
 * first. The links themselves are never shown again: only their details.
 */
export function PendingInvites({
  invites,
  revoke,
  onRevoked,
  empty,
}: {
  invites: InviteSummary[]
  revoke: (inviteId: string) => Promise<unknown>
  onRevoked: (inviteId: string) => void
  empty: string
}) {
  const [cancelling, setCancelling] = useState<InviteSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    if (!cancelling || busy) return
    setBusy(true)
    setError(null)
    try {
      await revoke(cancelling.id)
      onRevoked(cancelling.id)
      setCancelling(null)
    } catch (err) {
      setError(`Could not cancel the invite. ${errorMessage(err)}`)
    } finally {
      setBusy(false)
    }
  }

  if (invites.length === 0) {
    return <p className="rounded-xl border border-dashed border-stone-300 bg-white p-4 text-sm text-stone-600">{empty}</p>
  }
  return (
    <>
      <ul className="space-y-2" data-testid="pending-invites">
        {invites.map((invite) => (
          <li
            key={invite.id}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-stone-200 bg-white p-4"
            data-testid="pending-invite"
            data-invite-id={invite.id}
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium">{invite.role ? `${roleLabel(invite.role)} invite` : 'Planner invite'}</p>
              <p className="break-words text-sm text-stone-700">{invite.email ? `For ${invite.email}` : 'For anyone with the link'}</p>
              {invite.note && <p className="break-words text-sm text-stone-600">{invite.note}</p>}
              <p className="text-sm text-stone-600">
                Made by {invite.invitedBy.name} · <ExpiresIn iso={invite.expiresAt} />
              </p>
            </div>
            <button
              type="button"
              className={secondaryButton}
              onClick={() => {
                setError(null)
                setCancelling(invite)
              }}
            >
              Cancel invite
            </button>
          </li>
        ))}
      </ul>
      <Dialog
        open={cancelling !== null}
        onClose={() => setCancelling(null)}
        title="Cancel this invite?"
        description="Its link stops working. You can make a new one later."
        size="sm"
        dismissable={!busy}
      >
        {error && (
          <p role="alert" className={errorClass}>
            {error}
          </p>
        )}
        <DialogActions>
          <button type="button" className={secondaryButton} onClick={() => setCancelling(null)} disabled={busy}>
            Keep it
          </button>
          <button type="button" className={dangerButton} onClick={() => void confirm()} disabled={busy}>
            {busy ? 'Cancelling…' : 'Cancel invite'}
          </button>
        </DialogActions>
      </Dialog>
    </>
  )
}
