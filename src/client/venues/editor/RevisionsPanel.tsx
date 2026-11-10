'use client'

/**
 * The Revisions tab: every save and import of the template, newest first,
 * and "Undo import", which puts back the revision from just before the
 * latest import, at any later time (PLAN section 7, "Draft and Accept").
 * Any other revision can be put back too. Putting one back is itself a new
 * save, so it can be undone the same way.
 */
import { useEffect, useState } from 'react'
import { errorMessage, listVenueRevisions } from '@/client/api'
import { RelativeTime } from '@/client/ui/RelativeTime'
import { errorClass } from '@/client/ui/styles'
import { revisionDetail, revisionTitle } from '@/domain/venue-wording'
import type { VenueRevisionList } from '@/shared/api'
import { Section, smallButton } from '@/client/editor/panels/controls'

type Load = { kind: 'loading' } | { kind: 'ready'; list: VenueRevisionList } | { kind: 'error'; message: string }

export function RevisionsPanel({
  templateId,
  refreshKey,
  disabled,
  onRestore,
}: {
  templateId: string
  /** Changes after each save, import or restore, to load the list again. */
  refreshKey: number
  /** An import draft is open, edits are waiting to save, or the page cannot edit. */
  disabled: boolean
  /** Resolves with a sentence to show (someone else's save came first and was loaded), or null when done. */
  onRestore(revisionId: string, undoImport: boolean): Promise<string | null>
}) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    listVenueRevisions(templateId).then(
      (list) => {
        if (live) setLoad({ kind: 'ready', list })
      },
      (err: unknown) => {
        if (live) setLoad({ kind: 'error', message: `Could not load the revisions. ${errorMessage(err)}` })
      },
    )
    return () => {
      live = false
    }
  }, [templateId, refreshKey, attempt])

  async function restore(id: string, undoImport: boolean) {
    if (busy) return
    setBusy(id)
    setError(null)
    try {
      const note = await onRestore(id, undoImport)
      if (note) setError(note)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  if (load.kind === 'loading') return <p className="px-4 py-6 text-sm text-stone-600">Loading revisions…</p>
  if (load.kind === 'error')
    return (
      <div className="space-y-2 px-4 py-6">
        <p className={errorClass}>{load.message}</p>
        <button type="button" className={smallButton} onClick={() => setAttempt((n) => n + 1)}>
          Try again
        </button>
      </div>
    )

  const { revisions, undoImportRevisionId } = load.list
  return (
    <div data-testid="revisions-panel">
      {undoImportRevisionId && (
        <Section title="Import">
          <p className="text-sm text-stone-700">Put the venue back as it was before the last import.</p>
          <button
            type="button"
            className={smallButton}
            disabled={disabled || busy !== null}
            onClick={() => void restore(undoImportRevisionId, true)}
            data-testid="undo-import"
          >
            {busy === undoImportRevisionId ? 'Undoing…' : 'Undo import'}
          </button>
        </Section>
      )}
      {error && (
        <p role="alert" className={`${errorClass} px-4 pt-3`} data-testid="revisions-error">
          {error}
        </p>
      )}
      <Section title="Saves and imports">
        {revisions.length === 0 ? (
          <p className="text-sm text-stone-600">Nothing saved yet.</p>
        ) : (
          <ol className="space-y-2">
            {revisions.map((r, i) => (
              <li key={r.id} className="flex items-center justify-between gap-2 rounded-lg border border-stone-200 px-3 py-2" data-testid="revision">
                <div className="min-w-0 text-sm">
                  <p className="font-medium text-stone-900">
                    {revisionTitle(r)} {i === 0 && <span className="text-xs font-normal text-stone-500">(now)</span>}
                  </p>
                  <p className="text-stone-600">
                    <RelativeTime iso={r.createdAt} /> · {revisionDetail(r)}
                  </p>
                </div>
                {i > 0 && (
                  <button type="button" className={smallButton} disabled={disabled || busy !== null} onClick={() => void restore(r.id, false)}>
                    {busy === r.id ? 'Putting back…' : 'Put back'}
                  </button>
                )}
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  )
}
