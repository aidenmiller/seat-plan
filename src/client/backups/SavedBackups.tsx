'use client'

import { useCallback, useEffect, useState } from 'react'
import { backupNow, listWeddingBackups, restoreWeddingBackup, weddingBackupDownloadUrl } from '@/client/backups-api'
import { errorMessage } from '@/client/api'
import { errorClass, hintClass, labelClass, secondaryButton } from '@/client/ui/styles'
import type { BackupSummary, WeddingBackupsReply } from '@/shared/backups-api'
import { backupCounts, backupTime, formatSize, kindLabel, runBackupNow, type BackupNowResult } from './outcomes'
import { RestoreBackupDialog } from './RestoreBackupDialog'

const smallButton = `${secondaryButton} px-3`

/**
 * "Saved backups" in the wedding settings: the stored backups of this
 * wedding, newest first, each with Download and Restore as a new wedding,
 * and Back up now. The list scrolls inside its own box, so the dialog never
 * scrolls sideways.
 */
export function SavedBackups({ weddingId }: { weddingId: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-t border-stone-200 pt-4" data-testid="saved-backups">
      <p className={labelClass}>Saved backups</p>
      <p className={hintClass}>Backed up every night when something changed. Kept for 30 days, then one a month for a year.</p>
      <button
        type="button"
        className={`${secondaryButton} mt-2`}
        aria-expanded={open}
        aria-controls="saved-backups-body"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? 'Hide saved backups' : 'Show saved backups'}
      </button>
      {open && <SavedBackupsBody weddingId={weddingId} />}
    </div>
  )
}

function SavedBackupsBody({ weddingId }: { weddingId: string }) {
  const [data, setData] = useState<WeddingBackupsReply | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [backingUp, setBackingUp] = useState(false)
  const [result, setResult] = useState<BackupNowResult | null>(null)
  const [restoring, setRestoring] = useState<BackupSummary | null>(null)

  const load = useCallback(async () => {
    try {
      setData(await listWeddingBackups(weddingId))
      setLoadError(null)
    } catch (err) {
      setLoadError(`Could not load the saved backups. ${errorMessage(err)}`)
    }
  }, [weddingId])

  useEffect(() => {
    // Loading on open is the point: this component mounts when the section opens.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  async function onBackUp() {
    if (backingUp) return
    setBackingUp(true)
    setResult(null)
    const outcome = await runBackupNow(() => backupNow(weddingId))
    setResult(outcome)
    if (outcome.reload) await load()
    setBackingUp(false)
  }

  return (
    <div id="saved-backups-body" className="mt-3">
      <SavedBackupsView
        data={data}
        loadError={loadError}
        backingUp={backingUp}
        result={result}
        weddingId={weddingId}
        onBackUp={() => void onBackUp()}
        onRestore={setRestoring}
      />
      <RestoreBackupDialog
        open={restoring !== null}
        onClose={() => setRestoring(null)}
        description={restoring ? `The backup from ${backupTime(restoring.createdAt)}.` : ''}
        send={(jobId) => restoreWeddingBackup(weddingId, restoring?.id ?? '', jobId)}
      />
    </div>
  )
}

/** The list and the Back up now button, for the data as loaded. */
export function SavedBackupsView({
  data,
  loadError,
  backingUp,
  result,
  weddingId,
  onBackUp,
  onRestore,
}: {
  data: WeddingBackupsReply | null
  loadError: string | null
  backingUp: boolean
  result: BackupNowResult | null
  weddingId: string
  onBackUp: () => void
  onRestore: (backup: BackupSummary) => void
}) {
  if (loadError) {
    return (
      <p role="alert" className={errorClass}>
        {loadError}
      </p>
    )
  }
  if (!data) return <p className="text-sm text-stone-600">Loading…</p>
  if (!data.configured) return <p className="text-sm text-stone-700" data-testid="backups-not-set-up">Backups are not set up yet.</p>
  return (
    <div className="space-y-3">
      <div>
        <button type="button" className={secondaryButton} onClick={onBackUp} disabled={backingUp}>
          {backingUp ? 'Backing up…' : 'Back up now'}
        </button>
        {result && (
          <p
            role={result.tone === 'error' ? 'alert' : 'status'}
            className={result.tone === 'error' ? `${errorClass} mt-2` : 'mt-2 text-sm text-stone-700'}
            data-testid="backup-now-result"
          >
            {result.message}
          </p>
        )}
      </div>
      {data.backups.length === 0 ? (
        <p className="text-sm text-stone-700" data-testid="no-backups">
          No backups yet. The first one is made tonight.
        </p>
      ) : (
        // Positioned, so nothing inside can widen the dialog; the list scrolls up and down in its own box.
        <ul className="relative max-h-72 divide-y divide-stone-200 overflow-y-auto overscroll-contain rounded-lg border border-stone-200" data-testid="backup-list">
          {data.backups.map((b) => (
            <li key={b.id} className="space-y-2 p-3" data-testid="backup-row" data-backup-id={b.id}>
              <p className="text-sm font-medium text-stone-900">
                <time dateTime={b.createdAt}>{backupTime(b.createdAt)}</time>
                <span className="font-normal text-stone-600"> · {kindLabel(b.kind)}</span>
              </p>
              <p className="text-sm text-stone-600">
                {formatSize(b.byteSize)} · {backupCounts(b)}
              </p>
              <div className="flex flex-wrap gap-2">
                <a href={weddingBackupDownloadUrl(weddingId, b.id)} download className={smallButton}>
                  Download
                </a>
                <button type="button" className={smallButton} onClick={() => onRestore(b)}>
                  Restore as a new wedding
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
