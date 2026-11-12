'use client'

import Link from 'next/link'
import { useState } from 'react'
import { claimWedding } from '@/client/accounts-api'
import { errorMessage } from '@/client/api'
import { RelativeTime } from '@/client/ui/RelativeTime'
import { errorClass, secondaryButton } from '@/client/ui/styles'
import type { AdminWedding } from '@/shared/accounts-api'

const cell = 'border-b border-stone-200 px-3 py-2 align-middle'
const head = 'border-b border-stone-200 px-3 py-2 font-semibold'
const smallButton = `${secondaryButton} px-3`

/**
 * Admin: every wedding, deleted ones too, with its owners, how many people
 * belong to it, and its guests and layouts. A live wedding opens as for any
 * admin (an admin can open every wedding; it is logged). A wedding with no
 * owner can be claimed: the admin becomes its owner, so someone can run it.
 */
export function AdminWeddingsScreen({ initialWeddings }: { initialWeddings: AdminWedding[] }) {
  const [weddings, setWeddings] = useState(initialWeddings)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null)

  async function claim(wedding: AdminWedding) {
    setBusyId(wedding.id)
    setRowError(null)
    try {
      const claimed = await claimWedding(wedding.id)
      setWeddings((list) => list.map((w) => (w.id === claimed.id ? claimed : w)))
    } catch (err) {
      setRowError({ id: wedding.id, message: `Could not claim it. ${errorMessage(err)}` })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section aria-labelledby="weddings-heading">
      <h2 id="weddings-heading" className="text-xl font-semibold tracking-tight">
        Weddings
      </h2>
      {weddings.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center text-stone-600">No weddings yet.</p>
      ) : (
        // Positioned, so the table's sr-only text stays inside its own sideways scroll instead of widening the page.
        <div className="relative mt-4 overflow-x-auto overscroll-x-contain rounded-xl border border-stone-200 bg-white" data-testid="admin-weddings-box">
          <table className="w-full min-w-[900px] border-separate border-spacing-0 text-sm" data-testid="admin-weddings">
            <thead className="text-left text-xs uppercase tracking-wide text-stone-600">
              <tr>
                <th scope="col" className={head}>Wedding</th>
                <th scope="col" className={head}>Owners</th>
                <th scope="col" className={head}>People</th>
                <th scope="col" className={head}>Guests</th>
                <th scope="col" className={head}>Layouts</th>
                <th scope="col" className={head}>Last changed</th>
                <th scope="col" className={head}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {weddings.map((wedding) => {
                const owners = wedding.members.filter((m) => m.role === 'owner')
                return (
                  <tr key={wedding.id} data-testid="admin-wedding" data-wedding-id={wedding.id}>
                    <td className={`${cell} font-medium`}>
                      {wedding.name}
                      {wedding.deletedAt && <span className="block text-xs font-medium uppercase tracking-wide text-red-700">Deleted</span>}
                    </td>
                    <td className={cell}>
                      {owners.length > 0 ? (
                        owners.map((o) => o.displayName).join(', ')
                      ) : (
                        <span className="font-medium text-amber-800">No owner</span>
                      )}
                    </td>
                    <td className={cell}>{wedding.members.length}</td>
                    <td className={cell}>{wedding.guestCount}</td>
                    <td className={cell}>{wedding.layoutCount}</td>
                    <td className={cell}>
                      <RelativeTime iso={wedding.updatedAt} />
                    </td>
                    <td className={cell}>
                      <div className="flex flex-wrap justify-end gap-2">
                        {!wedding.deletedAt && (
                          <Link href={`/w/${wedding.id}/layouts`} className={smallButton} aria-label={`Open ${wedding.name}`}>
                            Open
                          </Link>
                        )}
                        {owners.length === 0 && (
                          <button type="button" className={smallButton} disabled={busyId === wedding.id} onClick={() => void claim(wedding)}>
                            {busyId === wedding.id ? 'Claiming…' : 'Claim'}
                          </button>
                        )}
                      </div>
                      {rowError?.id === wedding.id && (
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
      )}
    </section>
  )
}
