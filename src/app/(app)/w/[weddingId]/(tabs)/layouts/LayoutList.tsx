'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { deleteLayout, duplicateLayout, errorMessage, layoutDeleteSummary, updateLayout } from '@/client/api'
import { useAuthor } from '@/client/author'
import { randomId } from '@/client/sync/random-id'
import { InlineName } from '@/client/ui/InlineName'
import { EditedLine } from '@/client/ui/RelativeTime'
import { secondaryButton } from '@/client/ui/styles'
import { TypedDeleteDialog } from '@/client/ui/TypedDeleteDialog'
import { layoutDeleteMessage, layoutKindLabel } from '@/domain/wording'
import type { LayoutSummary } from '@/shared/api'
import { EmptyState } from '../../_components/TabPage'

export function LayoutList({ weddingId, layouts }: { weddingId: string; layouts: LayoutSummary[] }) {
  if (layouts.length === 0) return <EmptyState>No layouts yet.</EmptyState>
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="layout-list">
      {layouts.map((layout) => (
        <li key={layout.id}>
          <LayoutCard weddingId={weddingId} layout={layout} />
        </li>
      ))}
    </ul>
  )
}

/** The server's thumbnail is an SVG it drew itself from numbers only (src/domain/thumbnail.ts), shown as an image. */
function thumbnailSrc(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function LayoutCard({ weddingId, layout }: { weddingId: string; layout: LayoutSummary }) {
  const router = useRouter()
  const author = useAuthor()
  const [deleting, setDeleting] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const href = `/w/${weddingId}/layouts/${layout.id}`

  async function duplicate() {
    if (duplicating) return
    if (!author) {
      setError('Pick Noa or Aiden first, so the copy carries your name.')
      return
    }
    setDuplicating(true)
    setError(null)
    try {
      await duplicateLayout(layout.id, { id: randomId(), editedBy: author })
      router.refresh()
    } catch (err) {
      setError(`Could not duplicate. ${errorMessage(err)}`)
    } finally {
      setDuplicating(false)
    }
  }

  return (
    <article
      className="flex h-full flex-col rounded-xl border border-stone-200 bg-white p-3 shadow-sm"
      data-testid="layout-card"
      data-layout-id={layout.id}
    >
      <Link href={href} tabIndex={-1} aria-hidden="true" className="block">
        {/* A data: URL the server drew; next/image adds nothing for it. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={thumbnailSrc(layout.thumbSvg)}
          alt=""
          width={320}
          height={200}
          className="aspect-[8/5] h-auto w-full rounded-lg border border-stone-200 bg-slate-50 object-contain"
          data-testid="layout-thumbnail"
        />
      </Link>
      <div className="mt-2 px-1">
        <InlineName
          value={layout.name}
          label="Layout name"
          textClassName="text-base font-semibold"
          testId="layout-name"
          onSave={async (name) => {
            await updateLayout(layout.id, { name })
            router.refresh()
          }}
        />
        <p className="text-sm text-stone-700" data-testid="layout-venue">
          {layoutKindLabel(layout.kind)} · {layout.venueName ?? (layout.venueDeleted ? '' : 'Blank canvas')}
          {layout.venueDeleted && (
            <>
              {' '}
              <span className="whitespace-nowrap rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900">
                Venue deleted
              </span>
            </>
          )}
        </p>
        <p className="mt-0.5 text-sm text-stone-600" data-testid="layout-edited">
          <EditedLine updatedAt={layout.updatedAt} editedBy={layout.editedBy} />
        </p>
      </div>
      {error && (
        <p role="alert" className="mt-2 px-1 text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="mt-auto flex flex-wrap gap-2 pt-3">
        <Link href={href} aria-label={`Open ${layout.name}`} className={`${secondaryButton} flex-1`}>
          Open
        </Link>
        <button
          type="button"
          onClick={duplicate}
          disabled={duplicating}
          aria-label={`Duplicate ${layout.name}`}
          className={`${secondaryButton} flex-1`}
        >
          {duplicating ? 'Duplicating…' : 'Duplicate'}
        </button>
        <button
          type="button"
          onClick={() => setDeleting(true)}
          aria-label={`Delete ${layout.name}`}
          className={`${secondaryButton} flex-1 text-red-700 hover:bg-red-50`}
        >
          Delete
        </button>
      </div>
      <TypedDeleteDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title="Delete layout"
        loadMessage={async () => layoutDeleteMessage(await layoutDeleteSummary(layout.id))}
        onConfirm={async () => {
          await deleteLayout(layout.id)
          setDeleting(false)
          router.refresh()
        }}
      />
    </article>
  )
}
