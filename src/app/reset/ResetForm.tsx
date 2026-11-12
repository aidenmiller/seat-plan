'use client'

import Link from 'next/link'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { completeReset, lookupReset } from '@/client/accounts-api'
import { refusalOf, useLinkToken } from '@/client/accounts/link-token'
import { errorMessage } from '@/client/api'
import { TextField } from '@/client/ui/fields'
import { errorClass, primaryButton } from '@/client/ui/styles'
import { resetProblemMessage, tooManyTriesMessage } from '@/domain/account-wording'
import { PASSWORD_MAX, PASSWORD_MIN } from '@/domain/accounts'
import type { ResetLookup } from '@/shared/accounts-api'

export type OpenReset = Extract<ResetLookup, { status: 'ok' }>

type Phase =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'unknown' }
  | { kind: 'unusable'; problem: 'used' | 'expired' }
  | { kind: 'failed'; message: string }
  | { kind: 'ready'; reset: OpenReset }
  | { kind: 'done' }

function failureMessage(err: unknown): string {
  const refusal = refusalOf(err)
  if (refusal?.status === 429) return tooManyTriesMessage(refusal.retryAfterSeconds)
  return errorMessage(err)
}

/** What a failed request means for the page as a whole, or null when the form should say it. */
function phaseOf(err: unknown): Phase | null {
  const refusal = refusalOf(err)
  if (refusal?.status === 404) return { kind: 'unknown' }
  if (refusal?.status === 409 && (refusal.reason === 'used' || refusal.reason === 'expired')) return { kind: 'unusable', problem: refusal.reason }
  return null
}

/**
 * The reset page (/reset#<token>): reads the token from the #fragment, says
 * whose account it is for, and sets a new password. Afterwards it points to
 * the sign-in page: setting the password signs out every device, this one
 * included, and signs nobody in. The token goes to the server only inside a
 * JSON body.
 */
export function ResetForm() {
  const token = useLinkToken()
  const [looked, setLooked] = useState<{ token: string; phase: Phase } | null>(null)
  const [override, setOverride] = useState<Phase | null>(null)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    lookupReset(token)
      .then((reset) => {
        if (cancelled) return
        setLooked({ token, phase: reset.status === 'ok' ? { kind: 'ready', reset } : { kind: 'unusable', problem: reset.status } })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setLooked({ token, phase: phaseOf(err) ?? { kind: 'failed', message: failureMessage(err) } })
      })
    return () => {
      cancelled = true
    }
  }, [token])

  const phase: Phase =
    override ??
    (token === undefined
      ? { kind: 'loading' }
      : token === null
        ? { kind: 'missing' }
        : looked?.token === token
          ? looked.phase
          : { kind: 'loading' })

  return (
    <ResetView
      phase={phase}
      onSubmit={async (password) => {
        if (!token) return null
        try {
          await completeReset(token, password)
          // The link is used up: take it out of the address bar and the history.
          window.history.replaceState(null, '', '/reset')
          setOverride({ kind: 'done' })
          return null
        } catch (err) {
          const next = phaseOf(err)
          if (next) {
            setOverride(next)
            return null
          }
          return failureMessage(err)
        }
      }}
    />
  )
}

/** The page for one phase. `onSubmit` returns what went wrong, or null. */
export function ResetView({ phase, onSubmit }: { phase: Phase; onSubmit: (password: string) => Promise<string | null> }) {
  switch (phase.kind) {
    case 'loading':
      return (
        <p role="status" className="text-stone-600">
          Opening your reset link…
        </p>
      )
    case 'missing':
      return <Notice title="This reset link is not complete">Check that you copied the whole link, or ask an admin for a new one.</Notice>
    case 'unknown':
      return <Notice title="This reset link does not work">Check that you copied the whole link, or ask an admin for a new one.</Notice>
    case 'unusable':
      return <Notice title="This reset link cannot be used">{resetProblemMessage(phase.problem)}</Notice>
    case 'failed':
      return <Notice title="Could not open this reset link">{phase.message}</Notice>
    case 'done':
      return (
        <div data-testid="reset-done">
          <h1 className="text-2xl font-semibold tracking-tight">Your password is set</h1>
          <p className="mt-2 text-stone-700">Every device that was signed in to this account is signed out. Sign in with your new password.</p>
          <Link href="/login" className={`${primaryButton} mt-6 w-full`}>
            Sign in
          </Link>
        </div>
      )
    case 'ready':
      return <NewPasswordForm reset={phase.reset} onSubmit={onSubmit} />
  }
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div data-testid="reset-notice">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-stone-700">{children}</p>
    </div>
  )
}

function NewPasswordForm({ reset, onSubmit }: { reset: OpenReset; onSubmit: (password: string) => Promise<string | null> }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (password.length < PASSWORD_MIN) return setError(`Use at least ${PASSWORD_MIN} characters for your password.`)
    if (password.length > PASSWORD_MAX) return setError(`Use at most ${PASSWORD_MAX} characters for your password.`)
    if (password !== confirm) return setError('The two passwords are not the same.')
    setBusy(true)
    setError(null)
    const problem = await onSubmit(password)
    if (problem) setError(problem)
    setBusy(false)
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4" data-testid="reset-form">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Set a new password</h1>
        <p className="mt-1 text-sm text-stone-600">
          For {reset.displayName} ({reset.email}). Every device signed in to this account will be signed out.
        </p>
      </div>
      {/* Lets a password manager save the new password under the right account. */}
      <input type="email" name="email" autoComplete="username" value={reset.email} readOnly hidden />
      <TextField
        label="New password"
        name="new-password"
        type="password"
        autoComplete="new-password"
        autoFocus
        required
        value={password}
        onChange={setPassword}
        hint={`At least ${PASSWORD_MIN} characters.`}
      />
      <TextField
        label="Confirm new password"
        name="confirm-password"
        type="password"
        autoComplete="new-password"
        required
        value={confirm}
        onChange={setConfirm}
      />
      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}
      <button type="submit" disabled={busy} className={`${primaryButton} w-full`}>
        {busy ? 'Setting your password…' : 'Set password'}
      </button>
    </form>
  )
}
