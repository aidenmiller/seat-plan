'use client'

import { useState, type ReactNode } from 'react'
import { createPlannerInvite, createResetLink, revokePlannerInvite, setUserDisabled, signOutUser } from '@/client/accounts-api'
import { InviteDialog } from '@/client/accounts/InviteDialog'
import { OneTimeLink } from '@/client/accounts/OneTimeLink'
import { PendingInvites } from '@/client/accounts/PendingInvites'
import { errorMessage } from '@/client/api'
import { resetPath } from '@/client/one-time-link'
import { Dialog, DialogActions } from '@/client/ui/Dialog'
import { RelativeTime } from '@/client/ui/RelativeTime'
import { dangerButton, errorClass, primaryButton, secondaryButton } from '@/client/ui/styles'
import type { AdminUser, CreatedResetLink, InviteSummary } from '@/shared/accounts-api'
import type { AdminPersonStats } from '@/shared/admin-api'

type Action = { kind: 'disable' | 'sign-out' | 'reset'; user: AdminUser }

const cell = 'border-b border-stone-200 px-3 py-2 align-middle'
const head = 'border-b border-stone-200 px-3 py-2 font-semibold'
const smallButton = `${secondaryButton} px-3`

function When({ iso }: { iso: string | null }) {
  return iso ? <RelativeTime iso={iso} /> : <span className="text-stone-500">Never</span>
}

/** "2 owned", "1 as editor", or None, for the live weddings someone belongs to. */
function Weddings({ stats }: { stats: AdminPersonStats | undefined }) {
  if (!stats || stats.owned + stats.editing === 0) return <span className="text-stone-500">None</span>
  return (
    <>
      {stats.owned > 0 && <span className="block">{stats.owned} owned</span>}
      {stats.editing > 0 && <span className="block">{stats.editing} as editor</span>}
    </>
  )
}

/**
 * Admin: everyone with an account, with the live weddings they own or help
 * with, their edits in the last 7 and 30 days (the hourly usage counters, so
 * saves and other changes, not keystrokes) and their AI floor plan imports in
 * the last 30 days. Turn an account off (it is signed out at once) or back on,
 * make a reset link (shown once), sign someone out everywhere, and invite a
 * new planner. Your own account can only be given a reset link here: the
 * account page changes your password and signs out your other devices.
 */
export function AdminUsersScreen({
  meId,
  initialUsers,
  initialInvites,
  stats = {},
}: {
  meId: string
  initialUsers: AdminUser[]
  initialInvites: InviteSummary[]
  stats?: Record<string, AdminPersonStats>
}) {
  const [users, setUsers] = useState(initialUsers)
  const [invites, setInvites] = useState(initialInvites)
  const [action, setAction] = useState<Action | null>(null)
  const [inviting, setInviting] = useState(false)
  const [rowError, setRowError] = useState<{ userId: string; message: string } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const replace = (next: AdminUser) => setUsers((list) => list.map((u) => (u.id === next.id ? next : u)))

  async function turnOn(user: AdminUser) {
    setBusyId(user.id)
    setRowError(null)
    try {
      replace(await setUserDisabled(user.id, false))
    } catch (err) {
      setRowError({ userId: user.id, message: `Could not turn the account on. ${errorMessage(err)}` })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-8">
      <section aria-labelledby="users-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="users-heading" className="text-xl font-semibold tracking-tight">
            People
          </h2>
          <button type="button" className={primaryButton} onClick={() => setInviting(true)}>
            Invite a new planner
          </button>
        </div>
        {/* Positioned, so the table's sr-only text stays inside its own sideways scroll instead of widening the page. */}
        <div className="relative mt-4 overflow-x-auto overscroll-x-contain rounded-xl border border-stone-200 bg-white" data-testid="admin-users-box">
          <table className="w-full min-w-[1060px] border-separate border-spacing-0 text-sm" data-testid="admin-users">
            <thead className="text-left text-xs uppercase tracking-wide text-stone-600">
              <tr>
                <th scope="col" className={head}>Name</th>
                <th scope="col" className={head}>Status</th>
                <th scope="col" className={head}>Weddings</th>
                <th scope="col" className={head}>Edits, 7 / 30 days</th>
                <th scope="col" className={head}>AI imports, 30 days</th>
                <th scope="col" className={head}>Last seen</th>
                <th scope="col" className={head}>Joined</th>
                <th scope="col" className={head}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const me = user.id === meId
                const busy = busyId === user.id
                return (
                  <tr key={user.id} data-testid="admin-user" data-user-id={user.id}>
                    <td className={`${cell} max-w-64`}>
                      <span className="font-medium">
                        {user.displayName}
                        {me && <span className="font-normal text-stone-600"> (you)</span>}
                      </span>
                      <span className="block break-all text-xs text-stone-600">{user.email}</span>
                      {user.isAdmin && <span className="block text-xs font-medium text-blue-900">Admin</span>}
                    </td>
                    <td className={cell} data-testid="admin-user-status">
                      {user.disabled ? <span className="font-medium text-amber-800">Turned off</span> : 'Active'}
                    </td>
                    <td className={cell} data-testid="admin-user-weddings">
                      <Weddings stats={stats[user.id]} />
                    </td>
                    <td className={`${cell} tabular-nums`} data-testid="admin-user-edits">
                      {stats[user.id]?.edits7 ?? 0} / {stats[user.id]?.edits30 ?? 0}
                    </td>
                    <td className={`${cell} tabular-nums`} data-testid="admin-user-ai-imports">
                      {stats[user.id]?.aiImports30 ?? 0}
                    </td>
                    <td className={cell}>
                      <When iso={user.lastSeenAt} />
                      <span className="block text-xs text-stone-600">
                        {user.lastLoginAt ? (
                          <>
                            signed in <RelativeTime iso={user.lastLoginAt} />
                          </>
                        ) : (
                          'never signed in'
                        )}
                      </span>
                    </td>
                    <td className={cell}>
                      <RelativeTime iso={user.createdAt} />
                    </td>
                    <td className={cell}>
                      <div className="flex flex-wrap justify-end gap-2">
                        {!me &&
                          (user.disabled ? (
                            <button type="button" className={smallButton} disabled={busy} onClick={() => void turnOn(user)}>
                              Turn on
                            </button>
                          ) : (
                            <button type="button" className={`${smallButton} text-red-700 hover:bg-red-50`} disabled={busy} onClick={() => setAction({ kind: 'disable', user })}>
                              Turn off
                            </button>
                          ))}
                        <button type="button" className={smallButton} disabled={busy} onClick={() => setAction({ kind: 'reset', user })}>
                          Reset link
                        </button>
                        {!me && (
                          <button type="button" className={smallButton} disabled={busy} onClick={() => setAction({ kind: 'sign-out', user })}>
                            Sign out everywhere
                          </button>
                        )}
                      </div>
                      {rowError?.userId === user.id && (
                        <p role="alert" className={`${errorClass} mt-1 text-right`}>
                          {rowError.message}
                        </p>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="planner-invites-heading">
        <h2 id="planner-invites-heading" className="text-xl font-semibold tracking-tight">
          Planner invites waiting
        </h2>
        <p className="mb-3 mt-1 text-sm text-stone-600">Links for new planners that nobody has used yet. Each works once and stops after 7 days.</p>
        <PendingInvites
          invites={invites}
          revoke={revokePlannerInvite}
          onRevoked={(id) => setInvites((list) => list.filter((i) => i.id !== id))}
          empty="No planner invites waiting."
        />
      </section>

      <InviteDialog
        open={inviting}
        onClose={() => setInviting(false)}
        title="Invite a new planner"
        withRole={false}
        create={(fields) => createPlannerInvite({ email: fields.email, note: fields.note })}
        onCreated={(invite) => setInvites((list) => [invite, ...list])}
      />
      {action?.kind === 'disable' && (
        <ConfirmAction
          title={`Turn off ${action.user.displayName}’s account?`}
          description="They are signed out everywhere at once and cannot sign in until you turn the account back on. Invites and reset links they have out stop working."
          action="Turn off"
          onClose={() => setAction(null)}
          run={async () => {
            replace(await setUserDisabled(action.user.id, true))
            return null
          }}
        />
      )}
      {action?.kind === 'sign-out' && (
        <ConfirmAction
          title={`Sign ${action.user.displayName} out everywhere?`}
          description="Every device signed in to this account is signed out. They can sign in again with their password."
          action="Sign out everywhere"
          onClose={() => setAction(null)}
          run={async () => {
            const { ended } = await signOutUser(action.user.id)
            return ended === 1 ? 'Signed out of 1 device.' : `Signed out of ${ended} devices.`
          }}
        />
      )}
      {action?.kind === 'reset' && <ResetLinkDialog user={action.user} onClose={() => setAction(null)} />}
    </div>
  )
}

/**
 * Asks before an action, runs it, and shows what went wrong. `run` returns a
 * line to show when it is done (the dialog stays open with it), or null to close.
 */
function ConfirmAction({
  title,
  description,
  action,
  onClose,
  run,
}: {
  title: string
  description: ReactNode
  action: string
  onClose: () => void
  run: () => Promise<string | null>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function confirm() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const message = await run()
      if (message === null) onClose()
      else setDone(message)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onClose} title={title} description={description} size="sm" dismissable={!busy}>
      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}
      {done ? (
        <>
          <p role="status" className="text-sm text-stone-700">
            {done}
          </p>
          <DialogActions>
            <button type="button" className={primaryButton} onClick={onClose}>
              Done
            </button>
          </DialogActions>
        </>
      ) : (
        <DialogActions>
          <button type="button" className={secondaryButton} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={dangerButton} onClick={() => void confirm()} disabled={busy}>
            {busy ? 'Working…' : action}
          </button>
        </DialogActions>
      )}
    </Dialog>
  )
}

/** Makes a reset link for one account and shows it once. Making one cancels any earlier link. */
function ResetLinkDialog({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [made, setMade] = useState<CreatedResetLink | null>(null)

  async function make() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      setMade(await createResetLink(user.id))
    } catch (err) {
      setError(`Could not make the link. ${errorMessage(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onClose} title={`Reset link for ${user.displayName}`} dismissable={!busy} testId="reset-link-dialog">
      {made ? (
        <>
          <OneTimeLink path={resetPath(made.token)} label="Reset link">
            Send this link to {user.displayName} yourself; it works once and expires in 24 hours. It is shown only now, so copy it before you close this.
          </OneTimeLink>
          <DialogActions>
            <button type="button" className={primaryButton} onClick={onClose}>
              Done
            </button>
          </DialogActions>
        </>
      ) : (
        <>
          <p className="text-sm text-stone-700">
            Whoever opens the link can set a new password for {user.email}, so send it only to them. Making a new link cancels any earlier one.
          </p>
          {error && (
            <p role="alert" className={`${errorClass} mt-2`}>
              {error}
            </p>
          )}
          <DialogActions>
            <button type="button" className={secondaryButton} onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className={primaryButton} onClick={() => void make()} disabled={busy}>
              {busy ? 'Making the link…' : 'Make reset link'}
            </button>
          </DialogActions>
        </>
      )}
    </Dialog>
  )
}
