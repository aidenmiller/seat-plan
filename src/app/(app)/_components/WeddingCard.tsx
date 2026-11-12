'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { deleteWedding, updateWedding, weddingDeleteSummary } from '@/client/api'
import { InlineName } from '@/client/ui/InlineName'
import { secondaryButton } from '@/client/ui/styles'
import { TypedDeleteDialog } from '@/client/ui/TypedDeleteDialog'
import { formatWeddingDate, weddingCounts, weddingDeleteMessage } from '@/domain/wording'
import type { WeddingSummary } from '@/shared/api'

/**
 * A wedding on the home screen: rename in place, open, delete with the typed
 * word. Renaming and deleting are for owners; an editor can only open it.
 * `role` is the person's own role there, shown quietly under the name. A white
 * card, shadowed for the home page's navy.
 */
export function WeddingCard({
  wedding,
  role,
  canManage,
}: {
  wedding: WeddingSummary
  role: 'owner' | 'editor'
  canManage: boolean
}) {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)
  const href = `/w/${wedding.id}/layouts`

  return (
    <article
      className="flex h-full flex-col rounded-xl bg-white p-4 shadow-[0_12px_32px_-12px_rgb(6_17_51/0.6)]"
      data-testid="wedding-card"
      data-wedding-id={wedding.id}
    >
      {canManage ? (
        <InlineName
          value={wedding.name}
          label="Wedding name"
          textClassName="text-lg font-semibold"
          testId="wedding-name"
          onSave={async (name) => {
            await updateWedding(wedding.id, { name })
            router.refresh()
          }}
        />
      ) : (
        <h2 className="min-h-11 py-2 text-lg font-semibold" data-testid="wedding-name">
          {wedding.name}
        </h2>
      )}
      <p className="mt-1 text-sm text-stone-700">{wedding.date ? formatWeddingDate(wedding.date) : 'No date yet'}</p>
      <p className="mt-1 text-sm text-stone-600">{weddingCounts(wedding.guestCount, wedding.layoutCount)}</p>
      <p className="mt-1 text-xs uppercase tracking-wide text-stone-500" data-testid="wedding-role">
        {role === 'owner' ? 'Owner' : 'Editor'}
      </p>
      <div className="mt-auto flex gap-2 pt-4">
        <Link href={href} aria-label={`Open ${wedding.name}`} className={`${secondaryButton} flex-1`}>
          Open
        </Link>
        {canManage && (
          <button
            type="button"
            onClick={() => setDeleting(true)}
            aria-label={`Delete ${wedding.name}`}
            className={`${secondaryButton} text-red-700 hover:bg-red-50`}
          >
            Delete
          </button>
        )}
      </div>
      <TypedDeleteDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title="Delete wedding"
        loadMessage={async () => weddingDeleteMessage(await weddingDeleteSummary(wedding.id))}
        onConfirm={async () => {
          await deleteWedding(wedding.id)
          setDeleting(false)
          router.refresh()
        }}
      />
    </article>
  )
}
