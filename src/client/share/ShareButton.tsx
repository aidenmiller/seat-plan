'use client'

import { useState, type FormEvent } from 'react'
import { createShareLink, errorMessage } from '@/client/api'
import { Switch } from '@/client/editor/panels/controls'
import { randomId } from '@/client/sync/random-id'
import { Dialog, DialogActions } from '@/client/ui/Dialog'
import { TextField } from '@/client/ui/fields'
import { BrandIcon } from '@/client/ui/icons/brand'
import { errorClass, hintClass, primaryButton, secondaryButton } from '@/client/ui/styles'
import { SHARE_PASSWORD_MIN, type ShareLink } from '@/shared/api'
import { CopyLinkButton, LinkBox } from './CopyLink'

/**
 * The editor's Share button (spec section 2): makes a view-only link to this
 * layout for the venue, with its own password, then shows its address to copy.
 * Links are listed and changed in the wedding's Links tab.
 */
export function ShareButton({ layoutId, compact }: { layoutId: string; compact: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Share"
        className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-lg px-2 text-sm font-medium text-stone-700 hover:bg-stone-100"
        data-testid="share-button"
      >
        <BrandIcon name="share-link" />
        {!compact && <span>Share</span>}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Share this layout" testId="share-dialog">
        {open && <ShareForm layoutId={layoutId} onClose={() => setOpen(false)} />}
      </Dialog>
    </>
  )
}

function ShareForm({ layoutId, onClose }: { layoutId: string; onClose: () => void }) {
  const [label, setLabel] = useState('')
  const [password, setPassword] = useState('')
  const [showNames, setShowNames] = useState(true)
  const [showNotes, setShowNotes] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [made, setMade] = useState<ShareLink | null>(null)
  /** One id per form, so a second press after a lost reply gives back the same link. */
  const [id] = useState(randomId)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (password.length < SHARE_PASSWORD_MIN) {
      setPasswordError(`Use at least ${SHARE_PASSWORD_MIN} characters.`)
      return
    }
    setBusy(true)
    setError(null)
    try {
      setMade(await createShareLink(layoutId, { id, label: label.trim(), password, showNames, showNotes }))
    } catch (err) {
      setError(`Could not make the link. ${errorMessage(err)}`)
    }
    setBusy(false)
  }

  if (made) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-stone-700">
          Send this link and its password separately. It opens only this layout, view only.
        </p>
        <LinkBox path={made.path} />
        <CopyLinkButton path={made.path} testId="share-copy" />
        <p className={hintClass}>Change its password or turn it off in the wedding’s Links tab.</p>
        <DialogActions>
          <button type="button" className={primaryButton} onClick={onClose}>
            Done
          </button>
        </DialogActions>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <p className="text-sm text-stone-700">
        A view-only link for the venue, caterer or DJ. It has its own password and shows this layout only.
      </p>
      <TextField label="Who is it for (optional)" value={label} onChange={setLabel} placeholder="Caterer" maxLength={100} autoComplete="off" />
      <TextField
        label="Link password"
        type="password"
        value={password}
        onChange={(v) => {
          setPassword(v)
          setPasswordError(null)
        }}
        error={passwordError}
        hint={`At least ${SHARE_PASSWORD_MIN} characters. Not your own password.`}
        autoComplete="new-password"
        maxLength={200}
      />
      <Switch label="Show guest names" hint="Off shows table names only" checked={showNames} onChange={setShowNames} testId="share-names" />
      <Switch label="Show notes" hint="Notes on the plan may be private" checked={showNotes} onChange={setShowNotes} testId="share-notes" />
      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}
      <DialogActions>
        <button type="button" className={secondaryButton} onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className={primaryButton} disabled={busy}>
          {busy ? 'Making link…' : 'Make link'}
        </button>
      </DialogActions>
    </form>
  )
}
