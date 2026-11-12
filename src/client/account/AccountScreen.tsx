'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { changePassword, endAccountSession, endOtherSessions, listAccountSessions, updateAccount } from '@/client/accounts-api'
import { refusalOf } from '@/client/accounts/link-token'
import { errorMessage } from '@/client/api'
import { TextField } from '@/client/ui/fields'
import { RelativeTime } from '@/client/ui/RelativeTime'
import { errorClass, primaryButton, secondaryButton } from '@/client/ui/styles'
import { describeUserAgent, tooManyTriesMessage } from '@/domain/account-wording'
import { DISPLAY_NAME_MAX, PASSWORD_MAX, PASSWORD_MIN } from '@/domain/accounts'
import type { AccountInfo, AccountSession } from '@/shared/accounts-api'

const section = 'rounded-xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6'

/** The account page: your name, your password, and the devices signed in to your account. */
export function AccountScreen({ account, initialSessions }: { account: AccountInfo; initialSessions: AccountSession[] }) {
  const [sessions, setSessions] = useState(initialSessions)
  const reloadSessions = async () => {
    try {
      setSessions(await listAccountSessions())
    } catch {
      // The list stays as it was; the page shows it fresh on the next visit.
    }
  }
  return (
    <div className="mt-6 space-y-6">
      <NameSection account={account} />
      <PasswordSection onChanged={() => void reloadSessions()} />
      <DevicesSection sessions={sessions} onChange={setSessions} />
    </div>
  )
}

function NameSection({ account }: { account: AccountInfo }) {
  const router = useRouter()
  const [name, setName] = useState(account.displayName)
  const [saved, setSaved] = useState(account.displayName)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (!name.trim()) return setStatus({ ok: false, message: 'Enter your name.' })
    setBusy(true)
    setStatus(null)
    try {
      const updated = await updateAccount(name)
      setName(updated.displayName)
      setSaved(updated.displayName)
      setStatus({ ok: true, message: 'Saved.' })
      // Your name shows elsewhere on the page too.
      router.refresh()
    } catch (err) {
      setStatus({ ok: false, message: `Could not save. ${errorMessage(err)}` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="account-name" className={section}>
      <h2 id="account-name" className="text-lg font-semibold">
        Your name
      </h2>
      <p className="mt-1 text-sm text-stone-600">Shown to the people you plan weddings with. You sign in as {account.email}.</p>
      <form onSubmit={onSubmit} noValidate className="mt-4 space-y-4">
        <TextField label="Name" name="name" autoComplete="name" value={name} onChange={setName} maxLength={DISPLAY_NAME_MAX} />
        {status && (
          <p role={status.ok ? 'status' : 'alert'} className={status.ok ? 'text-sm text-green-800' : errorClass}>
            {status.message}
          </p>
        )}
        <button type="submit" className={primaryButton} disabled={busy || name.trim() === saved}>
          {busy ? 'Saving…' : 'Save name'}
        </button>
      </form>
    </section>
  )
}

function PasswordSection({ onChanged }: { onChanged: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const fail = (message: string) => setStatus({ ok: false, message })
    if (!current) return fail('Enter your current password.')
    if (next.length < PASSWORD_MIN) return fail(`Use at least ${PASSWORD_MIN} characters for your new password.`)
    if (next.length > PASSWORD_MAX) return fail(`Use at most ${PASSWORD_MAX} characters for your new password.`)
    if (next !== confirm) return fail('The two new passwords are not the same.')
    setBusy(true)
    setStatus(null)
    try {
      await changePassword({ current, next })
      setCurrent('')
      setNext('')
      setConfirm('')
      setStatus({ ok: true, message: 'Your password is changed. Every other device is signed out.' })
      onChanged()
    } catch (err) {
      const refusal = refusalOf(err)
      if (refusal?.status === 403 && refusal.error === 'wrong_password') fail('Your current password is wrong. Try again.')
      else if (refusal?.status === 429) fail(tooManyTriesMessage(refusal.retryAfterSeconds))
      else fail(`Could not change your password. ${errorMessage(err)}`)
      setCurrent('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="account-password" className={section}>
      <h2 id="account-password" className="text-lg font-semibold">
        Password
      </h2>
      <p className="mt-1 text-sm text-stone-600">Changing it signs you out on every other device.</p>
      <form onSubmit={onSubmit} noValidate className="mt-4 space-y-4">
        <TextField
          label="Current password"
          name="current-password"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={setCurrent}
        />
        <TextField
          label="New password"
          name="new-password"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={setNext}
          hint={`At least ${PASSWORD_MIN} characters.`}
        />
        <TextField label="Confirm new password" name="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={setConfirm} />
        {status && (
          <p role={status.ok ? 'status' : 'alert'} className={status.ok ? 'text-sm text-green-800' : errorClass}>
            {status.message}
          </p>
        )}
        <button type="submit" className={primaryButton} disabled={busy}>
          {busy ? 'Changing…' : 'Change password'}
        </button>
      </form>
    </section>
  )
}

export function DevicesSection({ sessions, onChange }: { sessions: AccountSession[]; onChange: (sessions: AccountSession[]) => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const others = sessions.filter((s) => !s.current)

  async function run(key: string, work: () => Promise<void>) {
    if (busy) return
    setBusy(key)
    setError(null)
    try {
      await work()
    } catch (err) {
      setError(`Could not sign that device out. ${errorMessage(err)}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-labelledby="account-devices" className={section}>
      <h2 id="account-devices" className="text-lg font-semibold">
        Signed-in devices
      </h2>
      <p className="mt-1 text-sm text-stone-600">Sign out any you do not recognize or no longer use.</p>
      <ul className="mt-4 divide-y divide-stone-200" data-testid="device-list">
        {sessions.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 py-3" data-testid="device" data-current={s.current ? 'true' : undefined}>
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {describeUserAgent(s.userAgent)}
                {s.current && <span className="font-normal text-stone-600"> · This device</span>}
              </p>
              <p className="text-sm text-stone-600">
                Last used <RelativeTime iso={s.lastSeenAt} /> · Signed in <RelativeTime iso={s.createdAt} />
              </p>
            </div>
            {!s.current && (
              <button
                type="button"
                className={secondaryButton}
                disabled={busy !== null}
                onClick={() =>
                  void run(s.id, async () => {
                    await endAccountSession(s.id)
                    onChange(sessions.filter((x) => x.id !== s.id))
                  })
                }
              >
                {busy === s.id ? 'Signing out…' : 'Sign out'}
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className={`${errorClass} mt-2`}>
          {error}
        </p>
      )}
      {others.length > 0 && (
        <button
          type="button"
          className={`${secondaryButton} mt-4`}
          disabled={busy !== null}
          onClick={() =>
            void run('others', async () => {
              await endOtherSessions()
              onChange(sessions.filter((x) => x.current))
            })
          }
        >
          {busy === 'others' ? 'Signing out…' : 'Sign out everywhere else'}
        </button>
      )}
    </section>
  )
}
