'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'

type Status = { kind: 'idle' } | { kind: 'busy' } | { kind: 'error'; message: string }

function minutes(seconds: number): string {
  const m = Math.max(1, Math.ceil(seconds / 60))
  return m === 1 ? '1 minute' : `${m} minutes`
}

export function LoginForm({ next }: { next: string }) {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (status.kind === 'busy') return
    setStatus({ kind: 'busy' })
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password, next }),
      })
      if (res.ok) {
        const data = (await res.json()) as { redirect?: string }
        router.replace(data.redirect ?? '/')
        router.refresh()
        return
      }
      if (res.status === 429) {
        const data = (await res.json().catch(() => ({}))) as { retryAfterSeconds?: number }
        setStatus({ kind: 'error', message: `Too many tries. Try again in ${minutes(data.retryAfterSeconds ?? 900)}.` })
      } else if (res.status === 401) {
        setStatus({ kind: 'error', message: 'That password is wrong. Try again.' })
      } else {
        setStatus({ kind: 'error', message: 'Something went wrong. Try again.' })
      }
    } catch {
      setStatus({ kind: 'error', message: 'Could not reach the server. Check your connection and try again.' })
    }
    setPassword('')
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-stone-700">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={status.kind === 'error'}
          aria-describedby={status.kind === 'error' ? 'login-error' : undefined}
          className="mt-1 block h-11 w-full rounded-lg border border-stone-300 bg-white px-3 text-base outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-700/20"
        />
      </div>
      {status.kind === 'error' && (
        <p id="login-error" role="alert" className="text-sm text-red-700">
          {status.message}
        </p>
      )}
      <button
        type="submit"
        disabled={status.kind === 'busy' || password.length === 0}
        className="h-11 w-full rounded-lg bg-blue-900 px-4 font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status.kind === 'busy' ? 'Checking…' : 'Enter'}
      </button>
    </form>
  )
}
