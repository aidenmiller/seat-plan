'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { acceptInvite, lookupInvite, registerWithInvite, signIn, signOut } from '@/client/accounts-api'
import { refusalOf, useLinkToken } from '@/client/accounts/link-token'
import { errorMessage } from '@/client/api'
import { afterInvitePath } from '@/client/one-time-link'
import { TextField } from '@/client/ui/fields'
import { errorClass, primaryButton, quietButton, secondaryButton } from '@/client/ui/styles'
import { inviteProblemMessage, roleHint, tooManyTriesMessage } from '@/domain/account-wording'
import { PASSWORD_MAX, PASSWORD_MIN, normalizeEmail } from '@/domain/accounts'
import type { InviteLookup, InviteProblem } from '@/shared/accounts-api'

export type OpenInvite = Extract<InviteLookup, { status: 'ok' }>
export type SignedIn = { displayName: string; email: string } | null

type Phase =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'unknown' }
  | { kind: 'unusable'; problem: InviteProblem }
  | { kind: 'failed'; message: string }
  | { kind: 'ready'; invite: OpenInvite }

/** What a failed lookup, sign-up or accept means for the page as a whole, or null when the form should say it. */
function phaseOf(err: unknown): Phase | null {
  const refusal = refusalOf(err)
  if (refusal?.status === 404) return { kind: 'unknown' }
  if (refusal?.status === 409 && refusal.error === 'invite_unusable' && refusal.reason) {
    return { kind: 'unusable', problem: refusal.reason as InviteProblem }
  }
  return null
}

function failureMessage(err: unknown): string {
  const refusal = refusalOf(err)
  if (refusal?.status === 429) return tooManyTriesMessage(refusal.retryAfterSeconds)
  return errorMessage(err)
}

/**
 * The invite page (/invite#<token>). Reads the token from the #fragment,
 * looks the invite up, and then shows who invited you to what, with either a
 * form to make an account or, for someone signed in, an Accept button. The
 * token only ever goes to the server inside a JSON body, and the page only
 * ever leaves for the wedding (or home): never for an address holding it.
 */
export function InviteScreen({ signedIn }: { signedIn: SignedIn }) {
  const token = useLinkToken()
  const [looked, setLooked] = useState<{ token: string; phase: Phase } | null>(null)
  const [override, setOverride] = useState<Phase | null>(null)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    lookupInvite(token)
      .then((invite) => {
        if (cancelled) return
        setLooked({ token, phase: invite.status === 'ok' ? { kind: 'ready', invite } : { kind: 'unusable', problem: invite.status } })
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

  return <InviteView phase={phase} token={token ?? null} signedIn={signedIn} onPhase={setOverride} />
}

/** The page for one phase. Separate from the requests, so each state can be checked on its own. */
export function InviteView({
  phase,
  token,
  signedIn,
  onPhase,
}: {
  phase: Phase
  token: string | null
  signedIn: SignedIn
  onPhase: (phase: Phase) => void
}) {
  switch (phase.kind) {
    case 'loading':
      return (
        <p role="status" className="text-stone-600">
          Opening your invite…
        </p>
      )
    case 'missing':
      return (
        <Notice title="This invite link is not complete">
          Check that you copied the whole link, or ask the person who sent it for a new one.
        </Notice>
      )
    case 'unknown':
      return (
        <Notice title="This invite link does not work">
          Check that you copied the whole link, or ask the person who sent it for a new one.
        </Notice>
      )
    case 'unusable':
      return (
        <Notice title="This invite cannot be used">
          {inviteProblemMessage(phase.problem)}
          {phase.problem === 'used' && !signedIn && (
            <span className="mt-4 block">
              <Link href="/login" className={primaryButton}>
                Sign in
              </Link>
            </span>
          )}
        </Notice>
      )
    case 'failed':
      return <Notice title="Could not open this invite">{phase.message}</Notice>
    case 'ready':
      return token ? <ReadyInvite invite={phase.invite} token={token} signedIn={signedIn} onPhase={onPhase} /> : null
  }
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div data-testid="invite-notice">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-stone-700">{children}</p>
    </div>
  )
}

/** Who invited you to what. */
export function InviteIntro({ invite }: { invite: OpenInvite }) {
  if (invite.kind === 'planner') {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">Make your account</h1>
        <p className="mt-2 text-stone-700" data-testid="invite-intro">
          {invite.inviterName} invited you to plan weddings with Something Blueprint.
        </p>
      </>
    )
  }
  const role = invite.role ?? 'editor'
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Join {invite.weddingName ?? 'a wedding'}</h1>
      <p className="mt-2 text-stone-700" data-testid="invite-intro">
        {invite.inviterName} invited you to {invite.weddingName ?? 'a wedding'} as {role === 'owner' ? 'an owner' : 'an editor'}.
      </p>
      <p className="mt-1 text-sm text-stone-600">{roleHint(role)}.</p>
    </>
  )
}

export function ReadyInvite({
  invite,
  token,
  signedIn,
  onPhase,
}: {
  invite: OpenInvite
  token: string
  signedIn: SignedIn
  onPhase: (phase: Phase) => void
}) {
  const [mode, setMode] = useState<'register' | 'sign-in'>('register')
  return (
    <div>
      <InviteIntro invite={invite} />
      {signedIn ? (
        <SignedInAccept invite={invite} token={token} signedIn={signedIn} onPhase={onPhase} />
      ) : mode === 'register' ? (
        <RegisterForm invite={invite} token={token} onPhase={onPhase} onSignIn={() => setMode('sign-in')} />
      ) : (
        <SignInForm lockedEmail={invite.email} onRegister={() => setMode('register')} />
      )}
    </div>
  )
}

/** Leaves the invite page for where the server said to go, replacing it in the history so its address is not kept. */
function useLeave() {
  const router = useRouter()
  return (redirect: unknown) => {
    router.replace(afterInvitePath(redirect))
    router.refresh()
  }
}

/** Signed out, then this page again: it shows the invite to whoever is signed in now. */
function useSignOutHere() {
  const router = useRouter()
  return async () => {
    try {
      await signOut()
    } finally {
      router.refresh()
    }
  }
}

export function SignedInAccept({
  invite,
  token,
  signedIn,
  onPhase,
}: {
  invite: OpenInvite
  token: string
  signedIn: NonNullable<SignedIn>
  onPhase: (phase: Phase) => void
}) {
  const leave = useLeave()
  const signOutHere = useSignOutHere()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const wrongEmail = invite.email !== null && normalizeEmail(invite.email) !== normalizeEmail(signedIn.email)

  async function accept() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      leave((await acceptInvite(token)).redirect)
    } catch (err) {
      const phase = phaseOf(err)
      if (phase) onPhase(phase)
      else setError(failureMessage(err))
      setBusy(false)
    }
  }

  const signOutButton = (label: string, className: string) => (
    <button
      type="button"
      className={className}
      disabled={busy}
      onClick={() => {
        setBusy(true)
        void signOutHere()
      }}
    >
      {label}
    </button>
  )

  return (
    <div className="mt-6 space-y-4" data-testid="invite-signed-in">
      <p className="text-sm text-stone-700">
        You are signed in as <strong className="font-semibold">{signedIn.displayName}</strong> ({signedIn.email}).
      </p>
      {invite.kind === 'planner' ? (
        <>
          <p className="text-sm text-stone-700">This invite makes a new account. Sign out first, then make the account.</p>
          {signOutButton('Sign out', `${primaryButton} w-full`)}
        </>
      ) : wrongEmail ? (
        <>
          <p role="alert" className={errorClass}>
            This invite is for {invite.email}. Sign out, then sign in with that email or make an account with it.
          </p>
          {signOutButton('Sign out', `${primaryButton} w-full`)}
        </>
      ) : (
        <>
          {error && (
            <p role="alert" className={errorClass}>
              {error}
            </p>
          )}
          <button type="button" className={`${primaryButton} w-full`} disabled={busy} onClick={() => void accept()}>
            {busy ? 'Accepting…' : 'Accept invite'}
          </button>
          {signOutButton('Not you? Sign out', `${quietButton} w-full`)}
        </>
      )}
    </div>
  )
}

/** What the sign-up form can say before sending, or null when it is ready. */
function signUpProblem(fields: { email: string; name: string; password: string; confirm: string }): string | null {
  if (!fields.email.trim()) return 'Enter your email address.'
  if (!fields.name.trim()) return 'Enter your name.'
  if (fields.password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters for your password.`
  if (fields.password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters for your password.`
  if (fields.password !== fields.confirm) return 'The two passwords are not the same.'
  return null
}

export function RegisterForm({
  invite,
  token,
  onPhase,
  onSignIn,
}: {
  invite: OpenInvite
  token: string
  onPhase: (phase: Phase) => void
  onSignIn: () => void
}) {
  const leave = useLeave()
  const [email, setEmail] = useState(invite.email ?? '')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string; signIn: boolean } | null>(null)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const local = signUpProblem({ email, name, password, confirm })
    if (local) {
      setError({ message: local, signIn: false })
      return
    }
    setBusy(true)
    setError(null)
    try {
      const done = await registerWithInvite({ token, email, displayName: name, password })
      leave(done.redirect)
      return
    } catch (err) {
      const phase = phaseOf(err)
      if (phase) {
        onPhase(phase)
        return
      }
      const refusal = refusalOf(err)
      if (refusal?.error === 'email_taken') {
        setError({ message: refusal.message ?? 'That email already has an account.', signIn: true })
      } else {
        setError({ message: failureMessage(err), signIn: false })
      }
    }
    setBusy(false)
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4" data-testid="invite-register">
      <h2 className="text-base font-semibold">Create your account</h2>
      <TextField
        label="Email"
        name="email"
        type="email"
        autoComplete="username"
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
        required
        readOnly={invite.email !== null}
        value={email}
        onChange={setEmail}
        hint={invite.email !== null ? 'This invite is for this email only.' : undefined}
      />
      <TextField label="Your name" name="name" autoComplete="name" required value={name} onChange={setName} maxLength={60} />
      <TextField
        label="Password"
        name="new-password"
        type="password"
        autoComplete="new-password"
        required
        value={password}
        onChange={setPassword}
        hint={`At least ${PASSWORD_MIN} characters.`}
      />
      <TextField
        label="Confirm password"
        name="confirm-password"
        type="password"
        autoComplete="new-password"
        required
        value={confirm}
        onChange={setConfirm}
      />
      {error && (
        <p role="alert" className={errorClass}>
          {error.message}
        </p>
      )}
      <button type="submit" disabled={busy} className={`${primaryButton} w-full`}>
        {busy ? 'Making your account…' : 'Create account'}
      </button>
      <button type="button" className={`${secondaryButton} w-full`} onClick={onSignIn} disabled={busy}>
        {error?.signIn ? 'Sign in instead' : 'I already have an account'}
      </button>
    </form>
  )
}

/** Signs in on this page; it then shows the invite to the signed-in account, to accept. */
export function SignInForm({ lockedEmail, onRegister }: { lockedEmail: string | null; onRegister: () => void }) {
  const router = useRouter()
  const [email, setEmail] = useState(lockedEmail ?? '')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await signIn(email, password)
      // The page renders again for the signed-in account, which can then accept.
      router.refresh()
      return
    } catch (err) {
      const refusal = refusalOf(err)
      if (refusal?.status === 401) setError('That email or password is wrong. Try again.')
      else if (refusal?.status === 422) setError('Enter your email address and your password.')
      else setError(failureMessage(err))
    }
    setPassword('')
    setBusy(false)
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4" data-testid="invite-sign-in">
      <h2 className="text-base font-semibold">Sign in to accept</h2>
      <TextField
        label="Email"
        name="email"
        type="email"
        autoComplete="username"
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
        required
        value={email}
        onChange={setEmail}
      />
      <TextField label="Password" name="password" type="password" autoComplete="current-password" required value={password} onChange={setPassword} />
      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}
      <button type="submit" disabled={busy || email.trim().length === 0 || password.length === 0} className={`${primaryButton} w-full`}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
      <button type="button" className={`${secondaryButton} w-full`} onClick={onRegister} disabled={busy}>
        Make a new account instead
      </button>
    </form>
  )
}
