'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { PASSWORD_MAX, PASSWORD_MIN } from '@/domain/accounts'
import { TextField } from '@/client/ui/fields'
import { errorClass, primaryButton } from '@/client/ui/styles'

type Status = { kind: 'idle' } | { kind: 'busy' } | { kind: 'error'; message: string }

function minutes(seconds: number): string {
  const m = Math.max(1, Math.ceil(seconds / 60))
  return m === 1 ? '1 minute' : `${m} minutes`
}

/** What the form itself can say before sending, or null when it is ready. */
function problem(fields: { sitePassword: string; email: string; name: string; password: string; confirm: string }): string | null {
  if (!fields.sitePassword) return 'Enter the site password.'
  if (!fields.email.trim()) return 'Enter your email address.'
  if (!fields.name.trim()) return 'Enter your name.'
  if (fields.password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters for your password.`
  if (fields.password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters for your password.`
  if (fields.password !== fields.confirm) return 'The two passwords are not the same.'
  return null
}

export function SetupForm() {
  const router = useRouter()
  const [sitePassword, setSitePassword] = useState('')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (status.kind === 'busy') return
    const local = problem({ sitePassword, email, name, password, confirm })
    if (local) {
      setStatus({ kind: 'error', message: local })
      return
    }
    setStatus({ kind: 'busy' })
    try {
      // A public route with no signed-in user yet, so no user header (src/client/http.ts).
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sitePassword, email, displayName: name, password }),
        cache: 'no-store',
      })
      if (res.ok) {
        router.replace('/')
        router.refresh()
        return
      }
      const data = (await res.json().catch(() => ({}))) as { message?: string; issues?: string[]; retryAfterSeconds?: number }
      if (res.status === 401) {
        setSitePassword('')
        setStatus({ kind: 'error', message: 'That site password is wrong. Try again.' })
      } else if (res.status === 429) {
        setStatus({ kind: 'error', message: `Too many tries. Try again in ${minutes(data.retryAfterSeconds ?? 900)}.` })
      } else if (res.status === 404) {
        setStatus({ kind: 'error', message: 'Setup is already done. Sign in instead.' })
      } else if (res.status === 403 && data.message) {
        setStatus({ kind: 'error', message: data.message })
      } else if (res.status === 422 && data.issues?.[0]) {
        const issue = data.issues[0]
        setStatus({ kind: 'error', message: `${issue.includes(': ') ? issue.slice(issue.indexOf(': ') + 2) : issue}.` })
      } else {
        setStatus({ kind: 'error', message: 'Something went wrong. Try again.' })
      }
    } catch {
      setStatus({ kind: 'error', message: 'Could not reach the server. Check your connection and try again.' })
    }
  }

  const failed = status.kind === 'error'
  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
      <TextField
        label="Site password"
        name="site-password"
        type="password"
        autoComplete="off"
        autoFocus
        required
        value={sitePassword}
        onChange={setSitePassword}
        hint="The shared password the site used before accounts."
      />
      <TextField
        label="Your email"
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
      <TextField label="Your name" name="name" autoComplete="name" required value={name} onChange={setName} maxLength={60} />
      <TextField
        label="New password"
        name="new-password"
        type="password"
        autoComplete="new-password"
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
      {failed && (
        <p id="setup-error" role="alert" className={errorClass}>
          {status.message}
        </p>
      )}
      <button type="submit" disabled={status.kind === 'busy'} className={`${primaryButton} w-full`}>
        {status.kind === 'busy' ? 'Setting up…' : 'Make the first account'}
      </button>
    </form>
  )
}
