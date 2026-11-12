'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useId, useState, useTransition, type ReactNode } from 'react'
import { changeMemberRole, removeMember } from '@/client/accounts-api'
import { adminAddMember, transferOwnership, undeleteWedding } from '@/client/admin-api'
import { errorMessage } from '@/client/api'
import { Dialog, DialogActions } from '@/client/ui/Dialog'
import { RelativeTime } from '@/client/ui/RelativeTime'
import { dangerButton, errorClass, inputClass, labelClass, primaryButton, secondaryButton } from '@/client/ui/styles'
import { roleLabel } from '@/domain/account-wording'
import { activityLabel } from '@/domain/activity'
import type { AdminWedding, Role, WeddingMember } from '@/shared/accounts-api'
import type { AdminActivity, AdminPick, AdminWeddingStats } from '@/shared/admin-api'
import { LastEdited, ShareLinks } from './AdminWeddingsScreen'

const cell = 'border-b border-stone-200 px-3 py-2 align-middle'
const head = 'border-b border-stone-200 px-3 py-2 font-semibold'
const smallButton = `${secondaryButton} px-3`
/** A field as wide as its words: inputClass without its full width. */
const narrowSelect = `${inputClass.replace('w-full', 'w-auto')} min-w-28`

/**
 * Admin: one wedding. Who belongs to it, with their roles: change a role,
 * take someone out (both through the wedding's own member routes, which an
 * admin may use anywhere; the last owner stays), add someone who has an
 * account (no invite needed), and give the wedding a new owner. Then its
 * recent activity: who did what, and when. A deleted wedding is shown as it
 * is; Undelete brings it back, and its people can be changed after that.
 *
 * Every change reloads the page's data from the server (router.refresh), so
 * the members, the facts and the activity always agree.
 */
export function AdminWeddingDetailScreen({
  wedding,
  members,
  stats,
  activity,
  people,
}: {
  wedding: AdminWedding
  members: WeddingMember[]
  stats: AdminWeddingStats | undefined
  activity: AdminActivity[]
  people: AdminPick[]
}) {
  const router = useRouter()
  const [refreshing, startRefresh] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState<WeddingMember | null>(null)
  const [transferring, setTransferring] = useState(false)
  const live = !wedding.deletedAt

  /** Runs a change, then reloads the page's data. Returns false when it failed (the error shows under the heading). */
  async function change(what: string, action: () => Promise<unknown>): Promise<boolean> {
    setBusy(true)
    setError(null)
    try {
      await action()
      startRefresh(() => router.refresh())
      return true
    } catch (err) {
      setError(`Could not ${what}. ${errorMessage(err)}`)
      return false
    } finally {
      setBusy(false)
    }
  }

  const working = busy || refreshing
  const memberIds = new Set(members.map((m) => m.userId))
  const addable = people.filter((p) => !memberIds.has(p.id) && !p.disabled)

  return (
    <div className="space-y-8">
      <section aria-labelledby="wedding-heading">
        <Link href="/admin/weddings" className="text-sm text-blue-900 underline underline-offset-2">
          All weddings
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h2 id="wedding-heading" className="min-w-0 break-words text-xl font-semibold tracking-tight">
            {wedding.name}
          </h2>
          <div className="flex flex-wrap gap-2">
            {live ? (
              <Link href={`/w/${wedding.id}/layouts`} className={secondaryButton}>
                Open the wedding
              </Link>
            ) : (
              <button type="button" className={primaryButton} disabled={working} onClick={() => void change('undelete it', () => undeleteWedding(wedding.id))}>
                Undelete
              </button>
            )}
          </div>
        </div>
        {!live && (
          <p className="mt-2 text-sm font-medium text-red-700" data-testid="wedding-deleted">
            Deleted <RelativeTime iso={wedding.deletedAt!} />. Undelete it to change who belongs.
          </p>
        )}
        {error && (
          <p role="alert" className={`${errorClass} mt-2`}>
            {error}
          </p>
        )}
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
          <Fact label="Guests">{wedding.guestCount}</Fact>
          <Fact label="Layouts">{wedding.layoutCount}</Fact>
          <Fact label="Made">
            <RelativeTime iso={wedding.createdAt} />
          </Fact>
          <Fact label="Last edited">
            <LastEdited stats={stats} />
          </Fact>
          <Fact label="Edits, 30 days">
            <span data-testid="wedding-edits">{stats?.edits30 ?? 0}</span>
          </Fact>
          <Fact label="Share links">
            <ShareLinks stats={stats} />
          </Fact>
        </dl>
      </section>

      <section aria-labelledby="members-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 id="members-heading" className="text-base font-semibold">
            People
          </h3>
          {live && (
            <button
              type="button"
              className={secondaryButton}
              disabled={working}
              onClick={() => {
                setError(null)
                setTransferring(true)
              }}
            >
              Change the owner
            </button>
          )}
        </div>
        {members.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-stone-300 bg-white p-6 text-center text-stone-600">Nobody belongs to this wedding.</p>
        ) : (
          <div className="relative mt-3 overflow-x-auto overscroll-x-contain rounded-xl border border-stone-200 bg-white" data-testid="admin-members-box">
            <table className="w-full min-w-[560px] border-separate border-spacing-0 text-sm" data-testid="admin-members">
              <thead className="text-left text-xs uppercase tracking-wide text-stone-600">
                <tr>
                  <th scope="col" className={head}>Name</th>
                  <th scope="col" className={head}>Role</th>
                  <th scope="col" className={head}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.userId} data-testid="admin-member" data-user-id={member.userId}>
                    <td className={cell}>
                      <span className="font-medium">{member.displayName}</span>
                      <span className="block break-all text-xs text-stone-600">{member.email}</span>
                      {member.disabled && <span className="block text-xs text-amber-800">Account turned off</span>}
                    </td>
                    <td className={cell}>
                      {live ? (
                        <select
                          className={narrowSelect}
                          aria-label={`Role for ${member.displayName}`}
                          value={member.role}
                          disabled={working}
                          onChange={(e) => {
                            const role = e.target.value as Role
                            void change(`change ${member.displayName}’s role`, () => changeMemberRole(wedding.id, member.userId, { role }))
                          }}
                        >
                          <option value="owner">{roleLabel('owner')}</option>
                          <option value="editor">{roleLabel('editor')}</option>
                        </select>
                      ) : (
                        roleLabel(member.role)
                      )}
                    </td>
                    <td className={`${cell} text-right`}>
                      {live && (
                        <button type="button" className={`${smallButton} text-red-700 hover:bg-red-50`} disabled={working} onClick={() => setRemoving(member)}>
                          Take out
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {live && <AddPerson addable={addable} working={working} onAdd={(userId, role) => change('add them', () => adminAddMember(wedding.id, { userId, role }))} />}
      </section>

      <section aria-labelledby="activity-heading">
        <h3 id="activity-heading" className="text-base font-semibold">
          Recent activity
        </h3>
        <p className="mt-1 text-sm text-stone-600">The newest 50 events. Edits are counted by the hour: one line per person and kind of edit.</p>
        {activity.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-stone-300 bg-white p-6 text-center text-stone-600">Nothing recorded yet.</p>
        ) : (
          <div className="relative mt-3 overflow-x-auto overscroll-x-contain rounded-xl border border-stone-200 bg-white" data-testid="admin-wedding-activity-box">
            <table className="w-full min-w-[560px] border-separate border-spacing-0 text-sm" data-testid="admin-wedding-activity">
              <thead className="text-left text-xs uppercase tracking-wide text-stone-600">
                <tr>
                  <th scope="col" className={head}>When</th>
                  <th scope="col" className={head}>Who</th>
                  <th scope="col" className={head}>What</th>
                  <th scope="col" className={`${head} text-right`}>How many</th>
                </tr>
              </thead>
              <tbody>
                {activity.map((event) => (
                  <tr key={event.id} data-testid="admin-wedding-event" data-kind={event.kind}>
                    <td className={cell}>
                      <RelativeTime iso={event.at} />
                    </td>
                    <td className={cell}>{event.userName ?? <span className="text-stone-500">Nobody</span>}</td>
                    <td className={cell}>{activityLabel(event.kind, { write: event.write })}</td>
                    <td className={`${cell} text-right tabular-nums`}>{event.count ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Dialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={removing ? `Take ${removing.displayName} out of ${wedding.name}?` : 'Take out'}
        description="They will no longer be able to open this wedding. You can add them back later."
        size="sm"
        dismissable={!working}
      >
        <DialogActions>
          <button type="button" className={secondaryButton} onClick={() => setRemoving(null)} disabled={working}>
            Cancel
          </button>
          <button
            type="button"
            className={dangerButton}
            disabled={working}
            onClick={() => {
              const member = removing
              if (!member) return
              void change(`take ${member.displayName} out`, () => removeMember(wedding.id, member.userId)).then(() => setRemoving(null))
            }}
          >
            {working ? 'Working…' : 'Take out'}
          </button>
        </DialogActions>
      </Dialog>
      {transferring && (
        <TransferDialog
          wedding={wedding}
          members={members}
          people={people.filter((p) => !p.disabled)}
          error={error}
          onClose={() => setTransferring(false)}
          onTransfer={async (toUserId, keepPreviousAsEditors) => {
            const done = await change('change the owner', () => transferOwnership(wedding.id, { toUserId, keepPreviousAsEditors }))
            if (done) setTransferring(false)
          }}
        />
      )}
    </div>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-stone-600">{label}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  )
}

/** Adds someone who already has an account, as an owner or an editor. */
function AddPerson({ addable, working, onAdd }: { addable: AdminPick[]; working: boolean; onAdd: (userId: string, role: Role) => Promise<boolean> }) {
  const [userId, setUserId] = useState('')
  const [role, setRole] = useState<Role>('editor')
  const personId = useId()
  const roleId = useId()
  if (addable.length === 0) {
    return <p className="mt-3 text-sm text-stone-600">Everyone with an account that is on belongs to this wedding already.</p>
  }
  return (
    <form
      className="mt-4 flex flex-wrap items-end gap-3"
      aria-label="Add someone"
      onSubmit={(e) => {
        e.preventDefault()
        if (!userId) return
        void onAdd(userId, role).then((ok) => {
          if (ok) setUserId('')
        })
      }}
    >
      <div className="min-w-0 flex-1 basis-56">
        <label htmlFor={personId} className={labelClass}>
          Add someone with an account
        </label>
        <select id={personId} className={`${inputClass} mt-1`} value={userId} onChange={(e) => setUserId(e.target.value)} required>
          <option value="">Pick a person</option>
          {addable.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName} ({p.email})
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={roleId} className={labelClass}>
          As
        </label>
        <select id={roleId} className={`${narrowSelect} mt-1`} value={role} onChange={(e) => setRole(e.target.value as Role)}>
          <option value="editor">{roleLabel('editor')}</option>
          <option value="owner">{roleLabel('owner')}</option>
        </select>
      </div>
      <button type="submit" className={primaryButton} disabled={working || !userId}>
        Add
      </button>
    </form>
  )
}

/** Picks the new owner, and whether the owners now become editors. */
function TransferDialog({
  wedding,
  members,
  people,
  error,
  onClose,
  onTransfer,
}: {
  wedding: AdminWedding
  members: WeddingMember[]
  people: AdminPick[]
  error: string | null
  onClose: () => void
  onTransfer: (toUserId: string, keepPreviousAsEditors: boolean) => Promise<void>
}) {
  const [toUserId, setToUserId] = useState('')
  const [demote, setDemote] = useState(true)
  const [busy, setBusy] = useState(false)
  const pickId = useId()
  const owners = members.filter((m) => m.role === 'owner')
  const ownerNames = owners.map((o) => o.displayName).join(', ')
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Change the owner of ${wedding.name}`}
      description="The person you pick becomes an owner, and is added if they do not belong yet."
      dismissable={!busy}
      testId="transfer-dialog"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!toUserId || busy) return
          setBusy(true)
          void onTransfer(toUserId, demote).finally(() => setBusy(false))
        }}
      >
        <label htmlFor={pickId} className={labelClass}>
          New owner
        </label>
        <select id={pickId} className={`${inputClass} mt-1`} value={toUserId} onChange={(e) => setToUserId(e.target.value)} required>
          <option value="">Pick a person</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName} ({p.email})
            </option>
          ))}
        </select>
        {owners.length > 0 && (
          <label className="mt-4 flex min-h-11 items-center gap-3 text-sm text-stone-800">
            <input type="checkbox" className="size-5" checked={demote} onChange={(e) => setDemote(e.target.checked)} />
            <span>{owners.length === 1 ? `Make ${ownerNames} an editor` : `Make the current owners (${ownerNames}) editors`}</span>
          </label>
        )}
        {error && (
          <p role="alert" className={`${errorClass} mt-3`}>
            {error}
          </p>
        )}
        <DialogActions>
          <button type="button" className={secondaryButton} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={primaryButton} disabled={busy || !toUserId}>
            {busy ? 'Working…' : 'Change the owner'}
          </button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
