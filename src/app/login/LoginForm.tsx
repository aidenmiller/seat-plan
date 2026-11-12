'use client'

import { useState, type FormEvent } from 'react'
import { postAuthMessage } from '@/client/auth-channel'
import { TextField } from '@/client/ui/fields'
import { errorClass, primaryButton } from '@/client/ui/styles'

type Status = { kind: 'idle' } | { kind: 'busy' } | { kind: 'error'; message: string }

function minutes(seconds: number): string {
  const m = Math.max(1, Math.ceil(seconds / 60))
  return m === 1 ? '1 minute' : `${m} minutes`
}

/**
 * Signing in. After it works, the other tabs hear who signed in
 * (src/client/auth-channel.ts): a tab of someone else stops and asks to
 * reload, so it never saves under this session. The next page then loads in
 * full, so nothing of a page from before (a save queue, its user) carries on.
 */
export function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (status.kind === 'busy') return
    setStatus({ kind: 'busy' })
    try {
      // A public route with no signed-in user yet, so no user header (src/client/http.ts).
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, next }),
        cache: 'no-store',
      })
      if (res.ok) {
        const data = (await res.json()) as { redirect?: string; userId?: string }
        if (data.userId) postAuthMessage({ type: 'signed-in', userId: data.userId })
        window.location.replace(data.redirect ?? '/')
        return
      }
      if (res.status === 429) {
        const data = (await res.json().catch(() => ({}))) as { retryAfterSeconds?: number }
        setStatus({ kind: 'error', message: `Too many tries. Try again in ${minutes(data.retryAfterSeconds ?? 900)}.` })
      } else if (res.status === 401) {
        setStatus({ kind: 'error', message: 'That email or password is wrong. Try again.' })
      } else if (res.status === 422) {
        setStatus({ kind: 'error', message: 'Enter your email address and your password.' })
      } else {
        setStatus({ kind: 'error', message: 'Something went wrong. Try again.' })
      }
    } catch {
      setStatus({ kind: 'error', message: 'Could not reach the server. Check your connection and try again.' })
    }
    setPassword('')
  }

  const failed = status.kind === 'error'
  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate aria-describedby={failed ? 'login-error' : undefined}>
      <TextField
        label="Email"
        name="email"
        type="email"
        autoComplete="username"
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
        autoFocus
        required
        value={email}
        onChange={setEmail}
        aria-invalid={failed || undefined}
      />
      <TextField
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={setPassword}
        aria-invalid={failed || undefined}
      />
      {failed && (
        <p id="login-error" role="alert" className={errorClass}>
          {status.message}
        </p>
      )}
      <button
        type="submit"
        disabled={status.kind === 'busy' || email.trim().length === 0 || password.length === 0}
        className={`${primaryButton} w-full`}
      >
        {status.kind === 'busy' ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}
