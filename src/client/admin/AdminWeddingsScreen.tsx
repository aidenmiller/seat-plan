'use client'

import Link from 'next/link'
import { useState } from 'react'
import { claimWedding } from '@/client/accounts-api'
import { undeleteWedding } from '@/client/admin-api'
import { errorMessage } from '@/client/api'
import { RelativeTime } from '@/client/ui/RelativeTime'
import { errorClass, secondaryButton } from '@/client/ui/styles'
import type { AdminWedding } from '@/shared/accounts-api'
import type { AdminWeddingStats } from '@/shared/admin-api'

const cell = 'border-b border-stone-200 px-3 py-2 align-middle'
const head = 'border-b border-stone-200 px-3 py-2 font-semibold'
const smallButton = `${secondaryButton} px-3`
const muted = 'text-stone-500'

/** "Edited 5 minutes ago by Pip", in two lines. */
export function LastEdited({ stats }: { stats: AdminWeddingStats | undefined }) {
  const last = stats?.lastEdited
  if (!last) return <span className={muted}>Never</span>
  return (
    <span title={last.source === 'layout' ? 'From the newest layout save (no edits counted yet)' : undefined}>
      <RelativeTime iso={last.at} />
      {last.by && <span className="block text-xs text-stone-600">by {last.by}</span>}
    </span>
  )
}

/** "2 on", and when one was last opened. */
export function ShareLinks({ stats }: { stats: AdminWeddingStats | undefined }) {
  const links = stats?.shareLinks
  if (!links || (links.active === 0 && !links.lastOpenedAt)) return <span className={muted}>None</span>
  return (
    <span>
      {links.active} on
      <span className="block text-xs text-stone-600">
        {links.lastOpenedAt ? (
          <>
            opened <RelativeTime iso={links.lastOpenedAt} />
          </>
        ) : (
          'never opened'
        )}
      </span>
    </span>
  )
}

function Owners({ wedding }: { wedding: AdminWedding }) {
  const owners = wedding.members.filter((m) => m.role === 'owner')
  return owners.length > 0 ? <>{owners.map((o) => o.displayName).join(', ')}</> : <span className="font-medium text-amber-800">No owner</span>
}

/**
 * Admin: every wedding, with its owners, how many people belong to it, its
 * guests and layouts, when it was last edited and by whom, its edits in the
 * last 30 days, and its share links. The name opens the wedding's admin page
 * (people, ownership, recent activity); Open opens the wedding itself, as
 * for any admin (logged). A wedding with no owner can be claimed. Deleted
 * weddings are listed apart, with Undelete.
 */
export function AdminWeddingsScreen({
  initialWeddings,
  stats = {},
}: {
  initialWeddings: AdminWedding[]
  stats?: Record<string, AdminWeddingStats>
}) {
  const [weddings, setWeddings] = useState(initialWeddings)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null)

  async function run(wedding: AdminWedding, what: string, action: () => Promise<AdminWedding>) {
    setBusyId(wedding.id)
    setRowError(null)
    try {
      const next = await action()
      setWeddings((list) => list.map((w) => (w.id === next.id ? next : w)))
    } catch (err) {
      setRowError({ id: wedding.id, message: `Could not ${what} it. ${errorMessage(err)}` })
    } finally {
      setBusyId(null)
    }
  }

  const live = weddings.filter((w) => !w.deletedAt)
  const deleted = weddings.filter((w) => w.deletedAt)

  function actions(wedding: AdminWedding) {
    const busy = busyId === wedding.id
    const ownerless = !wedding.members.some((m) => m.role === 'owner')
    return (
      <td className={cell}>
        <div className="flex flex-wrap justify-end gap-2">
          {!wedding.deletedAt && (
            <Link href={`/w/${wedding.id}/layouts`} className={smallButton} aria-label={`Open ${wedding.name}`}>
              Open
            </Link>
          )}
          {wedding.deletedAt && (
            <button type="button" className={smallButton} disabled={busy} onClick={() => void run(wedding, 'undelete', () => undeleteWedding(wedding.id))}>
              {busy ? 'Working…' : 'Undelete'}
            </button>
          )}
          {ownerless && (
            <button type="button" className={smallButton} disabled={busy} onClick={() => void run(wedding, 'claim', () => claimWedding(wedding.id))}>
              {busy ? 'Working…' : 'Claim'}
            </button>
          )}
        </div>
        {rowError?.id === wedding.id && (
          <p role="alert" className={`${errorClass} mt-1 text-right`}>
            {rowError.message}
          </p>
        )}
      </td>
    )
  }

  const name = (wedding: AdminWedding) => (
    <td className={`${cell} font-medium`}>
      <Link href={`/admin/weddings/${wedding.id}`} className="text-blue-900 underline decoration-blue-900/30 underline-offset-2 hover:decoration-blue-900">
        {wedding.name}
      </Link>
    </td>
  )

  return (
    <div className="space-y-8">
      <section aria-labelledby="weddings-heading">
        <h2 id="weddings-heading" className="text-xl font-semibold tracking-tight">
          Weddings
        </h2>
        {live.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center text-stone-600">No weddings yet.</p>
        ) : (
          // Positioned, so the table's sr-only text stays inside its own sideways scroll instead of widening the page.
          <div className="relative mt-4 overflow-x-auto overscroll-x-contain rounded-xl border border-stone-200 bg-white" data-testid="admin-weddings-box">
            <table className="w-full min-w-[1080px] border-separate border-spacing-0 text-sm" data-testid="admin-weddings">
              <thead className="text-left text-xs uppercase tracking-wide text-stone-600">
                <tr>
                  <th scope="col" className={head}>Wedding</th>
                  <th scope="col" className={head}>Owners</th>
                  <th scope="col" className={head}>People</th>
                  <th scope="col" className={head}>Guests</th>
                  <th scope="col" className={head}>Layouts</th>
                  <th scope="col" className={head}>Last edited</th>
                  <th scope="col" className={head}>Edits, 30 days</th>
                  <th scope="col" className={head}>Share links</th>
                  <th scope="col" className={head}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {live.map((wedding) => (
                  <tr key={wedding.id} data-testid="admin-wedding" data-wedding-id={wedding.id}>
                    {name(wedding)}
                    <td className={cell}>
                      <Owners wedding={wedding} />
                    </td>
                    <td className={cell}>{wedding.members.length}</td>
                    <td className={cell}>{wedding.guestCount}</td>
                    <td className={cell}>{wedding.layoutCount}</td>
                    <td className={cell}>
                      <LastEdited stats={stats[wedding.id]} />
                    </td>
                    <td className={`${cell} tabular-nums`} data-testid="admin-wedding-edits">
                      {stats[wedding.id]?.edits30 ?? 0}
                    </td>
                    <td className={cell}>
                      <ShareLinks stats={stats[wedding.id]} />
                    </td>
                    {actions(wedding)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {deleted.length > 0 && (
        <section aria-labelledby="deleted-heading">
          <h2 id="deleted-heading" className="text-xl font-semibold tracking-tight">
            Deleted weddings
          </h2>
          <p className="mt-1 text-sm text-stone-600">Undelete brings one back as it was, with its guests, layouts and share links.</p>
          <div className="relative mt-4 overflow-x-auto overscroll-x-contain rounded-xl border border-stone-200 bg-white" data-testid="admin-deleted-box">
            <table className="w-full min-w-[720px] border-separate border-spacing-0 text-sm" data-testid="admin-deleted-weddings">
              <thead className="text-left text-xs uppercase tracking-wide text-stone-600">
                <tr>
                  <th scope="col" className={head}>Wedding</th>
                  <th scope="col" className={head}>Owners</th>
                  <th scope="col" className={head}>Guests</th>
                  <th scope="col" className={head}>Layouts</th>
                  <th scope="col" className={head}>Deleted</th>
                  <th scope="col" className={head}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {deleted.map((wedding) => (
                  <tr key={wedding.id} data-testid="admin-wedding" data-wedding-id={wedding.id}>
                    {name(wedding)}
                    <td className={cell}>
                      <Owners wedding={wedding} />
                    </td>
                    <td className={cell}>{wedding.guestCount}</td>
                    <td className={cell}>{wedding.layoutCount}</td>
                    <td className={cell}>
                      <RelativeTime iso={wedding.deletedAt!} />
                    </td>
                    {actions(wedding)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
