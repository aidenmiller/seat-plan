'use client'

import { useState, type FormEvent } from 'react'
import { errorMessage } from '@/client/api'
import { invitePath } from '@/client/one-time-link'
import { Dialog, DialogActions } from '@/client/ui/Dialog'
import { ChoiceGroup, TextField, type Choice } from '@/client/ui/fields'
import { errorClass, primaryButton, secondaryButton } from '@/client/ui/styles'
import { roleHint, roleLabel } from '@/domain/account-wording'
import { INVITE_NOTE_MAX, type CreatedInvite, type InviteSummary, type Role } from '@/shared/accounts-api'
import { OneTimeLink } from './OneTimeLink'

const ROLE_CHOICES: readonly Choice<Role>[] = [
  { value: 'editor', label: roleLabel('editor'), hint: roleHint('editor') },
  { value: 'owner', label: roleLabel('owner'), hint: roleHint('owner') },
]

export type InviteFields = { role: Role; email: string; note: string }

/**
 * Makes an invite link: for a wedding (with a role) or, from the admin page,
 * for a new planner (no role). Optionally locked to one email, with a note
 * only the senders see. Once made, the dialog shows the link, the only time
 * anyone can see it, and forgets it when it closes.
 */
export function InviteDialog({
  open,
  onClose,
  title,
  withRole,
  create,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  title: string
  withRole: boolean
  create: (fields: InviteFields) => Promise<CreatedInvite>
  onCreated: (invite: InviteSummary) => void
}) {
  const [made, setMade] = useState<CreatedInvite | null>(null)
  const close = () => {
    setMade(null)
    onClose()
  }
  return (
    <Dialog open={open} onClose={close} title={made ? 'Invite link' : title} testId="invite-dialog">
      {made ? (
        <>
          <OneTimeLink path={invitePath(made.token)} label="Invite link">
            Send this link yourself; it works once and expires in 7 days. It is shown only now, so copy it before you close this.
          </OneTimeLink>
          <DialogActions>
            <button type="button" className={primaryButton} onClick={close}>
              Done
            </button>
          </DialogActions>
        </>
      ) : (
        <InviteForm
          withRole={withRole}
          onCancel={close}
          onSave={async (fields) => {
            const created = await create(fields)
            onCreated(created.invite)
            setMade(created)
          }}
        />
      )}
    </Dialog>
  )
}

function InviteForm({
  withRole,
  onCancel,
  onSave,
}: {
  withRole: boolean
  onCancel: () => void
  onSave: (fields: InviteFields) => Promise<void>
}) {
  const [role, setRole] = useState<Role>('editor')
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await onSave({ role, email: email.trim(), note: note.trim() })
    } catch (err) {
      setError(`Could not make the invite. ${errorMessage(err)}`)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {withRole && <ChoiceGroup legend="They join as" name="invite-role" value={role} onChange={setRole} choices={ROLE_CHOICES} columns={1} />}
      <TextField
        label="Their email (optional)"
        type="email"
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
        value={email}
        onChange={setEmail}
        hint="Only this email can use the link. Leave it empty for anyone who has the link."
        maxLength={254}
      />
      <TextField
        label="Note (optional)"
        value={note}
        onChange={setNote}
        hint={withRole ? 'Only owners see it, to remember who the link is for.' : 'Only admins see it, to remember who the link is for.'}
        maxLength={INVITE_NOTE_MAX}
      />
      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}
      <DialogActions>
        <button type="button" className={secondaryButton} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className={primaryButton} disabled={busy}>
          {busy ? 'Making the link…' : 'Make invite link'}
        </button>
      </DialogActions>
    </form>
  )
}
