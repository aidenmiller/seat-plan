'use client'

import Link from 'next/link'
import { useState, type FormEvent } from 'react'
import { errorMessage, updateShareLink } from '@/client/api'
import { Switch } from '@/client/editor/panels/controls'
import { Dialog, DialogActions } from '@/client/ui/Dialog'
import { TextField } from '@/client/ui/fields'
import { RelativeTime } from '@/client/ui/RelativeTime'
import { dangerButton, errorClass, primaryButton, secondaryButton } from '@/client/ui/styles'
import { useCanManageWedding } from '@/client/wedding-access'
import { SHARE_PASSWORD_MIN, type ShareLink, type UpdateShareLinkBody } from '@/shared/api'
import { CopyLinkButton, LinkBox } from './CopyLink'

/**
 * The Links tab (PLAN change 25): every share link that is on, with its
 * layout and when it was last opened. Each can get a new password, show or
 * hide names and notes, or be turned off. A new password or turning a link
 * off signs out everyone using it.
 */
export function LinksScreen({ weddingId, initial }: { weddingId: string; initial: ShareLink[] }) {
  const [links, setLinks] = useState(initial)
  const canManage = useCanManageWedding()
  /** Editors see the links but cannot make or change them. */
  const ownersOnly = !canManage && (
    <p className="mb-4 text-sm text-stone-600" data-testid="links-owners-only">
      Only owners can make or change share links.
    </p>
  )
  if (links.length === 0) {
    return (
      <>
        {ownersOnly}
        <p className="rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center text-stone-600">
          {canManage ? 'No share links yet. Open a layout and press Share to make one.' : 'No share links yet.'}
        </p>
      </>
    )
  }
  return (
    <>
      {ownersOnly}
      <ul className="space-y-4" data-testid="share-links">
        {links.map((link) => (
          <li key={link.id}>
            <LinkCard
              weddingId={weddingId}
              link={link}
              canManage={canManage}
              onChange={(next) => setLinks((list) => (next.enabled ? list.map((l) => (l.id === next.id ? next : l)) : list.filter((l) => l.id !== next.id)))}
            />
          </li>
        ))}
      </ul>
    </>
  )
}

function LinkCard({
  weddingId,
  link,
  canManage,
  onChange,
}: {
  weddingId: string
  link: ShareLink
  canManage: boolean
  onChange: (link: ShareLink) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'password' | 'off' | null>(null)

  /** Saves the change. Returns null, or what went wrong (also shown on the card). */
  async function change(body: UpdateShareLinkBody): Promise<string | null> {
    setBusy(true)
    setError(null)
    try {
      onChange(await updateShareLink(link.id, body))
      return null
    } catch (err) {
      const message = `Could not save. ${errorMessage(err)}`
      setError(message)
      return message
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm" data-testid="share-link" data-link-id={link.id}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="min-w-0 text-base font-semibold">{link.label || 'Share link'}</h3>
        <p className="text-sm text-stone-600">
          {link.lastOpenedAt ? (
            <>
              Last opened <RelativeTime iso={link.lastOpenedAt} />
            </>
          ) : (
            'Not opened yet'
          )}
        </p>
      </div>
      <p className="mt-1 text-sm text-stone-700">
        Layout:{' '}
        <Link href={`/w/${weddingId}/layouts/${link.layoutId}`} className="font-medium text-blue-900 underline">
          {link.layoutName}
        </Link>
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <LinkBox path={link.path} />
        </div>
        <CopyLinkButton path={link.path} />
      </div>
      <div className="mt-3 max-w-sm">
        <Switch label="Show guest names" hint="Off shows table names only" checked={link.showNames} disabled={busy || !canManage} onChange={(v) => void change({ showNames: v })} />
        <Switch label="Show notes" checked={link.showNotes} disabled={busy || !canManage} onChange={(v) => void change({ showNotes: v })} />
      </div>
      {error && (
        <p role="alert" className={`${errorClass} mt-2`}>
          {error}
        </p>
      )}
      {canManage && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={secondaryButton} onClick={() => setDialog('password')} disabled={busy}>
            Change password
          </button>
          <button type="button" className={secondaryButton} onClick={() => setDialog('off')} disabled={busy}>
            Turn off
          </button>
        </div>
      )}

      <Dialog open={dialog === 'password'} onClose={() => setDialog(null)} title="Change link password">
        {dialog === 'password' && (
          <PasswordForm
            onCancel={() => setDialog(null)}
            onSave={async (password) => {
              const failed = await change({ password })
              if (!failed) setDialog(null)
              return failed
            }}
          />
        )}
      </Dialog>
      <Dialog
        open={dialog === 'off'}
        onClose={() => setDialog(null)}
        title="Turn off this link?"
        description="It stops working, and anyone using it is signed out. Make a new link to share the layout again."
        size="sm"
      >
        <DialogActions>
          <button type="button" className={secondaryButton} onClick={() => setDialog(null)}>
            Cancel
          </button>
          <button
            type="button"
            className={dangerButton}
            disabled={busy}
            onClick={async () => {
              await change({ enabled: false })
              setDialog(null)
            }}
          >
            Turn off
          </button>
        </DialogActions>
      </Dialog>
    </article>
  )
}

function PasswordForm({ onCancel, onSave }: { onCancel: () => void; onSave: (password: string) => Promise<string | null> }) {
  const [password, setPassword] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (password.length < SHARE_PASSWORD_MIN) {
      setFieldError(`Use at least ${SHARE_PASSWORD_MIN} characters.`)
      return
    }
    setBusy(true)
    setError(await onSave(password))
    setBusy(false)
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <p className="text-sm text-stone-700">Anyone using the link is signed out and needs the new password.</p>
      <TextField
        label="New password"
        type="password"
        value={password}
        onChange={(v) => {
          setPassword(v)
          setFieldError(null)
        }}
        error={fieldError}
        autoComplete="new-password"
        maxLength={200}
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
          {busy ? 'Saving…' : 'Save password'}
        </button>
      </DialogActions>
    </form>
  )
}
